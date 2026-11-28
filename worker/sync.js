/* Your list on the server: one row per film you've rated, wanted, passed or cleared, merged last-writer-wins on the
   timestamp each device stamps on its change (the same rule the page has always used between browsers). Every write
   bumps the account's revision, so a device asks only for what changed since the revision it last saw. */

import {HttpError} from "./util.js";
import {json, readJSON, requireSession} from "./http.js";
import {rateLimit} from "./db.js";
import {cleanEntry, cleanCfg, FILM_ID, bad} from "./validate.js";

const MAX_BATCH = 3000, MAX_ENTRIES = 25000;

function rowsToFilms(rows) {
  const films = {};
  for (const r of rows) {
    const e = {t: r.t};
    if (r.s) { e.s = r.s; e.r = r.s >= 9 ? "loved" : r.s >= 7 ? "liked" : r.s >= 5 ? "meh" : "disliked"; }
    if (r.seen) e.seen = 1;
    if (r.w) e.w = 1;
    if (r.x) e.x = 1;
    if (r.src) e.src = r.src;
    if (r.f) { try { e.f = JSON.parse(r.f); } catch (err) { /* skip a bad copy */ } }
    films[r.film_id] = e;
  }
  return films;
}

async function changesSince(env, userId, since) {
  const [u, rows] = await env.DB.batch([
    env.DB.prepare("SELECT rev, cfg, cfg_t, cfg_rev FROM users WHERE id = ?").bind(userId),
    env.DB.prepare("SELECT film_id, t, s, seen, w, x, src, f FROM entries WHERE user_id = ? AND rev > ?").bind(userId, since)
  ]);
  const user = u.results[0];
  if (!user) throw new HttpError(401, "signed_out", "Sign in first.");
  const out = {rev: user.rev, films: rowsToFilms(rows.results)};
  if (user.cfg && user.cfg_rev > since) { try { out.cfg = JSON.parse(user.cfg); } catch (e) { /* ignore */ } }
  return out;
}

const sinceOf = v => { const n = Number(v); return Number.isInteger(n) && n >= 0 ? n : 0; };

export async function getState(env, request, ctx, url) {
  const s = await requireSession(env, request, ctx);
  return json(await changesSince(env, s.user_id, sinceOf(url.searchParams.get("since"))));
}

export async function postState(env, request, ctx) {
  const s = await requireSession(env, request, ctx);
  await rateLimit(env, "sync:" + s.user_id, 600, 600);
  const body = await readJSON(request, 4 * 1024 * 1024);
  const since = sinceOf(body.since);
  const serverNow = Date.now();
  const batch = [];
  if (body.films && typeof body.films === "object" && !Array.isArray(body.films)) {
    const ids = Object.keys(body.films);
    if (ids.length > MAX_BATCH) bad(`Send at most ${MAX_BATCH} films at a time.`);
    for (const id of ids) {
      if (!FILM_ID.test(id)) continue;
      const e = cleanEntry(body.films[id], serverNow);
      if (e) batch.push(Object.assign({id}, e));
    }
  }
  const cfg = body.cfg ? cleanCfg(body.cfg) : null;
  if (batch.length) {
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM entries WHERE user_id = ?").bind(s.user_id).first();
    if (n.n + batch.length > MAX_ENTRIES + MAX_BATCH) bad("Your list has reached its size limit.");
  }
  if (batch.length || cfg) {
    const stmts = [env.DB.prepare("UPDATE users SET rev = rev + 1 WHERE id = ?").bind(s.user_id)];
    if (batch.length) {
      // One statement for the whole batch: rows come in as a JSON array, and a row only replaces an older one.
      stmts.push(env.DB.prepare(
        `INSERT INTO entries (user_id, film_id, t, s, seen, w, x, src, f, rev)
         SELECT ?1, json_extract(value, '$.id'), json_extract(value, '$.t'), json_extract(value, '$.s'),
                json_extract(value, '$.seen'), json_extract(value, '$.w'), json_extract(value, '$.x'),
                json_extract(value, '$.src'), json_extract(value, '$.f'), (SELECT rev FROM users WHERE id = ?1)
           FROM json_each(?2) WHERE true
         ON CONFLICT(user_id, film_id) DO UPDATE SET t = excluded.t, s = excluded.s, seen = excluded.seen, w = excluded.w,
            x = excluded.x, src = excluded.src, f = COALESCE(excluded.f, entries.f), rev = excluded.rev
         WHERE excluded.t > entries.t`).bind(s.user_id, JSON.stringify(batch)));
    }
    if (cfg) {
      stmts.push(env.DB.prepare(
        `UPDATE users SET cfg = ?2, cfg_t = ?3, cfg_rev = rev WHERE id = ?1 AND (cfg_t IS NULL OR cfg_t < ?3)`)
        .bind(s.user_id, JSON.stringify(cfg), cfg.t));
    }
    await env.DB.batch(stmts);
  }
  return json(await changesSince(env, s.user_id, since));
}
