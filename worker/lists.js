/* Shared lists ("Together"): a list of films for two or more people to watch together. Joining one shares your
   ratings, watchlist and passes with its other members, so the page can rank films everyone will like. */

import {HttpError, now, randomToken} from "./util.js";
import {json, readJSON, requireSession} from "./http.js";
import {rateLimit} from "./db.js";
import {listName, cleanSnap, checkFilmId, bad} from "./validate.js";

const MAX_LISTS = 12, MAX_MEMBERS = 12, MAX_ITEMS = 500;
const LIST_ID = /^[A-Za-z0-9_-]{16}$/, INVITE = /^[A-Za-z0-9_-]{22}$/;

async function membership(env, listId, userId) {
  if (typeof listId !== "string" || !LIST_ID.test(listId)) throw new HttpError(404, "not_found", "No such list.");
  const row = await env.DB.prepare(
    `SELECT l.id, l.name, l.owner_id, l.invite, l.created_at FROM lists l
       JOIN list_members m ON m.list_id = l.id AND m.user_id = ? WHERE l.id = ?`).bind(userId, listId).first();
  if (!row) throw new HttpError(404, "not_found", "No such list, or you're not on it.");
  return row;
}
const ownerOnly = (list, userId) => { if (list.owner_id !== userId) throw new HttpError(403, "owner_only", "Only the list's owner can do that."); };

export async function myLists(env, request, ctx) {
  const s = await requireSession(env, request, ctx);
  const rows = (await env.DB.prepare(
    `SELECT l.id, l.name, l.owner_id, l.updated_at,
            (SELECT COUNT(*) FROM list_items i WHERE i.list_id = l.id AND i.watched_at IS NULL) AS items,
            (SELECT group_concat(u.handle, ',') FROM list_members m2 JOIN users u ON u.id = m2.user_id WHERE m2.list_id = l.id) AS members
       FROM lists l JOIN list_members m ON m.list_id = l.id AND m.user_id = ?
      ORDER BY l.updated_at DESC`).bind(s.user_id).all()).results;
  return json({lists: rows.map(r => ({id: r.id, name: r.name, owner: r.owner_id === s.user_id, items: r.items,
    members: (r.members || "").split(",").filter(Boolean)}))});
}

export async function createList(env, request, ctx) {
  const s = await requireSession(env, request, ctx);
  await rateLimit(env, "lists:" + s.user_id, 20, 3600);
  const body = await readJSON(request);
  const name = listName(body.name);
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM list_members WHERE user_id = ?").bind(s.user_id).first();
  if (n.n >= MAX_LISTS) bad(`You can be on up to ${MAX_LISTS} shared lists.`);
  const id = randomToken(12), invite = randomToken(16), t = now();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO lists (id, name, owner_id, invite, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").bind(id, name, s.user_id, invite, t, t),
    env.DB.prepare("INSERT INTO list_members (list_id, user_id, joined_at) VALUES (?, ?, ?)").bind(id, s.user_id, t)
  ]);
  return json({id, name, invite});
}

/* Everything the page needs to rank films for the group: members' ratings, wants and passes, and the films they
   hide (content flags), plus the list's own films. */
export async function getList(env, request, ctx, listId) {
  const s = await requireSession(env, request, ctx);
  const list = await membership(env, listId, s.user_id);
  const [members, items, entries] = await env.DB.batch([
    env.DB.prepare(`SELECT u.id, u.handle, u.cfg, m.joined_at FROM list_members m JOIN users u ON u.id = m.user_id WHERE m.list_id = ? ORDER BY m.joined_at`).bind(list.id),
    env.DB.prepare(`SELECT i.film_id, i.added_at, i.watched_at, i.f, u.handle AS added_by FROM list_items i LEFT JOIN users u ON u.id = i.added_by WHERE i.list_id = ? ORDER BY i.added_at DESC`).bind(list.id),
    env.DB.prepare(`SELECT e.user_id, e.film_id, e.s, e.seen, e.w, e.x, e.f FROM entries e
                     WHERE e.user_id IN (SELECT user_id FROM list_members WHERE list_id = ?) AND (e.s IS NOT NULL OR e.seen = 1 OR e.w = 1 OR e.x = 1)`).bind(list.id)
  ]);
  const byUser = new Map();
  for (const e of entries.results) {
    if (!byUser.has(e.user_id)) byUser.set(e.user_id, {films: {}, snaps: {}});
    const b = byUser.get(e.user_id);
    b.films[e.film_id] = [e.s || 0, e.seen ? 1 : 0, e.w ? 1 : 0, e.x ? 1 : 0];
    if (e.f) { try { b.snaps[e.film_id] = JSON.parse(e.f); } catch (err) { /* skip */ } }
  }
  const parseHide = c => { try { return (JSON.parse(c || "{}").hide) || {}; } catch (e) { return {}; } };
  return json({
    list: {id: list.id, name: list.name, owner: list.owner_id === s.user_id, invite: list.invite, created: list.created_at},
    members: members.results.map(m => Object.assign({handle: m.handle, you: m.id === s.user_id, owner: m.id === list.owner_id,
      joined: m.joined_at, hide: parseHide(m.cfg)}, byUser.get(m.id) || {films: {}, snaps: {}})),
    items: items.results.map(i => {
      let f = null;
      if (i.f) { try { f = JSON.parse(i.f); } catch (e) { f = null; } }
      return {id: i.film_id, addedBy: i.added_by, added: i.added_at, watched: i.watched_at, f};
    })
  });
}

export async function renameList(env, request, ctx, listId) {
  const s = await requireSession(env, request, ctx);
  const list = await membership(env, listId, s.user_id);
  ownerOnly(list, s.user_id);
  const body = await readJSON(request);
  await env.DB.prepare("UPDATE lists SET name = ?, updated_at = ? WHERE id = ?").bind(listName(body.name), now(), list.id).run();
  return json({ok: true});
}

export async function deleteList(env, request, ctx, listId) {
  const s = await requireSession(env, request, ctx);
  const list = await membership(env, listId, s.user_id);
  ownerOnly(list, s.user_id);
  await env.DB.prepare("DELETE FROM lists WHERE id = ?").bind(list.id).run();
  return json({ok: true});
}

export async function rotateInvite(env, request, ctx, listId) {
  const s = await requireSession(env, request, ctx);
  const list = await membership(env, listId, s.user_id);
  ownerOnly(list, s.user_id);
  const body = await readJSON(request);
  const invite = body.off === true ? null : randomToken(16);
  await env.DB.prepare("UPDATE lists SET invite = ? WHERE id = ?").bind(invite, list.id).run();
  return json({invite});
}

export async function joinList(env, request, ctx) {
  const s = await requireSession(env, request, ctx);
  await rateLimit(env, "join:" + s.user_id, 20, 3600);
  const body = await readJSON(request);
  if (typeof body.list !== "string" || !LIST_ID.test(body.list) || typeof body.invite !== "string" || !INVITE.test(body.invite)) {
    throw new HttpError(400, "bad_invite", "That invite link isn't valid.");
  }
  const list = await env.DB.prepare("SELECT id, name, invite FROM lists WHERE id = ?").bind(body.list).first();
  if (!list || !list.invite || list.invite !== body.invite) throw new HttpError(400, "bad_invite", "That invite link has expired or been turned off. Ask for a new one.");
  const [count, mine] = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) AS n FROM list_members WHERE list_id = ?").bind(list.id),
    env.DB.prepare("SELECT COUNT(*) AS n, SUM(list_id = ?) AS here FROM list_members WHERE user_id = ?").bind(list.id, s.user_id)
  ]);
  if (mine.results[0].here) return json({id: list.id, name: list.name, already: true});
  if (count.results[0].n >= MAX_MEMBERS) bad("That list is full.");
  if (mine.results[0].n >= MAX_LISTS) bad(`You can be on up to ${MAX_LISTS} shared lists.`);
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO list_members (list_id, user_id, joined_at) VALUES (?, ?, ?)").bind(list.id, s.user_id, now()),
    env.DB.prepare("UPDATE lists SET updated_at = ? WHERE id = ?").bind(now(), list.id)
  ]);
  return json({id: list.id, name: list.name});
}

/* Leave a list, or (owner) remove someone. When the owner leaves, the longest-standing member takes over; the last
   person out deletes the list. */
export async function removeMember(env, request, ctx, listId, who) {
  const s = await requireSession(env, request, ctx);
  const list = await membership(env, listId, s.user_id);
  let targetId = s.user_id;
  if (who !== "me") {
    ownerOnly(list, s.user_id);
    const u = await env.DB.prepare("SELECT u.id FROM users u JOIN list_members m ON m.user_id = u.id AND m.list_id = ? WHERE u.handle = ?").bind(list.id, String(who).toLowerCase()).first();
    if (!u) throw new HttpError(404, "not_found", "They're not on this list.");
    targetId = u.id;
  }
  await env.DB.prepare("DELETE FROM list_members WHERE list_id = ? AND user_id = ?").bind(list.id, targetId).run();
  const next = await env.DB.prepare("SELECT user_id FROM list_members WHERE list_id = ? ORDER BY joined_at LIMIT 1").bind(list.id).first();
  if (!next) await env.DB.prepare("DELETE FROM lists WHERE id = ?").bind(list.id).run();
  else if (targetId === list.owner_id) await env.DB.prepare("UPDATE lists SET owner_id = ? WHERE id = ?").bind(next.user_id, list.id).run();
  return json({ok: true});
}

export async function putItem(env, request, ctx, listId, filmId) {
  const s = await requireSession(env, request, ctx);
  checkFilmId(filmId);
  const list = await membership(env, listId, s.user_id);
  await rateLimit(env, "items:" + s.user_id, 300, 600);
  const body = await readJSON(request, 16 * 1024);
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM list_items WHERE list_id = ?").bind(list.id).first();
  if (n.n >= MAX_ITEMS) bad("That list is full. Remove some films first.");
  const snap = cleanSnap(body.f);
  const t = now();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO list_items (list_id, film_id, added_by, added_at, f) VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(list_id, film_id) DO UPDATE SET watched_at = NULL, f = COALESCE(excluded.f, list_items.f)`)
      .bind(list.id, filmId, s.user_id, t, snap ? JSON.stringify(snap) : null),
    env.DB.prepare("UPDATE lists SET updated_at = ? WHERE id = ?").bind(t, list.id)
  ]);
  return json({ok: true});
}

export async function patchItem(env, request, ctx, listId, filmId) {
  const s = await requireSession(env, request, ctx);
  checkFilmId(filmId);
  const list = await membership(env, listId, s.user_id);
  const body = await readJSON(request);
  const r = await env.DB.prepare("UPDATE list_items SET watched_at = ? WHERE list_id = ? AND film_id = ?").bind(body.watched ? now() : null, list.id, filmId).run();
  if (!r.meta.changes) throw new HttpError(404, "not_found", "That film isn't on the list.");
  return json({ok: true});
}

export async function deleteItem(env, request, ctx, listId, filmId) {
  const s = await requireSession(env, request, ctx);
  checkFilmId(filmId);
  const list = await membership(env, listId, s.user_id);
  await env.DB.prepare("DELETE FROM list_items WHERE list_id = ? AND film_id = ?").bind(list.id, filmId).run();
  return json({ok: true});
}
