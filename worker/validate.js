/* Input validation. Everything a client sends is reduced to known keys, types and sizes before it reaches D1, and
   anything other people will see (public profiles, shared lists) is safe to hand back to their browsers. */

import {HttpError, isoOk} from "./util.js";

export const bad = (msg, code = "invalid") => { throw new HttpError(400, code, msg); };

/* Handles: 3–20 characters, lowercase letters, digits, dash and underscore, starting and ending with a letter or digit. */
const RESERVED = new Set(["admin", "administrator", "api", "root", "support", "help", "about", "privacy", "terms", "security",
  "dread", "dreadlist", "dread-list", "www", "mail", "u", "user", "users", "me", "you", "account", "settings", "login",
  "logout", "signin", "signup", "register", "together", "lists", "list", "system", "null", "undefined", "anonymous",
  "guest", "staff", "mod", "moderator", "official", "claude", "anthropic", "cloudflare", "github", "owner", "test"]);
export function normHandle(h) { return String(h == null ? "" : h).trim().toLowerCase().replace(/^@/, ""); }
export function checkHandle(raw) {
  const h = normHandle(raw);
  if (!/^[a-z0-9](?:[a-z0-9_-]{1,18})[a-z0-9]$/.test(h)) bad("Pick a name of 3–20 letters, numbers, dashes or underscores, starting and ending with a letter or number.", "bad_handle");
  if (/[-_]{2}/.test(h)) bad("No double dashes or underscores in names.", "bad_handle");
  if (RESERVED.has(h)) bad("That name is reserved. Pick another.", "handle_reserved");
  return h;
}

export const FILM_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
export const checkFilmId = id => { if (typeof id !== "string" || !FILM_ID.test(id)) bad("Unknown film id."); return id; };

const str = (v, max) => typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, max) : undefined;
const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi ? v : undefined;
const num = (v, lo, hi) => typeof v === "number" && isFinite(v) && v >= lo && v <= hi ? Math.round(v * 10) / 10 : undefined;
const flag = v => v === 1 || v === true ? 1 : undefined;
const list = (v, max, test) => Array.isArray(v) ? v.filter(x => typeof x === "string" && test(x)).slice(0, max) : undefined;
const TAG = s => /^[a-z][a-z-]{0,23}$/.test(s);

/* Services a film added from TMDB is on: known keys, or a named channel or free service. No links: the page builds
   those from known hosts. */
const SVC_KEY = /^(nf|pv|dp|cr|hbo|nowe|nowc|sh|pp|mubi|atv|bfi|tubi|c4|bbc|itvx|pluto|plex|ytf|rakuten|mx|my5)$/;
const NAMED_SVC = /^(ch|free):[^\u0000-\u001f<>"&]{1,60}$/;
const offerList = v => Array.isArray(v) ? v.filter(o => Array.isArray(o) && typeof o[0] === "string" && (SVC_KEY.test(o[0]) || NAMED_SVC.test(o[0])))
  .slice(0, 12).map(o => [o[0], "", null]) : undefined;

/* The compact copy of a film that travels with a rating (SNAP_KEYS in app.js). Links are rebuilt from known hosts, so
   only path-shaped values are accepted for them. Films added from TMDB also carry their TMDB id, poster path and
   services. */
export function cleanSnap(f) {
  if (!f || typeof f !== "object" || Array.isArray(f)) return null;
  const tm = int(f.tm, 1, 1e9);
  const out = {
    t: str(f.t, 200), y: int(f.y, 1880, 2100), jid: typeof f.jid === "string" && /^[a-z]{1,4}\d{1,12}$/.test(f.jid) ? f.jid : undefined,
    px: flag(f.px), tg: list(f.tg, 20, TAG), ta: list(f.ta, 20, TAG),
    dir: list(f.dir, 6, s => s.length <= 100), co: list(f.co, 12, s => /^[A-Z]{2}$/.test(s)),
    g: typeof f.g === "string" && /^[LMHXU]$/.test(f.g) ? f.g : undefined, ge: flag(f.ge), fl: list(f.fl, 10, TAG),
    rn: int(f.rn, 1, 1000), im: num(f.im, 0, 10), rt: int(f.rt, 0, 100),
    imdb: typeof f.imdb === "string" && /^tt\d{5,10}$/.test(f.imdb) ? f.imdb : undefined,
    jw: typeof f.jw === "string" && f.jw.length <= 200 && /^\/[a-z]{2}\/[a-z0-9-]+(\/[a-z0-9-]+)*$/.test(f.jw) ? f.jw : undefined,
    d: str(f.d, 1200), lg: typeof f.lg === "string" && /^[a-z]{2,3}$/.test(f.lg) ? f.lg : undefined, ot: str(f.ot, 200),
    tm, tp: tm && typeof f.tp === "string" && /^\/[A-Za-z0-9_-]{6,64}\.(jpg|png)$/.test(f.tp) ? f.tp : undefined,
    o: tm ? offerList(f.o) : undefined
  };
  if (out.dir) out.dir = out.dir.map(s => str(s, 100));
  for (const k of Object.keys(out)) if (out[k] === undefined || (Array.isArray(out[k]) && !out[k].length)) delete out[k];
  return out.t ? out : null;
}

/* One rating/watchlist/pass entry. Timestamps more than a day ahead of the server are pulled back, so a device with a
   wrong clock can't win every merge forever. */
export function cleanEntry(e, serverNowMs) {
  if (!e || typeof e !== "object" || Array.isArray(e)) return null;
  let t = isoOk(e.t) ? e.t : null;
  if (!t) return null;
  if (Date.parse(t) > serverNowMs + 864e5) t = new Date(serverNowMs).toISOString();
  const s = int(e.s, 1, 10);
  const out = {t, s: s || null, seen: s || e.seen === 1 ? 1 : 0, w: !s && e.w === 1 ? 1 : 0, x: !s && e.x === 1 ? 1 : 0,
    src: e.src === "profile" ? "profile" : null, f: null};
  if (out.s || out.w || out.x || out.seen) {
    const snap = cleanSnap(e.f);
    if (snap) {
      const text = JSON.stringify(snap);
      if (text.length <= 4000) out.f = text;
    }
  }
  return out;
}

const SVC_KEYS = ["nf", "pv", "dp", "hbo", "nowe", "cr", "nowc", "sh", "pp", "mubi", "atv", "bfi"];
const FLAG_KEYS = ["spiders", "snakes", "animal-harm", "child-harm", "sexual-violence", "self-injury"];
export function cleanCfg(c) {
  if (!c || typeof c !== "object" || Array.isArray(c)) return null;
  const svc = {}, hide = {};
  for (const k of SVC_KEYS) if (c.svc && (c.svc[k] === 1 || c.svc[k] === true)) svc[k] = 1;
  for (const k of FLAG_KEYS) if (c.hide && (c.hide[k] === 1 || c.hide[k] === true)) hide[k] = 1;
  return {svc, free: c.free === 0 ? 0 : 1, hide, theme: ["auto", "dark", "light"].includes(c.theme) ? c.theme : "auto",
    share: c.share === 1 ? 1 : 0, en: c.en === 1 ? 1 : 0, t: isoOk(c.t) ? c.t : new Date().toISOString()};
}

export const listName = n => {
  const s = str(n, 60);
  if (!s || !s.trim()) bad("Give the list a name.", "bad_name");
  return s.trim();
};
export const passkeyName = n => {
  const s = str(n, 40);
  return s && s.trim() ? s.trim() : null;
};
