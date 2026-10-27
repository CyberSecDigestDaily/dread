/* Films that aren't in the Dread List yet, from TMDB: search, the details needed to add one to your list, posters
   served through our own origin (the page only loads its own files), and a feed of added films for the nightly
   rebuild, which looks each one up on JustWatch and adds it to the pool for everyone.

   Needs the TMDB_KEY secret: a TMDB API read access token (eyJ…) or a v3 API key. Without it everything here answers
   503 and the page hides film search. Nothing about who searched or added is kept; added films are counted, not
   attributed. Required notice: this product uses the TMDB API but is not endorsed or certified by TMDB. */

import {HttpError, now} from "./util.js";
import {json, readJSON} from "./http.js";
import {limitIP} from "./db.js";
import {cleanSnap} from "./validate.js";

const API = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p/";
const SIZES = new Set(["w92", "w154", "w185", "w342", "w500"]);
const IMG_FILE = /^[A-Za-z0-9_-]{6,64}\.(jpg|png)$/;
const HORROR = 27;

const keyOf = env => String(env.TMDB_KEY || "").trim();
export const findStatus = env => json({on: !!keyOf(env)}, 200, {"Cache-Control": "public, max-age=300"});

async function tmdb(env, path, params) {
  const key = keyOf(env);
  if (!key) throw new HttpError(503, "not_configured", "Film search isn't switched on yet.");
  // TMDB_API (and TMDB_IMG) exist only so tests can point at a stand-in; production always talks to TMDB.
  const url = new URL((env.TMDB_API || API) + path);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, String(v));
  const headers = {accept: "application/json"};
  if (key.startsWith("eyJ")) headers.authorization = "Bearer " + key; else url.searchParams.set("api_key", key);
  let res;
  try { res = await fetch(url, {headers, cf: {cacheTtl: 6 * 3600, cacheEverything: true}}); }
  catch (e) { throw new HttpError(502, "tmdb_unreachable", "TMDB didn't answer. Try again in a moment."); }
  if (res.status === 404) throw new HttpError(404, "not_found", "TMDB doesn't know that film.");
  if (res.status === 401) { console.error("TMDB rejected the key"); throw new HttpError(503, "not_configured", "Film search isn't working right now."); }
  if (!res.ok) throw new HttpError(502, "tmdb_error", "TMDB had a problem. Try again in a moment.");
  return res.json();
}

const yearOf = d => (typeof d === "string" && /^\d{4}/.test(d)) ? Number(d.slice(0, 4)) : undefined;
const lang = l => typeof l === "string" && /^[a-z]{2}$/.test(l) && l !== "en" ? (l === "cn" ? "zh" : l) : undefined;
function short(text, limit) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (t.length <= limit) return t || undefined;
  return t.slice(0, limit).replace(/\s+\S*$/, "").replace(/[,;:]$/, "") + "…";
}

/* ---- Search ---- */
export async function findSearch(env, request, url) {
  await limitIP(env, request, "find", 60, 600);
  const q = String(url.searchParams.get("q") || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 80);
  if (q.length < 2) throw new HttpError(400, "short_query", "Type at least two letters.");
  const data = await tmdb(env, "/search/movie", {query: q, include_adult: "false", language: "en-GB", region: "GB", page: 1});
  const results = (data.results || []).filter(r => r && Number.isInteger(r.id) && r.title).slice(0, 12).map(r => {
    const out = {tm: r.id, t: String(r.title).slice(0, 200), y: yearOf(r.release_date), lg: lang(r.original_language),
      tp: typeof r.poster_path === "string" && IMG_FILE.test(r.poster_path.slice(1)) ? r.poster_path : undefined,
      d: short(r.overview, 220), h: (r.genre_ids || []).includes(HORROR) ? 1 : 0};
    if (r.original_title && r.original_title !== r.title) out.ot = String(r.original_title).slice(0, 200);
    return out;
  });
  return json({q, results}, 200, {"Cache-Control": "private, max-age=600"});
}

/* ---- Details: a film record in the same shape as the pool's (data.json), from TMDB ---- */
const SERVICES = [
  [/^netflix/, "nf"], [/^amazon prime video/, "pv"], [/^disney/, "dp"], [/^crunchyroll/, "cr"], [/^(hbo )?max$|^hbo max/, "hbo"],
  [/^now tv cinema|^now cinema|^sky cinema/, "nowc"], [/^now( tv)?$/, "nowe"], [/^sky go/, null], [/^shudder/, "sh"], [/^paramount/, "pp"],
  [/^apple tv( plus|\+)?$/, "atv"], [/^mubi/, "mubi"], [/^bfi player/, "bfi"], [/^tubi/, "tubi"], [/^channel 4|^all 4/, "c4"],
  [/^bbc iplayer/, "bbc"], [/^itvx?$/, "itvx"], [/^pluto/, "pluto"], [/^plex/, "plex"], [/^youtube( free)?$/, "ytf"],
  [/^rakuten/, "rakuten"], [/^amazon mx/, "mx"], [/^(my5|5|channel 5)$/, "my5"], [/^justwatch/, null]
];
const FREE_KEYS = new Set(["tubi", "c4", "bbc", "itvx", "pluto", "plex", "ytf", "rakuten", "mx", "my5"]);
function serviceKey(name, kind) {
  const low = String(name || "").toLowerCase().trim();
  for (const [re, key] of SERVICES) if (re.test(low)) return key === null ? null : (kind !== "flatrate" && !FREE_KEYS.has(key) && key !== "pv" ? "free:" + name.trim() : key);
  const base = String(name || "").replace(/\s+(amazon|apple tv) channel$/i, "").trim();
  if (!base) return null;
  return kind === "flatrate" ? "ch:" + base.slice(0, 60) : "free:" + base.slice(0, 60);
}
function offersFrom(providers) {
  const gb = providers && providers.results && providers.results.GB;
  const out = [], seen = new Set();
  for (const kind of ["flatrate", "free", "ads"]) {
    for (const p of (gb && gb[kind]) || []) {
      const key = serviceKey(p.provider_name, kind);
      if (key && !seen.has(key)) { seen.add(key); out.push([key, "", null]); }
    }
  }
  return out.slice(0, 12);
}
/* Subgenre tags and content flags from the synopsis and TMDB's keywords: the same rules refresh.py applies. */
const TAG_RULES = [
  [/found footage|documentar|camcorder|live ?stream|webcam|footage|film crew|mockumentary|screenlife/, "found-footage"],
  [/time loop|\bloop|alternate (reality|dimension)|parallel (world|universe|dimension)|another dimension|labyrinth|\bmaze|liminal|backrooms/, "liminal"],
  [/\bcave|tunnel|bunker|basement|cellar|trapped (in|inside)|confined|buried alive|claustrophob/, "claustrophobic"],
  [/remote|isolated|\bisland|arctic|antarctic|\bcabin\b|research station|outpost|lighthouse|snowed in|wilderness|isolation/, "isolation"],
  [/creature|monster|\bbeast|\balien|predator|\bshark|mutant|werewolf|kaiju|cryptid|bigfoot/, "creature"],
  [/parasite|mutat|metamorph|body horror|\bflesh/, "body-horror"], [/shape[- ]?shift|imposter|impostor|paranoi/, "paranoia"],
  [/zombie|\binfected|outbreak|\bvirus|epidemic|\bplague|pandemic|undead|contagion/, "outbreak"],
  [/haunt|\bghost|\bspirits?\b|poltergeist|s[eé]ance|apparition|supernatural/, "ghost"], [/possess|\bdemon|exorcis|the devil|satan/, "possession"],
  [/\bvillage|pagan|folk horror|folklore|commune|midsummer/, "folk"], [/\bcult\b|cultists|\bsect\b/, "cult"],
  [/\bpriest|\bnuns?\b|church|vatican|convent|religio/, "religious"], [/\bwitch|coven/, "witch"], [/vampire|dracula|nosferatu/, "vampire"],
  [/lovecraft|cosmic horror|eldritch|ancient (evil|entity|being|god)/, "cosmic"], [/science fiction|sci-fi/, "sci-fi"],
  [/space station|spaceship|spacecraft|astronaut|outer space/, "space"], [/\bocean|at sea\b|\bship\b|\bboat|underwater|deep[- ]sea|submarine/, "sea"],
  [/masked killer|serial killer|slasher|psychopath|maniac|killing spree/, "slasher"], [/home invasion|intruders?\b/, "home-invasion"],
  [/\bgrie(f|ving)|mourning/, "grief"], [/sanity|madness|psycholog|hallucinat/, "psychological"], [/\bsurviv|stranded/, "survival"],
  [/anthology|segments/, "anthology"], [/\bcurse|occult|\britual|satanic|summon/, "occult"], [/comedy|spoof|parody/, "comedy"],
  [/spider|arachnid|tarantula/, "f:spiders"], [/\bsnakes?\b|serpent|anaconda/, "f:snakes"]
];
const GENRE_TAGS = {878: "sci-fi", 35: "comedy", 28: "action", 36: "period", 37: "period", 10752: "period", 16: "animated", 9648: "mystery"};
const VIOLENT = /tortur|sadis|gruesome|\bgor(e|y)\b|mutilat|dismember|massacre|slaughter|butcher|bloodbath|brutal|cannibal|carnage|splatter/;
function gbCert(rd) {
  const gb = ((rd && rd.results) || []).find(r => r.iso_3166_1 === "GB");
  const c = gb && (gb.release_dates || []).map(x => x.certification).find(Boolean);
  return c ? String(c).toUpperCase().slice(0, 4) : undefined;
}
function filmRecord(m) {
  const text = [m.title, m.overview, ...(((m.keywords || {}).keywords) || []).map(k => k.name)].join(" ").toLowerCase();
  const tags = new Set(), flags = new Set();
  for (const [re, tag] of TAG_RULES) if (re.test(text)) (tag.startsWith("f:") ? flags.add(tag.slice(2)) : tags.add(tag));
  for (const g of m.genres || []) if (GENRE_TAGS[g.id]) tags.add(GENRE_TAGS[g.id]);
  const cert = gbCert(m.release_dates), violent = VIOLENT.test(text);
  const g = cert === "18" && violent ? "H" : ["U", "PG", "12", "12A"].includes(cert) ? "L" : "M";
  const genres = (m.genres || []).map(x => x.id);
  const rec = {
    id: "tmdb-" + m.id, tm: m.id, t: String(m.title || "").slice(0, 200), y: yearOf(m.release_date),
    ot: m.original_title && m.original_title !== m.title ? String(m.original_title).slice(0, 200) : undefined,
    lg: lang(m.original_language), d: short(m.overview, 300), rn: Number.isInteger(m.runtime) && m.runtime > 0 ? m.runtime : undefined,
    ce: cert, co: (m.production_countries || []).map(c => c.iso_3166_1).filter(c => /^[A-Z]{2}$/.test(c)).slice(0, 3),
    dir: (((m.credits || {}).crew) || []).filter(c => c.job === "Director").map(c => String(c.name).slice(0, 100)).slice(0, 2),
    imdb: ((m.external_ids || {}).imdb_id) || m.imdb_id || undefined,
    ta: [...tags].sort(), fl: [...flags].sort(), g, ge: 1, o: offersFrom(m["watch/providers"]),
    tp: typeof m.poster_path === "string" && IMG_FILE.test(m.poster_path.slice(1)) ? m.poster_path : undefined,
    h: genres.includes(HORROR) ? 1 : 0
  };
  if (rec.imdb && !/^tt\d{5,10}$/.test(rec.imdb)) delete rec.imdb;
  for (const k of Object.keys(rec)) if (rec[k] === undefined || (Array.isArray(rec[k]) && !rec[k].length && k !== "o")) delete rec[k];
  return rec;
}
const tmId = raw => { const n = Number(raw); if (!Number.isInteger(n) || n < 1 || n > 1e9) throw new HttpError(404, "not_found", "No such film."); return n; };
async function details(env, id) {
  return filmRecord(await tmdb(env, `/movie/${id}`, {language: "en-GB", append_to_response: "credits,release_dates,watch/providers,keywords,external_ids"}));
}
export async function findFilm(env, request, rawId) {
  await limitIP(env, request, "find", 60, 600);
  return json({film: await details(env, tmId(rawId))}, 200, {"Cache-Control": "private, max-age=3600"});
}

/* Someone added this film to their list: count it, so the nightly rebuild brings it into the pool. Who added it isn't
   recorded. The film is fetched again here rather than trusting what the page sent. Twenty a day from any one address,
   so nobody can flood the pool; past that, a film still goes on your own list, it just isn't counted. */
export async function findAdded(env, request, rawId) {
  await limitIP(env, request, "added", 20, 86400);
  await readJSON(request);
  const id = tmId(rawId), rec = await details(env, id), t = now();
  const snap = cleanSnap(rec);
  await env.DB.prepare(`INSERT INTO added (tm, imdb, t, y, h, f, n, first_at, last_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
                        ON CONFLICT(tm) DO UPDATE SET imdb = excluded.imdb, t = excluded.t, y = excluded.y, h = excluded.h, f = excluded.f,
                          n = added.n + 1, last_at = excluded.last_at`)
    .bind(id, rec.imdb || null, rec.t, rec.y || null, rec.h, snap ? JSON.stringify(Object.assign(snap, {g: rec.g})) : null, t, t).run();
  return json({ok: true, id: rec.id});
}

/* For refresh.py: films people added in the last year, newest first. Public: film data only. */
export async function addedFeed(env, request) {
  await limitIP(env, request, "addedfeed", 30, 600);
  const rows = (await env.DB.prepare(`SELECT tm, imdb, t, y, h, f, n FROM added WHERE last_at > ? ORDER BY last_at DESC LIMIT 1000`)
    .bind(now() - 365 * 86400).all()).results;
  const films = rows.map(r => {
    let f = null;
    try { f = r.f ? JSON.parse(r.f) : null; } catch (e) { f = null; }
    return {id: "tmdb-" + r.tm, tm: r.tm, imdb: r.imdb || undefined, t: r.t, y: r.y || undefined, h: r.h ? 1 : 0, n: r.n, f};
  });
  return json({updated: new Date().toISOString().slice(0, 10), films}, 200, {"Cache-Control": "public, max-age=3600"});
}

/* Posters for added films, through our own origin: the page's security policy only loads images from this site.
   Only TMDB poster paths of a fixed shape, at a few sizes; cached at the edge for a month. */
export async function tmdbImage(env, request, ctx, size, file) {
  if (!SIZES.has(size) || !IMG_FILE.test(file)) throw new HttpError(404, "not_found", "No such image.");
  const cache = caches.default, cacheKey = new Request(new URL(request.url).origin + `/api/img/${size}/${file}`);
  const hit = await cache.match(cacheKey);
  if (hit) return hit;
  let res;
  try { res = await fetch((env.TMDB_IMG || IMG) + size + "/" + file, {cf: {cacheTtl: 30 * 86400, cacheEverything: true}}); }
  catch (e) { throw new HttpError(502, "image_unreachable", "Couldn't fetch that poster."); }
  const type = res.headers.get("Content-Type") || "";
  if (!res.ok || !/^image\/(jpeg|png)$/.test(type)) throw new HttpError(404, "not_found", "No such image.");
  const out = new Response(res.body, {status: 200, headers: {"Content-Type": type, "Cache-Control": "public, max-age=2592000, immutable"}});
  ctx.waitUntil(cache.put(cacheKey, out.clone()).catch(() => {}));
  return out;
}
