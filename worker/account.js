/* Your account: rename, public profile on/off, export everything, delete everything. Plus the two public reads:
   profiles people chose to share, and the anonymous taste hints that help the nightly rebuild find films. */

import {HttpError, now} from "./util.js";
import {json, readJSON, requireSession, requireFresh, clearCookie} from "./http.js";
import {limitIP} from "./db.js";
import {checkHandle, normHandle} from "./validate.js";

export async function patchMe(env, request, ctx) {
  const s = await requireSession(env, request, ctx);
  const body = await readJSON(request);
  const sets = [], args = [];
  if (body.handle !== undefined) {
    const h = checkHandle(body.handle);
    if (h !== s.handle) {
      const taken = await env.DB.prepare("SELECT 1 FROM users WHERE handle = ? AND id != ?").bind(h, s.user_id).first();
      if (taken) throw new HttpError(409, "handle_taken", "That name is taken. Pick another.");
      sets.push("handle = ?"); args.push(h);
    }
  }
  if (body.public !== undefined) { sets.push("public = ?"); args.push(body.public ? 1 : 0); }
  if (sets.length) {
    try { await env.DB.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).bind(...args, s.user_id).run(); }
    catch (e) { if (/UNIQUE/i.test(String(e && e.message))) throw new HttpError(409, "handle_taken", "That name is taken. Pick another."); throw e; }
  }
  const u = await env.DB.prepare("SELECT handle, public FROM users WHERE id = ?").bind(s.user_id).first();
  return json({handle: u.handle, public: !!u.public});
}

export async function deleteMe(env, request, ctx) {
  const s = await requireSession(env, request, ctx);
  requireFresh(s);
  // Lists you own pass to the longest-standing other member, or go with you if you're alone on them.
  const owned = (await env.DB.prepare("SELECT id FROM lists WHERE owner_id = ?").bind(s.user_id).all()).results;
  const stmts = [];
  for (const l of owned) {
    const next = await env.DB.prepare("SELECT user_id FROM list_members WHERE list_id = ? AND user_id != ? ORDER BY joined_at LIMIT 1").bind(l.id, s.user_id).first();
    if (next) stmts.push(env.DB.prepare("UPDATE lists SET owner_id = ? WHERE id = ?").bind(next.user_id, l.id));
  }
  stmts.push(env.DB.prepare("DELETE FROM users WHERE id = ?").bind(s.user_id));
  await env.DB.batch(stmts);
  return json({ok: true}, 200, {"Set-Cookie": clearCookie()});
}

export async function exportMe(env, request, ctx) {
  const s = await requireSession(env, request, ctx);
  const [u, entries, creds, sessions, lists] = await env.DB.batch([
    env.DB.prepare("SELECT id, handle, created_at, public, cfg FROM users WHERE id = ?").bind(s.user_id),
    env.DB.prepare("SELECT film_id, t, s, seen, w, x, src, f FROM entries WHERE user_id = ?").bind(s.user_id),
    env.DB.prepare("SELECT name, created_at, last_used_at, backed_up, aaguid FROM credentials WHERE user_id = ?").bind(s.user_id),
    env.DB.prepare("SELECT created_at, last_seen_at, method, device FROM sessions WHERE user_id = ?").bind(s.user_id),
    env.DB.prepare(`SELECT l.name, m.joined_at, (SELECT json_group_array(film_id) FROM list_items i WHERE i.list_id = l.id) AS films
                      FROM lists l JOIN list_members m ON m.list_id = l.id WHERE m.user_id = ?`).bind(s.user_id)
  ]);
  const user = u.results[0];
  const films = {};
  for (const r of entries.results) {
    films[r.film_id] = {t: r.t, s: r.s || undefined, seen: r.seen || undefined, w: r.w || undefined, x: r.x || undefined, src: r.src || undefined,
      f: r.f ? JSON.parse(r.f) : undefined};
  }
  const body = {exported: new Date().toISOString(), v: 3,
    account: {handle: user.handle, created: new Date(user.created_at * 1000).toISOString(), publicProfile: !!user.public},
    films, cfg: user.cfg ? JSON.parse(user.cfg) : null,
    passkeys: creds.results.map(c => ({name: c.name, created: new Date(c.created_at * 1000).toISOString(), synced: !!c.backed_up, aaguid: c.aaguid})),
    sessions: sessions.results.map(x => ({created: new Date(x.created_at * 1000).toISOString(), lastSeen: new Date(x.last_seen_at * 1000).toISOString(), method: x.method, device: x.device})),
    sharedLists: lists.results.map(l => ({name: l.name, joined: new Date(l.joined_at * 1000).toISOString(), films: JSON.parse(l.films || "[]")}))};
  return json(body, 200, {"Content-Disposition": `attachment; filename="dread-list-account-${new Date().toISOString().slice(0, 10)}.json"`});
}

/* A public profile: ratings and watchlist (never passes or dates), only if its owner switched it on. */
export async function publicProfile(env, request, handle) {
  await limitIP(env, request, "profile", 120, 600);
  const h = normHandle(handle);
  if (!/^[a-z0-9_-]{3,20}$/.test(h)) throw new HttpError(404, "not_found", "No public list with that name.");
  const u = await env.DB.prepare("SELECT id, handle, created_at FROM users WHERE handle = ? AND public = 1").bind(h).first();
  if (!u) throw new HttpError(404, "not_found", "No public list with that name.");
  const rows = (await env.DB.prepare("SELECT film_id, s, seen, w, f FROM entries WHERE user_id = ? AND (s IS NOT NULL OR seen = 1 OR w = 1)").bind(u.id).all()).results;
  const films = {}, snaps = {};
  for (const r of rows) {
    films[r.film_id] = [r.s || 0, r.seen ? 1 : 0, r.w && !r.s ? 1 : 0];
    if (r.f) { try { snaps[r.film_id] = JSON.parse(r.f); } catch (e) { /* skip */ } }
  }
  return json({handle: u.handle, since: new Date(u.created_at * 1000).toISOString().slice(0, 7), films, snaps}, 200, {"Cache-Control": "private, max-age=60"});
}

/* Opt-in only (Settings, "Help grow the pool"): film ids people loved, liked or wanted, and passed, with no names,
   scores or dates. refresh.py reads this to pull in similar films for everyone. */
export async function hints(env, request) {
  await limitIP(env, request, "hints", 30, 600);
  const rows = (await env.DB.prepare(
    `SELECT e.film_id, MAX(CASE WHEN e.s >= 9 THEN 3 WHEN e.s >= 7 THEN 2 WHEN e.w = 1 THEN 1 ELSE 0 END) AS up,
            MAX(CASE WHEN e.x = 1 OR (e.s IS NOT NULL AND e.s <= 4) THEN 1 ELSE 0 END) AS down
       FROM entries e JOIN users u ON u.id = e.user_id
      WHERE json_extract(u.cfg, '$.share') = 1
      GROUP BY e.film_id`).all()).results;
  const out = {updated: new Date().toISOString().slice(0, 10), loved: [], liked: [], want: [], pass: []};
  for (const r of rows) {
    if (r.up === 3) out.loved.push(r.film_id);
    else if (r.up === 2) out.liked.push(r.film_id);
    else if (r.up === 1) out.want.push(r.film_id);
    else if (r.down) out.pass.push(r.film_id);
  }
  for (const k of ["loved", "liked", "want", "pass"]) out[k] = out[k].sort().slice(0, 2000);
  return json(out, 200, {"Cache-Control": "public, max-age=3600"});
}
