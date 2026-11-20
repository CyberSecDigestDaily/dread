"use strict";
/* Dread List: a horror recommender that learns from your buttons.
   data.json is rebuilt daily by refresh.py (JustWatch UK + Wikidata). Ratings, wants, passes and settings live in
   this browser, and in your account if you sign in (account.js); shared lists and profiles are in together.js, adding
   films from TMDB in find.js, the welcome page, onboarding and share cards in extras.js.
   No third-party requests from the page itself. */

/* ---------- Config ---------- */
const SVC = {
  nf: {n: "Netflix"}, pv: {n: "Prime Video"}, dp: {n: "Disney+"}, cr: {n: "Crunchyroll"},
  hbo: {n: "HBO Max", p: 4.99, note: "comes with NOW Entertainment"}, nowe: {n: "NOW Entertainment", p: 9.99},
  nowc: {n: "NOW Cinema", p: 9.99, note: "£6.99 on a 12-month saver"},
  sh: {n: "Shudder", p: 4.99, note: "7-day free trial, or add it as a Prime Video channel"},
  pp: {n: "Paramount+", p: 5.99, note: "Basic with ads"}, mubi: {n: "MUBI", p: 11.99, note: "7-day free trial"},
  atv: {n: "Apple TV+"}, bfi: {n: "BFI Player"},
  tubi: {n: "Tubi", free: 1}, c4: {n: "Channel 4", free: 1}, bbc: {n: "BBC iPlayer", free: 1}, itvx: {n: "ITVX", free: 1},
  pluto: {n: "Pluto TV", free: 1}, plex: {n: "Plex", free: 1}, ytf: {n: "YouTube", free: 1}, rakuten: {n: "Rakuten TV", free: 1},
  mx: {n: "Amazon MX Player", free: 1}, my5: {n: "My5", free: 1}
};
const OWNABLE = ["nf", "pv", "dp", "hbo", "nowe", "cr", "nowc", "sh", "pp", "mubi", "atv", "bfi"];
const FREE_ORDER = ["bbc", "c4", "itvx", "my5", "tubi", "mx", "plex", "pluto", "ytf", "rakuten"];
const DEFAULT_CFG = {svc: {nf: 1, pv: 1, dp: 1, hbo: 1, nowe: 1, cr: 1}, free: 1, hide: {}, theme: "auto", share: 0, en: 0, t: ""};
const TAGS = {"found-footage": "Found footage", liminal: "Liminal", claustrophobic: "Claustrophobic", isolation: "Isolation",
  creature: "Creatures", "body-horror": "Body horror", paranoia: "Paranoia", outbreak: "Outbreaks", ghost: "Ghosts",
  possession: "Possession", occult: "Occult", folk: "Folk horror", cult: "Cults", religious: "Religious", witch: "Witches",
  vampire: "Vampires", cosmic: "Cosmic", "sci-fi": "Sci-fi", space: "Space", sea: "At sea", period: "Period",
  slasher: "Slashers", "home-invasion": "Home invasion", psychological: "Psychological", survival: "Survival",
  comedy: "Comedy", action: "Action", anthology: "Anthology", mystery: "Mystery", grief: "Grief", "slow-burn": "Slow burn",
  "practical-fx": "Practical effects", bleak: "Bleak", jumpy: "Jump scares", animated: "Animated"};
const FLAGS = {spiders: "Spiders", snakes: "Snakes", "animal-harm": "Animal harm", "child-harm": "Harm to children",
  "sexual-violence": "Sexual violence", "self-injury": "Self-injury"};
const GORE = {L: "Low", M: "Medium", H: "High", X: "Extreme", U: "Unrated"};
const GORE_RANK = {L: 1, M: 2, H: 3, X: 4, U: 2};
/* Ratings run 1–10, each with a word and a signal for the model. The old four-step ratings map onto it, and every
   rating also keeps its four-step tier (r) so older copies of the page and the nightly rebuild still read it. */
const SCORE_WORD = ["", "Hated", "Awful", "Disliked", "Not for me", "Meh", "OK", "Liked", "Really liked", "Loved", "Favourite"];
const SCORE_SIG = [0, -2.5, -2.2, -1.8, -1.2, -0.5, 0.3, 1, 1.5, 2, 2.5];
const LEGACY = {disliked: 3, meh: 5, liked: 7, loved: 9};
const tierOf = s => s >= 9 ? "loved" : s >= 7 ? "liked" : s >= 5 ? "meh" : "disliked";
const toScore = v => typeof v === "number" && v >= 1 && v <= 10 ? Math.round(v) : LEGACY[v] || 0;
const scoreClass = s => s >= 9 ? "s-hi" : s >= 7 ? "s-good" : s >= 5 ? "s-mid" : "s-low";
const SIG_WANT = 0.6, SIG_PASS = -1, SHRINK = 1.5;
const PRIOR = {"e:pre-1980": -0.6, "e:1980s": -0.2, "g:X": -1.2, "f:sexual-violence": -1.5, "f:spiders": -0.4, "f:snakes": -0.4, "f:child-harm": -0.3, "f:animal-harm": -0.3};
const REGION = {GB: "uk-ie", IE: "uk-ie", US: "us", KR: "korea", JP: "japan", ES: "spain", FR: "france", IT: "italy",
  DE: "germany", AT: "germany", NO: "nordic", SE: "nordic", DK: "nordic", FI: "nordic", IS: "nordic", AR: "latam", MX: "latam",
  BR: "latam", CL: "latam", CO: "latam", UY: "latam", PE: "latam", CA: "canada", AU: "anz", NZ: "anz", TH: "asia", TW: "asia",
  ID: "asia", PH: "asia", MY: "asia", HK: "asia", CN: "asia", IN: "asia", VN: "asia", SG: "asia"};
const REGION_LABEL = {"uk-ie": "British & Irish", us: "American", korea: "Korean", japan: "Japanese", spain: "Spanish",
  france: "French", italy: "Italian", germany: "German-language", nordic: "Nordic", latam: "Latin American", canada: "Canadian",
  anz: "Australian & NZ", asia: "Other Asian", other: "Elsewhere"};
const LANG_REGION = {ko: "korea", ja: "japan", it: "italy", de: "germany", no: "nordic", nb: "nordic", nn: "nordic", sv: "nordic",
  da: "nordic", fi: "nordic", is: "nordic", th: "asia", id: "asia", zh: "asia", yue: "asia", cmn: "asia", tl: "asia", ms: "asia",
  vi: "asia", hi: "asia", ta: "asia", te: "asia", ml: "asia", bn: "asia", km: "asia", si: "asia"};
const LATAM = new Set(["AR", "MX", "BR", "CL", "CO", "UY", "PE", "VE", "EC", "BO", "PY", "CU", "GT", "CR", "DO"]);
const PAGE = 40, WILD_EVERY = 7, SOON_DAYS = 30, NEW_DAYS = 14;
const KEY_STATE = "dread.state.v1";

/* ---------- Helpers ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const nowISO = () => new Date().toISOString();
const todayISO = () => new Date().toISOString().slice(0, 10);
const daysUntil = iso => Math.round((new Date(iso + "T12:00:00Z") - new Date(todayISO() + "T12:00:00Z")) / 864e5);
const shortDate = iso => new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", {day: "numeric", month: "short"});
const runtime = m => m ? (m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`) : "";
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* storage blocked */ } }
};
const svcName = k => SVC[k] ? SVC[k].n : k.startsWith("ch:") ? k.slice(3) : k.startsWith("free:") ? k.slice(5) : k;
const isFree = k => !!(SVC[k] && SVC[k].free) || k.startsWith("free:");
/* Case- and accent-insensitive text for search: "Fréwaka" matches "frewaka". */
const fold = s => String(s == null ? "" : s).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
const foldKey = s => fold(s).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const LANG_NAMES = (() => { try { return new Intl.DisplayNames(["en-GB"], {type: "language"}); } catch (e) { return null; } })();
function langName(code) {
  if (!code || code === "xx") return "Not English";
  try { const n = LANG_NAMES && LANG_NAMES.of(code); if (n && n.toLowerCase() !== code) return n; } catch (e) { /* unknown code */ }
  return code.toUpperCase();
}
/* "A", "A and B", "A, B and C". */
const andList = xs => xs.length < 2 ? (xs[0] || "") : xs.slice(0, -1).join(", ") + " and " + xs[xs.length - 1];
const plural = (n, one, many) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many || one + "s"}`;
/* Wide screens get side-by-side layouts; phones get one column and a tab bar at the bottom. */
const wide = () => { try { return matchMedia("(min-width: 700px)").matches; } catch (e) { return true; } };
/* Added to the iPhone or Android home screen: its own window, with its own storage and sign-in. */
const isStandalone = () => { try { return navigator.standalone === true || matchMedia("(display-mode: standalone)").matches; } catch (e) { return false; } };
/* The phone's share sheet where there is one (Messages, WhatsApp, Instagram…), otherwise copy the link. Returns true
   when the share sheet took it. Call it straight from a tap: browsers only allow sharing in answer to one. */
async function shareLink(data) {
  if (navigator.share) {
    try { await navigator.share(data); return true; } catch (e) { if (e && e.name === "AbortError") return true; }
  }
  try { await navigator.clipboard.writeText(data.url); toast("Link copied"); } catch (e) { window.prompt("Copy this link", data.url); }
  return false;
}

/* ---------- State ---------- */
let FILMS = [], BY = new Map(), SEED = new Map(), NEIGH = new Map(), FEAT = new Map(), ALIAS = new Map(), DATA_CHECKED = null;
let state = normState(store.get(KEY_STATE));
let M = {aff: new Map(), cnt: new Map(), signals: 0};
/* Filters shared by For you and the Watchlist: q search, svc services (any of), dir director, tag feature, gore, len,
   sort. loose shows every search match whatever the filters. rf, rq and rsort belong to Rated. film is the film whose
   details are open; sheet is the open filter sheet. */
const ui = {view: "for", q: "", svc: new Set(), dir: "", gore: "any", len: "any", sort: "match", tag: null, shown: PAGE, loose: false,
  rating: new Set(), focus: null, rf: "all", rq: "", rsort: "recent", roll: 0, wild: new Set(), film: null, sheet: null, base: []};
const undo = [];
let cfg = state.cfg;

function defaultCfg() { return JSON.parse(JSON.stringify(DEFAULT_CFG)); }
function normState(s) {
  const out = {v: 3, films: {}, cfg: defaultCfg()};
  if (!s || typeof s !== "object") return out;
  for (const [id, e] of Object.entries(s.films || {})) {
    if (!e || typeof e !== "object") continue;
    const n = {t: String(e.t || "")};
    const sc = Number.isInteger(e.s) && e.s >= 1 && e.s <= 10 ? e.s : LEGACY[e.r] || (typeof e.score === "number" && e.score > 0 ? clamp(Math.round(e.score), 1, 10) : 0);
    if (sc) { n.s = sc; n.r = tierOf(sc); }
    if (e.seen || n.s) n.seen = 1;
    if (e.w && !n.s) n.w = 1;
    if (e.x && !n.s) n.x = 1;
    if (e.src) n.src = String(e.src);
    if (e.f && typeof e.f === "object" && e.f.t) n.f = e.f;
    out.films[id] = n;
  }
  if (s.cfg && typeof s.cfg === "object") {
    const c = defaultCfg();
    out.cfg = {svc: Object.assign({}, s.cfg.svc || c.svc), free: s.cfg.free === 0 ? 0 : 1, hide: Object.assign({}, s.cfg.hide || {}),
      theme: ["auto", "dark", "light"].includes(s.cfg.theme) ? s.cfg.theme : "auto", share: s.cfg.share === 1 ? 1 : 0,
      en: s.cfg.en === 1 ? 1 : 0, t: String(s.cfg.t || "")};
  }
  return out;
}
const EMPTY = Object.freeze({});
/* Your entry for a film. The original single-user page's profile ratings (SEED, from films.json) no longer apply to
   everyone: they're only offered as an import (account.js) to the browsers that used that page. */
function eff(id) {
  return state.films[id] || EMPTY;
}
const sig = e => e.s ? SCORE_SIG[e.s] : e.x ? SIG_PASS : e.w ? SIG_WANT : null;
const isDone = e => !!(e.s || e.seen);
/* A compact copy of a film travels with your rating, so it keeps teaching the model (and stays in Rated, synopsis
   and all) even after the film drops out of the daily pool. Films added from TMDB also carry their TMDB id, poster
   and the services TMDB lists, so they work before the nightly rebuild takes them in. */
const SNAP_KEYS = ["t", "y", "jid", "px", "tg", "ta", "dir", "co", "g", "ge", "fl", "rn", "im", "rt", "imdb", "jw", "d", "lg", "ot", "tm", "tp"];
const snapVal = v => v !== undefined && v !== null && !(Array.isArray(v) && !v.length);
function snap(f) {
  const s = {};
  if (f) SNAP_KEYS.forEach(k => { if (snapVal(f[k])) s[k] = f[k]; });
  if (f && f.tm && Array.isArray(f.o) && f.o.length) s.o = f.o.map(o => [o[0], "", null]).slice(0, 12);
  return s;
}
/* Older copies lack newer keys (the synopsis, the language): fill the gaps from today's pool, never overwriting. */
function topUpSnaps() {
  let changed = false;
  for (const [id, e] of Object.entries(state.films)) {
    const f = BY.get(id);
    if (!e.f || !f || f.gone) continue;
    for (const k of SNAP_KEYS) if (e.f[k] === undefined && snapVal(f[k])) { e.f[k] = f[k]; changed = true; }
  }
  if (changed) saveLocal();
}
function setEntry(id, entry, label) {
  undo.push({id, prev: state.films[id] ? Object.assign({}, state.films[id]) : null});
  if (undo.length > 30) undo.shift();
  if (entry.s || entry.w || entry.x) entry.f = (state.films[id] && state.films[id].f) || snap(BY.get(id));
  state.films[id] = Object.assign({t: nowISO()}, entry);
  saveLocal();
  queuePush([id]);
  refresh();
  if (label) toast(label, true);
}
/* Guests keep their list in this browser; signed-in lists are cached here too and saved to the account. */
function saveLocal() { persistState(); }

/* ---------- Data ---------- */
const V1_SUBS = {"Prime Video": "pv", "Shudder": "sh", "Netflix": "nf", "Disney+": "dp", "NOW": "nowc", "HBO Max": "hbo", "Paramount+": "pp", "Apple TV+": "atv", "MUBI": "mubi"};
const V1_FREE = {"Tubi": "tubi", "Plex": "plex", "Pluto TV": "pluto", "Channel 4": "c4", "BBC iPlayer": "bbc", "ITVX": "itvx", "Rakuten TV": "rakuten", "YouTube": "ytf"};
const V1_TAG = {ff: "found-footage", lim: "liminal", cre: "creature", folk: "folk", claus: "claustrophobic"};
function fromV1(f) {
  const o = [];
  (f.subs || []).forEach(n => V1_SUBS[n] && o.push([V1_SUBS[n], "", null]));
  (f.free || []).forEach(n => V1_FREE[n] && o.push([V1_FREE[n], "", null]));
  (f.channels || []).forEach(n => o.push(["ch:" + n, "", null]));
  const price = s => s ? parseFloat(String(s).replace(/[^0-9.]/g, "")) : null;
  return {id: f.id, t: f.t, y: f.y, jw: f.jw, im: f.imdb, rt: f.rt, g: f.g, tg: V1_TAG[f.v] ? [V1_TAG[f.v]] : [], o,
    rent: f.rent ? [price(f.rent), "", ""] : null, buy: f.buy ? [price(f.buy), ""] : null, cur: 1, p: f.p, w: f.w, aka: f.aka};
}
function prepare(data) {
  FILMS = (data.films || []).map(f => data.v === 2 ? f : fromV1(f)).filter(f => f && f.id && f.t);
  BY = new Map(FILMS.map(f => [f.id, f]));
  // A film someone added from TMDB that the nightly rebuild later found under its JustWatch id lists the old id here.
  ALIAS = new Map();
  FILMS.forEach(f => (f.al || []).forEach(a => { if (typeof a === "string" && !BY.has(a)) ALIAS.set(a, f.id); }));
  SEED = new Map(FILMS.filter(f => toScore(f.seed)).map(f => [f.id, toScore(f.seed)]));
  NEIGH = new Map();
  const link = (a, b) => { if (!BY.has(a) || !BY.has(b) || a === b) return; if (!NEIGH.has(a)) NEIGH.set(a, new Set()); NEIGH.get(a).add(b); };
  FILMS.forEach(f => (f.sim || []).forEach(j => { link(f.id, j); link(j, f.id); }));
  FEAT = new Map(FILMS.map(f => [f.id, features(f)]));
  DATA_CHECKED = data.checked ? new Date(data.checked) : null;
  topUpSnaps();
  adoptGone();
  buildDirs();
}
/* Move entries filed under an alias to the film's real id (newest change wins, as in sync). */
function migrateAliases() {
  const moved = [];
  for (const [from, to] of ALIAS) {
    const e = state.films[from];
    if (!e || !(e.s || e.seen || e.w || e.x)) continue;
    const cur = state.films[to];
    if (!cur || !(cur.s || cur.seen || cur.w || cur.x) || String(e.t || "") > String(cur.t || "")) {
      state.films[to] = Object.assign({}, e, {t: nowISO(), f: (cur && cur.f) || snap(BY.get(to)) || e.f});
    }
    state.films[from] = {t: nowISO()};
    moved.push(from, to);
  }
  if (moved.length) { saveLocal(); queuePush(moved); }
  return moved.length / 2;
}
/* Every director in the pool, most films first, for search suggestions. */
let DIRS = [];
function buildDirs() {
  const n = new Map();
  FILMS.forEach(f => (f.dir || []).forEach(d => n.set(d, (n.get(d) || 0) + 1)));
  DIRS = [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
/* Films you rated, wanted or passed that are no longer in today's pool come back from the copy saved with the rating.
   Films added from TMDB come back the same way, with the services TMDB listed, until the nightly rebuild has them. */
function adoptGone() {
  let added = 0;
  for (const [id, e] of Object.entries(state.films)) {
    if (!e.f || BY.has(id) || ALIAS.has(id)) continue;
    if (!(e.s || e.seen || e.w || e.x)) continue;
    const f = Object.assign({id, o: []}, e.f);
    if (!f.tm) { f.gone = 1; f.o = []; } else { f.added = 1; f.o = Array.isArray(f.o) ? f.o : []; }
    FILMS.push(f);
    BY.set(id, f);
    FEAT.set(id, features(f));
    added++;
  }
  return added;
}
function era(y) { return y >= 2020 ? "2020s" : y >= 2010 ? "2010s" : y >= 2000 ? "2000s" : y >= 1990 ? "1990s" : y >= 1980 ? "1980s" : "pre-1980"; }
/* Where a film is from, for the model. JustWatch lists co-producing countries alphabetically, so the language decides
   first and the countries only break ties. */
function regionOf(f) {
  const co = f.co || [];
  if (f.lg) {
    const l = f.lg;
    if (l === "es") return co.some(c => LATAM.has(c)) && !co.includes("ES") ? "latam" : "spain";
    if (l === "fr") return co.includes("CA") && !co.includes("FR") && !co.includes("BE") ? "canada" : "france";
    if (l === "pt") return co.includes("BR") ? "latam" : "other";
    if (LANG_REGION[l]) return LANG_REGION[l];
    const r = co.map(c => REGION[c]).find(r => r && !["uk-ie", "us", "canada", "anz"].includes(r));
    return r || "other";
  }
  if (!co.length) return null;
  if (co.includes("AU") || co.includes("NZ")) return "anz";
  if (co.includes("US")) return "us";
  if (co.includes("GB") || co.includes("IE")) return "uk-ie";
  if (co.includes("CA")) return "canada";
  return REGION[co[0]] || "other";
}
function features(f) {
  const m = new Map(), add = (k, w) => { if (!(m.get(k) >= w)) m.set(k, w); };
  (f.tg || []).forEach(t => add("t:" + t, 1));
  (f.ta || []).forEach(t => add("t:" + t, 0.6));
  (f.dir || []).forEach(d => add("d:" + d, 1));
  if (f.y) add("e:" + era(f.y), 0.5);
  const reg = regionOf(f);
  if (reg) add("c:" + reg, 0.4);
  if (f.lg) add("l:sub", 0.35);
  if (f.g && f.g !== "U") add("g:" + f.g, f.ge ? 0.5 : 0.9);
  (f.fl || []).forEach(x => add("f:" + x, 1));
  if (f.rn) { if (f.rn < 90) add("r:short", 0.3); else if (f.rn > 125) add("r:long", 0.3); }
  return [...m];
}
function featLabel(k) {
  const [kind, ...rest] = k.split(":"), v = rest.join(":");
  if (kind === "t") return TAGS[v] || v;
  if (kind === "d") return "Dir. " + v;
  if (kind === "e") return v === "pre-1980" ? "Pre-1980 films" : v + " films";
  if (kind === "c") return REGION_LABEL[v] || v;
  if (kind === "g") return GORE[v] + " gore";
  if (kind === "f") return FLAGS[v] || v;
  if (kind === "r") return v === "short" ? "Under 90 minutes" : "Over two hours";
  if (kind === "l") return "Subtitled films";
  return k;
}

/* ---------- Model ----------
   Each film is a bag of weighted features (tags, director, era, region, gore, flags, length). Your affinity for a
   feature is the shrunk mean of your signals on films that have it: a score's signal (SCORE_SIG, -2.5 for a 1 up to
   +2.5 for a 10), want +0.6, pass -1, pulled toward 0 (or a small prior) until there is evidence. A film's fit is the sum of its
   feature affinities over the square root of its feature mass. JustWatch's similar-titles graph adds a boost for
   neighbours of films you rated, and IMDb/Rotten Tomatoes add a small quality term. */
/* Learn feature affinities from [features, signal] pairs. Shared by your own model and, in Together, everyone's. */
function learnFrom(items) {
  const num = new Map(), den = new Map(), cnt = new Map();
  let signals = 0;
  for (const [feats, s] of items) {
    if (s == null || !feats) continue;
    signals++;
    for (const [k, w] of feats) {
      num.set(k, (num.get(k) || 0) + s * w);
      den.set(k, (den.get(k) || 0) + w);
      cnt.set(k, (cnt.get(k) || 0) + 1);
    }
  }
  const aff = new Map();
  new Set([...den.keys(), ...Object.keys(PRIOR)]).forEach(k => aff.set(k, (SHRINK * (PRIOR[k] || 0) + (num.get(k) || 0)) / (SHRINK + (den.get(k) || 0))));
  return {aff, cnt, signals};
}
function learn() {
  M = learnFrom(FILMS.map(f => [FEAT.get(f.id), sig(eff(f.id))]));
}
function quality(f) {
  let q = 0;
  if (typeof f.im === "number") q += 0.35 * clamp((f.im - 6.3) / 0.8, -2, 2) * Math.min(1, (f.iv || 0) / 6000 + (f.cur || f.seed ? 1 : 0));
  if (typeof f.rt === "number") q += 0.2 * clamp((f.rt - 75) / 20, -2, 1.5);
  return q;
}
const matchPct = T => Math.round(100 / (1 + Math.exp(-1.25 * (T - 1.25))));
/* Feature fit of a film under a model, and how much of it the model hasn't seen yet. */
function fitOf(model, f) {
  let s = 0, mass = 0, unk = 0;
  for (const [k, w] of FEAT.get(f.id) || []) {
    s += w * (model.aff.get(k) || 0); mass += w; unk += w / (1 + (model.cnt.get(k) || 0));
  }
  return {fit: mass ? s / Math.sqrt(mass) : 0, unk: mass ? unk / mass : 1};
}
/* Boost from JustWatch's similar-titles graph: neighbours of films with a strong signal. sigOf(id) gives the signal. */
function neighbourBoost(sigOf, f) {
  let nb = 0, pos = null, neg = null, best = 0, worst = 0;
  for (const j of NEIGH.get(f.id) || []) {
    const sj = sigOf(j);
    if (sj == null || Math.abs(sj) < 0.9) continue;
    nb += 0.35 * sj;
    if (sj > best) { best = sj; pos = j; }
    if (sj < worst) { worst = sj; neg = j; }
  }
  return {nb: clamp(nb, -1.2, 1.2), pos, neg};
}
function scoreFilm(f) {
  const {fit, unk} = fitOf(M, f);
  const {nb, pos, neg} = neighbourBoost(id => sig(eff(id)), f);
  f._fit = fit; f._nb = nb; f._q = quality(f); f._pos = pos; f._neg = neg; f._unk = unk;
  f._T = fit + nb + f._q;
  f._m = matchPct(f._T);
}
function scoreAll() {
  for (const f of FILMS) scoreFilm(f);
}
function reasons(f) {
  const pos = [], neg = [];
  if (f._pos && f._nb > 0.15) pos.push("Like " + BY.get(f._pos).t);
  if (f._neg && f._nb < -0.15) neg.push("Like " + BY.get(f._neg).t);
  const parts = FEAT.get(f.id).filter(([k]) => !k.startsWith("f:") && !k.startsWith("r:")).map(([k, w]) => [k, w * (M.aff.get(k) || 0)]).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  for (const [k, v] of parts) {
    if (v > 0.3 && pos.length < 3 && !k.startsWith("g:") && k !== "c:us") pos.push(featLabel(k));
    else if (v < -0.3 && neg.length < 2) neg.push(featLabel(k));
  }
  return {pos, neg, flags: (f.fl || []).map(x => FLAGS[x] || x)};
}

/* ---------- Availability ---------- */
function avail(f) {
  const own = [], free = [], other = [];
  for (const o of f.o || []) {
    if (cfg.svc[o[0]]) own.push(o);
    else if (isFree(o[0])) (cfg.free ? free : other).push(o);
    else other.push(o);
  }
  own.sort((a, b) => OWNABLE.indexOf(a[0]) - OWNABLE.indexOf(b[0]));
  const fo = k => { const i = FREE_ORDER.indexOf(k); return i < 0 ? 99 : i; };
  free.sort((a, b) => fo(a[0]) - fo(b[0]));
  other.sort((a, b) => (OWNABLE.indexOf(a[0]) + 1 || 50) - (OWNABLE.indexOf(b[0]) + 1 || 50));
  const leave = own.length && own.every(o => o[2]) ? own.map(o => o[2]).sort().pop() : null;
  const tonight = own.length > 0 || free.length > 0;
  return {own, free, other, leave, tonight};
}
/* Film data can come from other people (profiles, shared lists), so links are only ever built on known hosts. */
const safePath = p => typeof p === "string" && /^\/[a-z]{2}\/[a-z0-9-]+(\/[a-z0-9-]+)*$/.test(p);
const jwLink = f => safePath(f.jw) ? "https://www.justwatch.com" + f.jw : "https://www.justwatch.com/uk/search?q=" + encodeURIComponent(f.t);
/* The services you pay for, in words: "Netflix, Prime Video and 3 more, or free". */
function servicesPhrase() {
  const own = OWNABLE.filter(k => cfg.svc[k]), both = own.includes("hbo") && own.includes("nowe");
  const names = own.filter(k => !(both && k === "hbo")).map(k => both && k === "nowe" ? "NOW" : SVC[k].n);
  const list = names.length > 3 ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} more` : andList(names);
  if (!names.length) return cfg.free ? "free TV" : "";
  return list + (cfg.free ? ", or free" : "");
}

/* ---------- Filtering and ranking ---------- */
const isCandidate = f => { const e = eff(f.id); return !e.s && !e.seen && !e.x && !f.gone; };
const hiddenByFlags = f => (f.fl || []).some(x => cfg.hide[x]);
function hasFeature(f, key) { return FEAT.get(f.id).some(([k]) => k === key); }
/* Search matches the start of words in the title, original title, directors, tags, year and language, so "rec"
   finds [REC] but not Resurrection. */
function hay(f) {
  if (f._hay === undefined) {
    f._hay = " " + foldKey([f.t, f.aka, f.ot, (f.dir || []).join(" "), (f.tg || []).concat(f.ta || []).map(t => TAGS[t] || t).join(" "),
      String(f.y || ""), f.lg ? langName(f.lg) + " subtitled" : ""].join(" "));
  }
  return f._hay;
}
function matchesQuery(f, q) {
  const h = hay(f);
  return foldKey(q).split(" ").filter(Boolean).every(w => h.includes(" " + w));
}
/* Title matches first when searching: exact, then starts with, then contains. */
function relevance(f, q) {
  const k = foldKey(q);
  if (!k) return 0;
  const names = [f.t, f.aka, f.ot].filter(Boolean).map(foldKey);
  return names.some(n => n === k) ? 3 : names.some(n => n.startsWith(k)) ? 2 : names.some(n => n.includes(k)) ? 1 : 0;
}
/* Services. A token is a service key ("nf", "ch:Arrow Video"; "hbo|nowe" for either), or tonight, free, rent or subs. */
function svcMatch(f, tok) {
  if (tok === "tonight") return avail(f).tonight;
  if (tok === "free") return (f.o || []).some(o => isFree(o[0]));
  if (tok === "rent") return !!f.rent && !avail(f).tonight;
  if (tok === "subs") { const a = avail(f); return !a.tonight && a.other.some(o => !isFree(o[0])); }
  const keys = tok.split("|");
  return (f.o || []).some(o => keys.includes(o[0]));
}
const onAnySvc = f => !ui.svc.size || [...ui.svc].some(t => svcMatch(f, t));
const lookup = () => !!(ui.q || ui.dir);
/* Anything narrowing the list (not the sort, and not English-only, which is a standing preference). */
const filtering = () => lookup() || !!ui.tag || ui.svc.size > 0 || ui.gore !== "any" || ui.len !== "any";
/* basic: only the standing preferences (content flags, gore, English only), for Tonight, the strips and the planner.
   loose: only the search and director, so a search can show what the filters hide. skipSvc: everything but services. */
function passes(f, opts) {
  const o = opts || {};
  if (!o.loose) {
    if (hiddenByFlags(f)) return false;
    if (ui.gore !== "any" && GORE_RANK[f.g || "M"] > GORE_RANK[ui.gore]) return false;
    if (cfg.en && f.lg) return false;
    if (o.basic) return true;
  }
  if (ui.q && !matchesQuery(f, ui.q)) return false;
  if (ui.dir && !(f.dir || []).includes(ui.dir)) return false;
  if (o.loose) return true;
  if (ui.len === "100" && f.rn && f.rn > 100) return false;
  if (ui.tag && !hasFeature(f, ui.tag)) return false;
  if (!o.skipSvc && !onAnySvc(f)) return false;
  return true;
}
const SORTS = {
  match: (a, b) => b._T - a._T,
  imdb: (a, b) => (b.im || 0) - (a.im || 0) || b._T - a._T,
  rt: (a, b) => (b.rt || 0) - (a.rt || 0) || b._T - a._T,
  new: (a, b) => (b.y || 0) - (a.y || 0) || b._T - a._T,
  short: (a, b) => (a.rn || 999) - (b.rn || 999) || b._T - a._T,
  leaving: (a, b) => (avail(a).leave || "9999") .localeCompare(avail(b).leave || "9999") || b._T - a._T
};
function diversify(list) {
  const out = [], defer = [];
  for (const f of list) {
    while (defer.length && out.length - defer[0].at >= 6) out.push(defer.shift().f);
    const d = (f.dir || [])[0];
    if (d && out.slice(-10).filter(x => (x.dir || [])[0] === d).length >= 2) defer.push({f, at: out.length});
    else out.push(f);
  }
  return out.concat(defer.map(x => x.f));
}
/* For you. Browsing shows unseen films; a search or a director also brings back what you've seen, rated or passed,
   so nothing you look for vanishes. Returns the list, the films the service filter counts against, and how many
   matches the filters are hiding. */
function forYouList() {
  const look = lookup(), loose = look && ui.loose;
  const base = FILMS.filter(f => (look || isCandidate(f)) && passes(f, loose ? {loose: true} : {skipSvc: true}));
  const pool = loose ? base : base.filter(onAnySvc);
  const cmp = SORTS[ui.sort] || SORTS.match;
  let list = pool.slice();
  ui.wild = new Set();
  if (look) {
    const rel = ui.q ? new Map(list.map(f => [f.id, relevance(f, ui.q)])) : null;
    const done = f => isDone(eff(f.id)) ? 1 : 0;
    list.sort((a, b) => (rel ? rel.get(b.id) - rel.get(a.id) : 0) || (!ui.q ? done(a) - done(b) || (eff(b.id).s || 0) - (eff(a.id).s || 0) : 0) || cmp(a, b));
  } else {
    list.sort(cmp);
    if (ui.sort === "match" && !ui.tag) {
      list = diversify(list);
      const head = new Set(list.slice(0, 120).map(f => f.id));
      const wild = pool.filter(f => f._unk >= 0.4 && f._q >= 0.15 && f._m >= 45 && !head.has(f.id))
        .sort((a, b) => (b._q + 1.3 * b._unk + 0.3 * b._fit) - (a._q + 1.3 * a._unk + 0.3 * a._fit));
      const used = new Set();
      for (let pos = WILD_EVERY - 1, i = 0; pos < list.length && i < wild.length; pos += WILD_EVERY, i++) {
        const w = wild[i];
        if (used.has(w.id)) continue;
        list = list.filter(x => x.id !== w.id);
        list.splice(pos, 0, w);
        used.add(w.id);
        ui.wild.add(w.id);
      }
    }
  }
  const hidden = look && !loose ? FILMS.filter(f => passes(f, {loose: true})).length - list.length : 0;
  return {list, base, hidden};
}

/* ---------- Rendering: shared pieces ---------- */
const posterOk = f => f.px && typeof f.jid === "string" && /^[a-z]{1,4}\d{1,12}$/.test(f.jid);
const TP_RE = /^\/[A-Za-z0-9_-]{6,64}\.(jpg|png)$/;
/* Self-hosted JustWatch thumbnails; films added from TMDB use TMDB's poster through our own image proxy until then. */
function posterSrc(f, big) {
  if (posterOk(f)) return `/p/${f.jid}.webp`;
  if (typeof f.tp === "string" && TP_RE.test(f.tp)) return `/api/img/${big ? "w342" : "w154"}${f.tp}`;
  return null;
}
function posterHTML(f, cls, w, h) {
  const src = posterSrc(f, w > 80);
  return src ? `<img class="${cls}" src="${esc(src)}" alt="" loading="lazy" decoding="async" width="${w}" height="${h}">`
    : `<span class="${cls} blank" aria-hidden="true">?</span>`;
}
function matchClass(m) { return m >= 85 ? "hot" : m < 50 ? "cool" : ""; }
const offerA = (f, o, cls, label) => `<a class="watch ${cls}" href="${esc(o[1] || jwLink(f))}" target="_blank" rel="noopener noreferrer">${label}</a>`;
/* The main watch button: your services first, then free, rent, other subscriptions. With a service filter on, the
   filtered service wins. */
function watchHTML(f, a) {
  if (f.gone) return `<a class="watch other" href="${esc(jwLink(f))}" target="_blank" rel="noopener noreferrer">Check JustWatch</a>`;
  if (ui.svc.size) {
    const keys = [...ui.svc].flatMap(t => t.split("|"));
    const o = (f.o || []).find(o => keys.includes(o[0]) || (keys.includes("free") && isFree(o[0])));
    if (o) return cfg.svc[o[0]] ? offerA(f, o, "mine", `Watch on ${esc(svcName(o[0]))}`)
      : isFree(o[0]) ? offerA(f, o, "free", `Free on ${esc(svcName(o[0]))}`) : offerA(f, o, "other", `On ${esc(svcName(o[0]))}`);
  }
  if (a.own.length) return offerA(f, a.own[0], "mine", `Watch on ${esc(svcName(a.own[0][0]))}`);
  if (a.free.length) return offerA(f, a.free[0], "free", `Free on ${esc(svcName(a.free[0][0]))}`);
  const sub = a.other.find(o => !isFree(o[0]));
  if (f.rent) {
    const href = f.rent[2] || jwLink(f);
    return `<a class="watch rent" href="${esc(href)}" target="_blank" rel="noopener noreferrer">Rent £${f.rent[0].toFixed(2)}${f.rent[1] ? " on " + esc(f.rent[1]) : ""}</a>${sub ? `<span class="alt">or on ${esc(svcName(sub[0]))}</span>` : ""}`;
  }
  if (sub) return offerA(f, sub, "other", `On ${esc(svcName(sub[0]))}`);
  if (f.buy) return `<a class="watch rent" href="${esc(jwLink(f))}" target="_blank" rel="noopener noreferrer">Buy £${f.buy[0].toFixed(2)}</a>`;
  if (f.cin) return `<span class="watch other">In cinemas</span>`;
  if (f.added) return `<a class="watch other" href="${esc(jwLink(f))}" target="_blank" rel="noopener noreferrer">Check JustWatch</a>`;
  return `<span class="watch none">Not streaming in the UK</span>`;
}
function factsHTML(f, full) {
  const bits = [];
  if (typeof f.im === "number") bits.push(`<span>IMDb <b>${f.im.toFixed(1)}</b></span>`);
  if (typeof f.rt === "number" && (full || wide())) bits.push(`<span>RT <b>${f.rt}%</b></span>`);
  if (f.rn) bits.push(`<span>${runtime(f.rn)}</span>`);
  if (f.lg) bits.push(`<span class="lang" title="Original language: subtitled">${esc(langName(f.lg))}</span>`);
  const g = f.g || "M";
  bits.push(`<span class="gore g-${esc(g)}" title="${esc(GORE[g])} gore${f.ge ? ", estimated" : ""}">Gore ${f.ge ? "~" : ""}${esc(g)}</span>`);
  return `<span class="facts">${bits.join("")}</span>`;
}
function dirHTML(f) {
  const ds = (f.dir || []).slice(0, 2);
  return ds.length ? `<span class="by">${ds.map(d => `<button type="button" class="dirlink" data-act="dir" data-key="${esc(d)}" aria-pressed="${ui.dir === d}" title="${ui.dir === d ? "Show every director" : "Only films by " + esc(d)}">${esc(d)}</button>`).join(" &amp; ")}</span>` : "";
}
function badgesHTML(f, a) {
  const b = [], e = eff(f.id);
  if (ui.view === "profile" && typeof theirBadge === "function") b.push(theirBadge(f));
  if (e.x) b.push(`<span class="badge">Passed</span>`);
  if (f.p && !isDone(e)) b.push(`<span class="badge pick">Start here</span>`);
  if (ui.wild.has(f.id)) b.push(`<span class="badge wild" title="Picked to test something the model hasn't learned yet">Wildcard</span>`);
  if (f.added) b.push(`<span class="badge" title="Added from TMDB. Full UK availability arrives with tomorrow morning's refresh.">Added</span>`);
  if (f.nw && daysUntil(f.nw[0]) >= -NEW_DAYS && (cfg.svc[f.nw[1]] || (cfg.free && isFree(f.nw[1])))) b.push(`<span class="badge new">New on ${esc(svcName(f.nw[1]))}</span>`);
  if (a.leave && daysUntil(a.leave) <= SOON_DAYS) b.push(`<span class="badge leave">Leaves ${esc(shortDate(a.leave))}</span>`);
  if (f.cin && !a.tonight) b.push(`<span class="badge">In cinemas</span>`);
  return b.join("");
}
/* Ten cells that fill up to your score, like a level meter. Keys 1–9, and 0 for 10. */
function rateHTML(f, cur, removable) {
  const cells = [];
  for (let n = 1; n <= 10; n++) {
    cells.push(`<button type="button" data-act="rate" data-rate="${n}" class="${n <= cur ? "on" : ""}" aria-pressed="${cur === n}" aria-label="${n} out of 10, ${SCORE_WORD[n]}" data-w="${esc(SCORE_WORD[n])}" title="${n} · ${esc(SCORE_WORD[n])} (key ${n % 10})">${n}</button>`);
  }
  const word = cur ? esc(cur + " · " + SCORE_WORD[cur]) : "Rate it out of 10";
  return `<span class="rate10${cur ? " " + scoreClass(cur) : ""}" role="group" aria-label="Rate ${esc(f.t)} out of 10"><span class="cells">${cells.join("")}</span>` +
    `<span class="rfoot">${removable ? `<button type="button" class="clear" data-act="clear" title="Remove your rating">Remove</button>` : ""}<span class="rword" data-cur="${word}">${word}</span></span></span>`;
}
function actsHTML(f) {
  const e = eff(f.id);
  if (ui.rating.has(f.id) || isDone(e)) {
    return rateHTML(f, e.s || 0, isDone(e)) + (isDone(e) ? "" : `<button type="button" class="act quiet" data-act="cancel">Cancel</button>`);
  }
  return `<button type="button" class="act" data-act="want" aria-pressed="${!!e.w}" title="Add to watchlist (w)">${e.w ? "Wanted" : "Want"}</button>` +
    `<button type="button" class="act quiet" data-act="pass" aria-pressed="${!!e.x}" title="${e.x ? "Undo pass" : "Not for me"} (x)">${e.x ? "Passed" : "Pass"}</button>` +
    `<button type="button" class="act" data-act="seen" title="Seen it: rate it (s, or 1–9 and 0)">Seen it</button>`;
}
/* The match number (or your score) down the left edge. */
function leftHTML(f) {
  const e = eff(f.id);
  if (e.s) return `<div class="m sc ${scoreClass(e.s)}" title="Your rating: ${e.s}/10, ${esc(SCORE_WORD[e.s])}"><b>${e.s}</b><small>/10</small></div>`;
  if (e.seen) return `<div class="m" title="Seen, not rated yet"><b class="cool">--</b></div>`;
  return `<div class="m" title="Predicted match: how well it fits your taste"><b class="${matchClass(f._m)}">${f._m}</b><small>%</small></div>`;
}
function whyHTML(f) {
  if (isDone(eff(f.id))) return (f.tg || []).concat(f.ta || []).slice(0, 4).map(t => `<span>${esc(TAGS[t] || t)}</span>`).join("");
  const r = reasons(f);
  return r.pos.map(x => `<span class="p">${esc(x)}</span>`).join("") + r.neg.map(x => `<span class="n">${esc(x)}</span>`).join("") +
    r.flags.map(x => `<span class="f">${esc(x)}</span>`).join("");
}
/* A film in a list: compact. The full synopsis, where to watch, tags and the rest open in the details sheet. */
function rowHTML(f, opts) {
  const o = opts || {}, e = eff(f.id), a = avail(f), done = isDone(e);
  const badges = badgesHTML(f, a), line = o.line !== undefined ? o.line : whyHTML(f), pitch = f.w || f.d || "";
  return `<article class="film${done ? " done" : ""}${ui.focus === f.id ? " is-focus" : ""}" data-id="${esc(f.id)}" tabindex="-1">
    ${o.left || leftHTML(f)}
    <button type="button" class="pstb" data-act="open" tabindex="-1" aria-hidden="true">${posterHTML(f, "pst", 46, 69)}</button>
    <div class="main">
      <h3><button type="button" class="ttl" data-act="open" aria-haspopup="dialog">${esc(f.t)}</button><span class="yr">${esc(f.y || "")}</span></h3>
      <p class="sub1">${dirHTML(f)}${factsHTML(f)}</p>
      ${badges ? `<p class="badges">${badges}</p>` : ""}
      ${pitch ? `<p class="pitch">${esc(pitch)}</p>` : ""}
      ${line ? `<p class="why">${line}</p>` : ""}
    </div>
    <div class="side"><span class="wbox">${watchHTML(f, a)}</span><span class="acts">${o.acts || actsHTML(f)}</span></div>
  </article>`;
}

/* ---------- The details sheet ---------- */
function filmSheetHTML(f) {
  const e = eff(f.id), a = avail(f), done = isDone(e);
  const offers = [];
  a.own.forEach(o => offers.push(`<li><a class="own" href="${esc(o[1] || jwLink(f))}" target="_blank" rel="noopener noreferrer">${esc(svcName(o[0]))}</a><small>${o[2] ? "until " + esc(shortDate(o[2])) : "yours"}</small></li>`));
  a.free.forEach(o => offers.push(`<li><a href="${esc(o[1] || jwLink(f))}" target="_blank" rel="noopener noreferrer">${esc(svcName(o[0]))}</a><small>free${o[0] === "bbc" ? ", TV licence" : ""}${o[2] ? " until " + esc(shortDate(o[2])) : ""}</small></li>`));
  a.other.forEach(o => {
    const s = SVC[o[0]], extra = o[0].startsWith("ch:") ? "Prime Video channel" : s && s.p ? `£${s.p.toFixed(2)} a month` : isFree(o[0]) ? "free" : "subscription";
    offers.push(`<li><a href="${esc(o[1] || jwLink(f))}" target="_blank" rel="noopener noreferrer">${esc(svcName(o[0]))}</a><small>${esc(extra)}</small></li>`);
  });
  if (f.rent) offers.push(`<li>${f.rent[2] ? `<a href="${esc(f.rent[2])}" target="_blank" rel="noopener noreferrer">Rent on ${esc(f.rent[1] || "store")}</a>` : "Rent"}<small>£${f.rent[0].toFixed(2)}</small></li>`);
  if (f.buy) offers.push(`<li>Buy on ${esc(f.buy[1] || "store")}<small>£${f.buy[0].toFixed(2)}</small></li>`);
  if (!offers.length) offers.push(f.gone ? `<li>No longer in the daily pool. Check JustWatch for where it streams now.</li>`
    : f.added ? `<li>Nothing listed yet. Tomorrow morning’s refresh checks every UK service.</li>` : `<li>Not streaming, rentable or in cinemas in the UK right now</li>`);
  const tags = [...(f.tg || []).map(t => [t, 0]), ...(f.ta || []).map(t => [t, 1])].map(([t, auto]) => {
    const v = M.aff.get("t:" + t) || 0;
    return `<button type="button" class="tag${auto ? " auto" : ""}${v > 0.3 ? " pos" : v < -0.3 ? " neg" : ""}" data-act="tag" data-key="t:${esc(t)}" title="${auto ? "Auto-tagged. " : ""}Your affinity ${v >= 0 ? "+" : ""}${v.toFixed(2)}. Tap to see more like it.">${esc(TAGS[t] || t)}</button>`;
  }).join("");
  const sims = [...(NEIGH.get(f.id) || [])].map(id => BY.get(id)).filter(Boolean)
    .sort((x, y) => (sig(eff(y.id)) || 0) - (sig(eff(x.id)) || 0) || y._T - x._T).slice(0, 8)
    .map(s => { const se = eff(s.id); return `<button type="button" data-act="openid" data-id2="${esc(s.id)}">${esc(s.t)} <span class="${se.s ? "r" : ""}">${se.s ? se.s + "/10" : s._m + "%"}</span></button>`; }).join("");
  const meta = [];
  if (e.s) meta.push(`<dt>Your rating</dt><dd><b class="${scoreClass(e.s)}">${e.s}/10</b> ${esc(SCORE_WORD[e.s])}<small>${e.src === "profile" ? " · imported profile rating" : e.t ? " · " + esc(new Date(e.t).toLocaleDateString("en-GB", {day: "numeric", month: "short", year: "numeric"})) : ""}</small></dd>`);
  if ((f.dir || []).length) meta.push(`<dt>Director</dt><dd>${f.dir.map(d => `<button type="button" class="tag" data-act="dir" data-key="${esc(d)}" title="Only films by ${esc(d)}">${esc(d)}</button>`).join(" ")}</dd>`);
  if (f.lg) meta.push(`<dt>Language</dt><dd>${esc(langName(f.lg))}, subtitled</dd>`);
  if (f.ot) meta.push(`<dt>Original title</dt><dd>${esc(f.ot)}</dd>`);
  if ((f.co || []).length) meta.push(`<dt>Made in</dt><dd>${esc(f.co.join(", "))}</dd>`);
  if (f.ce) meta.push(`<dt>Certificate</dt><dd>${esc(f.ce)}</dd>`);
  if (f.rn) meta.push(`<dt>Runtime</dt><dd>${runtime(f.rn)}</dd>`);
  if (typeof f.rt === "number") meta.push(`<dt>Rotten Tomatoes</dt><dd>${f.rt}%</dd>`);
  if (f.aka) meta.push(`<dt>Also</dt><dd>${esc(f.aka)}</dd>`);
  const links = [`<a href="${esc(jwLink(f))}" target="_blank" rel="noopener noreferrer">JustWatch</a>`];
  if (/^tt\d{5,10}$/.test(f.imdb || "")) links.push(`<a href="https://www.imdb.com/title/${esc(f.imdb)}/" target="_blank" rel="noopener noreferrer">IMDb</a>`, `<a href="https://letterboxd.com/imdb/${esc(f.imdb)}/" target="_blank" rel="noopener noreferrer">Letterboxd</a>`);
  if (Number.isInteger(f.tm)) links.push(`<a href="https://www.themoviedb.org/movie/${f.tm}" target="_blank" rel="noopener noreferrer">TMDB</a>`);
  links.push(`<a href="https://www.youtube.com/results?search_query=${encodeURIComponent(f.t + " " + (f.y || "") + " trailer")}" target="_blank" rel="noopener noreferrer">Trailer</a>`);
  const pct = n => (n >= 0 ? "+" : "−") + Math.abs(n).toFixed(2);
  const r = done ? null : reasons(f);
  const why = r ? r.pos.map(x => `<span class="p">${esc(x)}</span>`).join("") + r.neg.map(x => `<span class="n">${esc(x)}</span>`).join("") + r.flags.map(x => `<span class="f">${esc(x)}</span>`).join("") : "";
  const score = e.s ? `<span class="fs-score ${scoreClass(e.s)}"><b>${e.s}</b>/10 <small>${esc(SCORE_WORD[e.s])}</small></span>`
    : e.seen ? `<span class="fs-score"><b class="cool">--</b> <small>Seen, not rated</small></span>`
    : `<span class="fs-score"><b class="${matchClass(f._m)}">${f._m}%</b> <small>match for you</small></span>`;
  return `<div class="fs-head">
      ${posterHTML(f, "fs-pst", 110, 165)}
      <div class="fs-ttl">
        ${score}
        <h2 id="fd-h">${esc(f.t)} <span class="yr">${esc(f.y || "")}</span></h2>
        <p class="sub1">${dirHTML(f)}${factsHTML(f, true)}</p>
        <p class="badges">${badgesHTML(f, a)}</p>
      </div>
    </div>
    <div class="fs-acts"><span class="wbox">${watchHTML(f, a)}</span><span class="acts">${actsHTML(f)}</span>
      ${typeof shareBtnHTML === "function" ? shareBtnHTML(f) : ""}</div>
    ${f.w ? `<p class="fs-pitch">${esc(f.w)}</p>` : ""}
    ${f.d ? `<h4>Synopsis</h4><p>${esc(f.d)}</p>` : !f.w ? `<h4>Synopsis</h4><p class="hint">No synopsis saved for this one.</p>` : ""}
    <h4>Where to watch in the UK</h4><ul class="offers">${offers.join("")}</ul>
    ${done ? "" : `<h4>Why ${f._m}%</h4>${why ? `<p class="why">${why}</p>` : ""}
      <div class="calc"><span>Taste fit</span><b>${pct(f._fit)}</b><span>Similar films you rated</span><b>${pct(f._nb)}</b><span>Critics</span><b>${pct(f._q)}</b><span>Score</span><b>${pct(f._T)}</b></div>`}
    <h4>Tags</h4><div class="tagrow">${tags || '<span class="hint">None yet</span>'}</div>
    ${sims ? `<h4>Similar films</h4><div class="simrow">${sims}</div>` : ""}
    ${meta.length ? `<h4>Details</h4><dl>${meta.join("")}</dl>` : ""}
    ${typeof listPickHTML === "function" ? listPickHTML(f) : ""}
    <h4>Links</h4><div class="links">${links.join("")}</div>`;
}
function openFilm(id) {
  if (!BY.has(id) && ALIAS.has(id)) id = ALIAS.get(id);
  if (!BY.has(id)) return;
  const d = $("filmDlg"), was = ui.film;
  ui.film = id;
  renderFilmSheet();
  if (!d.open) { showDlg(d); setTimeout(() => { const c = $("closeFilm"); if (c && !wide()) c.focus({preventScroll: true}); }, 30); }
  if (was !== id) $("fdBody").scrollTop = 0;
}
/* Kept for older calls: opening a film from anywhere now opens its details. */
const jump = id => openFilm(id);
function renderFilmSheet() {
  const box = $("fdBody"), f = ui.film && BY.get(ui.film);
  if (!box || !f) return;
  const act = document.activeElement, inside = act && box.contains(act);
  const sel = inside && act.dataset && act.dataset.act ? `[data-act="${CSS.escape(act.dataset.act)}"]${act.dataset.rate ? `[data-rate="${CSS.escape(act.dataset.rate)}"]` : ""}` : null;
  const top = box.scrollTop;
  box.dataset.id = f.id;
  box.innerHTML = filmSheetHTML(f);
  box.scrollTop = top;
  if (sel) { const el = box.querySelector(sel); if (el) el.focus({preventScroll: true}); }
}
/* Native dialogs, with the page behind them held still. */
function showDlg(d) {
  if (typeof d.showModal === "function") { if (!d.open) d.showModal(); } else d.setAttribute("open", "");
  document.documentElement.classList.add("modal-open");
}
function hideDlg(d) {
  if (!d) return;
  if (typeof d.close === "function") { if (d.open) d.close(); } else d.removeAttribute("open");
}
function dlgClosed() {
  if (![...document.querySelectorAll("dialog")].some(d => d.open)) document.documentElement.classList.remove("modal-open");
}

/* ---------- Views ---------- */
function renderTonight() {
  const box = $("tonight"), phrase = servicesPhrase();
  const lab = (sub, roll) => `<div class="lab"><h2><i class="rec" aria-hidden="true"></i>Watch tonight</h2>${roll ? `<button type="button" class="act quiet roll" data-act="roll" title="Another pick (r)">Another</button>` : ""}<p class="sub">${sub}</p></div>`;
  if (!phrase) {
    box.innerHTML = lab(`Tell the Dread List which services you pay for, and this picks the best unseen film you can watch right now.`) +
      `<p class="none"><button type="button" class="btn" data-set-open="services">Pick your services</button></p>`;
    return;
  }
  const change = `<button type="button" class="linkish" data-set-open="services">Change</button>`;
  const pool = FILMS.filter(f => isCandidate(f) && passes(f, {basic: true}) && avail(f).tonight).sort(SORTS.match);
  if (!pool.length) { box.innerHTML = lab(`Your best unseen match on ${esc(phrase)}. ${change}`) + `<p class="none">Nothing unseen is on your services right now.</p>`; return; }
  const top = pool.slice(0, 6), f = top[ui.roll % top.length], a = avail(f);
  box.innerHTML = lab(`Your best unseen match on ${esc(phrase)}. ${change}`, top.length > 1) +
    `<div class="film-lite" data-id="${esc(f.id)}">
      <button type="button" class="tpst" data-act="open" tabindex="-1" aria-hidden="true">${posterHTML(f, "", 92, 138)}</button>
      <div class="tbody">
        <p class="tt"><span class="big">${f._m}%</span> <button type="button" data-act="open" aria-haspopup="dialog">${esc(f.t)}</button> <span class="yr">${esc(f.y || "")}</span></p>
        <div class="meta">${watchHTML(f, a)}${factsHTML(f)}</div>
        <p class="tp">${esc(f.w || f.d || "")}</p>
        <div class="acts">${actsHTML(f)}</div>
      </div>
    </div>`;
}
function renderStrips() {
  const c = FILMS.filter(f => isCandidate(f) && passes(f, {basic: true}));
  const fresh = c.filter(f => f.nw && daysUntil(f.nw[0]) >= -NEW_DAYS && (cfg.svc[f.nw[1]] || (cfg.free && isFree(f.nw[1]))) && (f.o || []).some(o => o[0] === f.nw[1]))
    .sort(SORTS.match).slice(0, 8);
  const leaving = c.map(f => [f, avail(f).leave]).filter(([, l]) => l && daysUntil(l) <= SOON_DAYS).sort((x, y) => y[0]._T - x[0]._T).slice(0, 8);
  const li = (f, when, soon) => `<li><button type="button" data-act="openid" data-id2="${esc(f.id)}" aria-haspopup="dialog">${posterHTML(f, "", 56, 84)}<span class="mm ${matchClass(f._m)}">${f._m}%</span><span class="st">${esc(f.t)}<small>${esc(f.y || "")}</small></span><span class="when${soon ? " soon" : ""}">${esc(when)}</span></button></li>`;
  $("strips").innerHTML = `<section class="strip"><h2>New on your services</h2><p class="sub">Added in the last two weeks</p>
      ${fresh.length ? `<ol>${fresh.map(f => li(f, `${svcName(f.nw[1])}, ${shortDate(f.nw[0])}`)).join("")}</ol>` : `<p class="empty">Nothing new that fits you this fortnight.</p>`}</section>
    <section class="strip"><h2>Leaving soon</h2><p class="sub">Last chance on your services</p>
      ${leaving.length ? `<ol>${leaving.map(([f, l]) => li(f, `Leaves ${shortDate(l)}`, daysUntil(l) <= 7)).join("")}</ol>` : `<p class="empty">Nothing you’d want is leaving this month.</p>`}</section>`;
}
/* ---------- Search and filters (For you and the Watchlist) ----------
   One search box for titles, directors and tags, with suggestions; filter buttons underneath. Where to watch opens a
   sheet (it takes several services at once); gore, length, language and sort are native pickers. */
const GORE_OPTS = [["any", "Any gore"], ["H", "Gore ≤ high"], ["M", "Gore ≤ medium"], ["L", "Low gore"]];
const LEN_OPTS = [["any", "Any length"], ["100", "Under 100 min"]];
const LANG_OPTS = [["0", "Any language"], ["1", "English only"]];
const SORT_OPTS = [["match", "Best match"], ["imdb", "IMDb score"], ["rt", "RT score"], ["new", "Newest"], ["short", "Shortest"], ["leaving", "Leaving soon"]];
const RSORT_OPTS = [["recent", "Recently rated"], ["high", "Highest first"], ["low", "Lowest first"], ["az", "A–Z"], ["year", "Newest film"]];
/* Service tokens: Watch tonight, each service you pay for (NOW and HBO Max as one), Free and Rent. */
function svcTokens() {
  const own = OWNABLE.filter(k => cfg.svc[k]), both = own.includes("hbo") && own.includes("nowe");
  const toks = [["tonight", "Watch tonight", "On the services you pay for, or free"]];
  own.forEach(k => {
    if (both && k === "nowe") return;
    toks.push(both && k === "hbo" ? ["hbo|nowe", "NOW & HBO Max", "NOW Entertainment, which includes HBO Max"] : [k, SVC[k].n, "Yours"]);
  });
  toks.push(["free", "Free", "BBC iPlayer, Channel 4, ITVX, My5, Tubi and more"], ["rent", "Rent", "Not on your services, but rentable"]);
  return toks;
}
const tokName = k => k === "subs" ? "Other subscriptions" : k === "tonight" ? "Watch tonight" : k === "free" ? "Free" : k === "rent" ? "Rent" : k.split("|").map(svcName).join(" & ");
/* Every other service in the pool, most films first, to add to the filter. */
function moreSvcHTML(fixedKeys) {
  const n = new Map();
  FILMS.forEach(f => { if (!f.gone) (f.o || []).forEach(o => { if (!fixedKeys.has(o[0]) && !ui.svc.has(o[0])) n.set(o[0], (n.get(o[0]) || 0) + 1); }); });
  const groups = [["Subscriptions", k => !isFree(k) && !k.startsWith("ch:")], ["Prime Video channels", k => k.startsWith("ch:")], ["Free services", k => isFree(k)]];
  return `<select id="svcMore" aria-label="Add another service"><option value="">Add another service…</option>` +
    (ui.svc.has("subs") ? "" : `<option value="subs">Any subscription you don’t have</option>`) +
    groups.map(([label, test]) => {
      const ks = [...n].filter(([k]) => test(k)).sort((a, b) => b[1] - a[1] || svcName(a[0]).localeCompare(svcName(b[0])));
      return ks.length ? `<optgroup label="${label}">${ks.map(([k, c]) => `<option value="${esc(k)}">${esc(svcName(k))} · ${c}</option>`).join("")}</optgroup>` : "";
    }).join("") + `</select>`;
}
function pillSelect(id, label, opts, cur, def) {
  return `<label class="pill sel${cur !== def ? " on" : ""}"><span class="sr">${esc(label)}</span><select id="${id}">${opts.map(([v, l]) => `<option value="${esc(v)}"${cur === v ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label>`;
}
function whereLabel() {
  if (!ui.svc.size) return "Where to watch";
  const names = [...ui.svc].map(tokName);
  return names.length > 1 ? `${names[0]} +${names.length - 1}` : names[0];
}
const SEARCH_ICON = `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>`;
function barHTML() {
  return `<div class="sq">${SEARCH_ICON}<input type="search" id="q" placeholder="Search films, directors, subgenres" value="${esc(ui.q)}" aria-label="Search films, directors and subgenres" autocomplete="off" spellcheck="false" enterkeyhint="search" aria-autocomplete="list" aria-controls="suggest">
      <div class="suggest" id="suggest" hidden></div></div>
    <div class="pills" role="group" aria-label="Filters and sort">
      <button type="button" class="pill${ui.svc.size ? " on" : ""}" data-sheet="where" aria-haspopup="dialog">${esc(whereLabel())}</button>
      ${pillSelect("fGore", "Gore", GORE_OPTS, ui.gore, "any")}
      ${pillSelect("fLen", "Length", LEN_OPTS, ui.len, "any")}
      ${pillSelect("fLang", "Language", LANG_OPTS, cfg.en ? "1" : "0", "0")}
      ${pillSelect("sort", "Sort", SORT_OPTS, ui.sort, "match")}
    </div>
    <p class="count" id="count"></p>`;
}
/* As you type: matching directors and subgenres to filter by, and (with TMDB switched on) a search of every film. */
function suggestHTML(q) {
  const k = foldKey(q);
  if (k.length < 2) return "";
  const starts = s => { const f = foldKey(s); return f.startsWith(k) || f.split(" ").some(w => w.startsWith(k)); };
  const dirs = DIRS.filter(([d]) => starts(d)).slice(0, 4);
  const tags = Object.entries(TAGS).filter(([, l]) => starts(l)).slice(0, 3);
  let html = "";
  if (dirs.length) html += `<p class="sg-h">Directors</p>` + dirs.map(([d, c]) => `<button type="button" class="sg" data-act="dir" data-key="${esc(d)}">${esc(d)}<small>${plural(c, "film")}</small></button>`).join("");
  if (tags.length) html += `<p class="sg-h">Subgenres</p>` + tags.map(([t, l]) => `<button type="button" class="sg" data-act="tag" data-key="t:${esc(t)}">${esc(l)}</button>`).join("");
  if (typeof findOn === "function" && findOn()) html += `<button type="button" class="sg web" data-act="find">Search every film for “${esc(q.trim())}”<small>Add anything that isn’t in the Dread List yet</small></button>`;
  return html;
}
function showSuggest(on) {
  const s = $("suggest"), q = $("q");
  if (!s || !q) return;
  const html = on ? suggestHTML(q.value) : "";
  s.innerHTML = html;
  s.hidden = !html;
}
function chipsHTML() {
  const x = (act, label, sr) => `<button type="button" class="chipx" data-act="${act}">${esc(label)} <b aria-hidden="true">×</b><span class="sr">${sr}</span></button>`;
  return (ui.dir ? x("undir", "Dir. " + ui.dir, "Clear the director") : "") + (ui.tag ? x("untag", featLabel(ui.tag), "Clear the tag filter") : "") +
    (filtering() ? `<button type="button" class="linkish clearall" data-act="clearall">Clear all</button>` : "");
}
/* The Where to watch sheet: tap services on and off; the counts are the films each would leave. */
function whereSheetHTML() {
  const toks = svcTokens(), fixed = new Set(toks.map(t => t[0])), fixedKeys = new Set(toks.flatMap(t => t[0].split("|")));
  const extra = [...ui.svc].filter(k => !fixed.has(k)), base = ui.base || [];
  const cnt = k => base.filter(f => svcMatch(f, k)).length.toLocaleString("en-GB");
  const opt = (k, label, tip, removable) => `<button type="button" class="opt" data-act="svc" data-key="${esc(k)}" aria-pressed="${ui.svc.has(k)}"><span>${esc(label)}${tip ? `<small>${esc(tip)}</small>` : ""}</span><span class="c">${removable ? "×" : cnt(k)}</span></button>`;
  const n = ui.view === "want" ? FILMS.filter(f => { const e = eff(f.id); return e.w && !isDone(e) && passes(f); }).length : forYouList().list.length;
  return `<p class="hint">Pick one or more. <b>Watch tonight</b> means on the services you pay for, or free.</p>
    <div class="opts">
      <button type="button" class="opt" data-act="svcall" aria-pressed="${!ui.svc.size}"><span>Anywhere</span><span class="c">${base.length.toLocaleString("en-GB")}</span></button>
      ${toks.map(([k, l, t]) => opt(k, l, t)).join("")}${extra.map(k => opt(k, tokName(k), "", true)).join("")}
    </div>
    <div class="more-svc">${moreSvcHTML(fixedKeys)}</div>
    <div class="sheet-foot"><button type="button" class="btn" data-close>Show ${plural(n, "film")}</button><button type="button" class="linkish" data-set-open="services">Change the services you pay for</button></div>`;
}
function openSheet(kind) {
  ui.sheet = kind;
  const d = $("sheet");
  $("sheet-h").textContent = kind === "where" ? "Where to watch" : "";
  renderSheet();
  showDlg(d);
}
function renderSheet() {
  const d = $("sheet");
  if (!d || !ui.sheet) return;
  const act = document.activeElement, inside = act && d.contains(act);
  const sel = inside && act.dataset && act.dataset.key ? `[data-act="${CSS.escape(act.dataset.act || "")}"][data-key="${CSS.escape(act.dataset.key)}"]` : inside && act.id ? "#" + CSS.escape(act.id) : null;
  if (ui.sheet === "where") $("sheetBody").innerHTML = whereSheetHTML();
  if (sel) { const el = d.querySelector(sel); if (el) el.focus({preventScroll: true}); }
}
function renderFor(keepBar) {
  if (!keepBar) $("barFor").innerHTML = barHTML();
  const browsing = !filtering();
  $("tonight").hidden = !browsing;
  $("strips").hidden = !browsing;
  if (browsing) { renderTonight(); renderStrips(); }
  const {list, base, hidden} = forYouList(), shown = list.slice(0, ui.shown), look = lookup();
  ui.base = base;
  const seen = look ? list.filter(f => isDone(eff(f.id))).length : 0;
  const n = list.length.toLocaleString("en-GB");
  $("forHead").innerHTML = browsing ? `<div class="sect"><h2>Ranked for you</h2><span>${n} unseen films, best match first</span></div>` : "";
  $("listFor").innerHTML = shown.length ? shown.map(f => rowHTML(f)).join("") :
    `<p class="empty">${look ? (hidden ? "No matches with these filters." : `Nothing in the Dread List matches${ui.q ? ` “${esc(ui.q)}”` : ""}.`) : `Nothing matches. ${ui.tag ? "Clear the tag filter" : "Loosen a filter"} to see more.`}</p>` +
    (look && ui.q && typeof findOn === "function" && findOn() ? `<p class="empty-find"><button type="button" class="btn" data-act="find">Search every film for “${esc(ui.q)}”</button></p>` : "");
  $("moreFor").hidden = list.length <= ui.shown;
  $("count").innerHTML = (browsing ? "" : look ? `<span>${n} match${list.length === 1 ? "" : "es"}${seen ? `, ${seen} you’ve seen` : ""}</span>` : `<span>${shown.length < list.length ? `${shown.length} of ` : ""}${n} unseen film${list.length === 1 ? "" : "s"}</span>`) + chipsHTML() +
    (hidden ? `<button type="button" class="chipx more-x" data-act="loose">+ ${hidden} hidden by filters</button>` : "") +
    (look && ui.loose ? `<button type="button" class="chipx" data-act="unloose">Filters off <b aria-hidden="true">×</b><span class="sr">Turn the filters back on</span></button>` : "") +
    (look && ui.q && list.length && typeof findOn === "function" && findOn() ? `<button type="button" class="linkish" data-act="find">Not here? Search every film</button>` : "");
}
function renderWant(keepBar) {
  ui.wild = new Set();
  if (!keepBar) $("barWant").innerHTML = barHTML();
  const all = FILMS.filter(f => { const e = eff(f.id); return e.w && !isDone(e); });
  const base = all.filter(f => passes(f, {skipSvc: true}));
  ui.base = base;
  const list = base.filter(onAnySvc).sort(SORTS[ui.sort] || SORTS.match);
  $("count").innerHTML = `<span>${list.length === all.length ? `${all.length} film${all.length === 1 ? "" : "s"} on your watchlist` : `${list.length} of ${all.length} on your watchlist`}</span>` + chipsHTML();
  if (!all.length) { $("listWant").innerHTML = `<p class="empty">Tap Want on anything in For you and it lands here, ranked by match and grouped by where you can watch it.</p>`; return; }
  if (!list.length) { $("listWant").innerHTML = `<p class="empty">Nothing on your watchlist matches these filters.</p>`; return; }
  const groups = [["Watch tonight", f => avail(f).tonight], ["Rent", f => !avail(f).tonight && f.rent], ["On other services", f => !avail(f).tonight && !f.rent && avail(f).other.length], ["Not streaming", () => true]];
  const seen = new Set();
  $("listWant").innerHTML = groups.map(([name, test]) => {
    const g = list.filter(f => !seen.has(f.id) && test(f));
    g.forEach(f => seen.add(f.id));
    return g.length ? `<div class="sect"><h2>${esc(name)}</h2><span>${g.length}${name === "Watch tonight" ? ` · on ${esc(servicesPhrase() || "your services")}` : ""}</span></div>` + g.map(f => rowHTML(f)).join("") : "";
  }).join("");
}
const RSORTS = {
  recent: (a, b) => String(eff(b.id).t || "").localeCompare(String(eff(a.id).t || "")) || (eff(b.id).s || 0) - (eff(a.id).s || 0) || a.t.localeCompare(b.t),
  high: (a, b) => (eff(b.id).s || 0) - (eff(a.id).s || 0) || String(eff(b.id).t || "").localeCompare(String(eff(a.id).t || "")) || a.t.localeCompare(b.t),
  low: (a, b) => (eff(a.id).s || 11) - (eff(b.id).s || 11) || a.t.localeCompare(b.t),
  az: (a, b) => a.t.localeCompare(b.t, "en-GB", {sensitivity: "base"}),
  year: (a, b) => (b.y || 0) - (a.y || 0) || a.t.localeCompare(b.t)
};
function renderRated(keepHead) {
  ui.wild = new Set();
  const all = FILMS.filter(f => isDone(eff(f.id)));
  const counts = Array(11).fill(0);
  let sum = 0, n = 0;
  all.forEach(f => { const s = eff(f.id).s; if (s) { counts[s]++; sum += s; n++; } });
  const unrated = all.length - n, max = Math.max(1, ...counts.slice(1));
  if (!keepHead) {
    const cols = [];
    for (let s = 1; s <= 10; s++) {
      cols.push(`<button type="button" class="col ${scoreClass(s)}" data-act="rf" data-v="${s}" aria-pressed="${ui.rf === String(s)}" title="${s} · ${esc(SCORE_WORD[s])}: ${counts[s]} film${counts[s] === 1 ? "" : "s"}"${counts[s] ? "" : " disabled"}><em>${counts[s] || ""}</em><i data-h="${(counts[s] / max).toFixed(3)}"></i><span>${s}</span></button>`);
    }
    $("ratedHead").innerHTML = `<div class="sq">${SEARCH_ICON}<input type="search" id="rq" placeholder="Search your ratings" value="${esc(ui.rq)}" aria-label="Search your ratings" autocomplete="off" spellcheck="false" enterkeyhint="search"></div>
      <div class="hist" role="group" aria-label="Filter by score"><button type="button" class="all" data-act="rf" data-v="all" aria-pressed="${ui.rf === "all"}">All<span>${all.length}</span></button>${cols.join("")}${unrated ? `<button type="button" class="all" data-act="rf" data-v="unrated" aria-pressed="${ui.rf === "unrated"}">Unrated<span>${unrated}</span></button>` : ""}</div>
      <div class="pills">${pillSelect("rsort", "Sort", RSORT_OPTS, ui.rsort, "recent")}</div>
      <p class="count" id="rcount"></p>`;
    document.querySelectorAll("#ratedHead .hist i").forEach(i => i.style.setProperty("--h", i.dataset.h));
  }
  const rf = ui.rf;
  const list = all.filter(f => { const s = eff(f.id).s; return (rf === "all" || (rf === "unrated" ? !s : s === Number(rf))) && (!ui.rq || matchesQuery(f, ui.rq)); })
    .sort(RSORTS[ui.rsort] || RSORTS.recent);
  $("listRated").innerHTML = list.length ? list.map(f => rowHTML(f)).join("") : `<p class="empty">${all.length ? "Nothing here matches." : "No ratings yet. Press Seen it on anything you’ve watched."}</p>`;
  $("rcount").innerHTML = `<span>${list.length === all.length ? `${all.length} film${all.length === 1 ? "" : "s"}` : `${list.length} of ${all.length}`}${n ? `, average ${(sum / n).toFixed(1)}` : ""}</span>` +
    `<span class="sub">Change a score and the model relearns instantly.</span>`;
}
function barsHTML(rows, max) {
  return `<ul class="bars">${rows.map(([k, v, n]) => {
    const isTag = k.startsWith("t:") || k.startsWith("d:");
    const label = isTag ? `<button type="button" class="lbl" data-act="tag" data-key="${esc(k)}">${esc(featLabel(k))}</button>` : `<span class="lbl">${esc(featLabel(k))}</span>`;
    return `<li>${label}<span class="trk"><i class="${v < 0 ? "neg" : ""}" data-w="${Math.min(1, Math.abs(v) / max).toFixed(3)}"></i></span><span class="v">${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}</span><span class="c" title="Films with this">${n || 0}</span></li>`;
  }).join("")}</ul>`;
}
function planner() {
  const cands = FILMS.filter(f => isCandidate(f) && passes(f, {basic: true}) && f._m >= 60 && !avail(f).tonight).sort(SORTS.match).slice(0, 150);
  const left = new Set(cands.map(f => f.id)), picks = [];
  for (let step = 0; step < 3; step++) {
    const by = new Map();
    for (const f of cands) {
      if (!left.has(f.id)) continue;
      for (const o of avail(f).other) {
        if (isFree(o[0])) continue;
        if (!by.has(o[0])) by.set(o[0], []);
        by.get(o[0]).push(f);
      }
    }
    let best = null;
    for (const [k, fs] of by) {
      const value = fs.reduce((s, f) => s + f._m / 100, 0), price = (SVC[k] && SVC[k].p) || (k.startsWith("ch:") ? 5 : 7);
      const score = value / price;
      if (fs.length >= 3 && (!best || score > best.score)) best = {k, fs, value, price, score};
    }
    if (!best) break;
    picks.push(best);
    best.fs.forEach(f => left.delete(f.id));
  }
  return picks;
}
function renderTaste() {
  const feats = [...M.aff.entries()].filter(([k]) => (M.cnt.get(k) || 0) >= 2 || PRIOR[k]);
  const pos = feats.filter(([k, v]) => v > 0.15 && !k.startsWith("g:")).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => [k, v, M.cnt.get(k)]);
  const neg = feats.filter(([k, v]) => v < -0.1 && !k.startsWith("g:")).sort((a, b) => a[1] - b[1]).slice(0, 10).map(([k, v]) => [k, v, M.cnt.get(k)]);
  const gore = ["L", "M", "H", "X"].map(g => ["g:" + g, M.aff.get("g:" + g) || 0, M.cnt.get("g:" + g)]);
  const rated = FILMS.filter(f => eff(f.id).s), wants = FILMS.filter(f => { const e = eff(f.id); return e.w && !isDone(e); }).length;
  const passed = FILMS.filter(f => eff(f.id).x).length, tonight = FILMS.filter(f => isCandidate(f) && passes(f, {basic: true}) && avail(f).tonight).length;
  const avg = rated.length ? (rated.reduce((x, f) => x + eff(f.id).s, 0) / rated.length).toFixed(1) : "–";
  const plan = planner();
  $("taste").innerHTML = `
    <div class="stats">
      <div><b>${rated.length}</b><span>rated</span></div><div><b>${avg}</b><span>average score</span></div><div><b>${wants}</b><span>wanted</span></div><div><b>${passed}</b><span>passed</span></div>
      <div><b>${FILMS.filter(f => !f.gone && !f.added).length.toLocaleString("en-GB")}</b><span>films in the pool</span></div><div><b>${tonight}</b><span>unseen, watch tonight</span></div>
    </div>
    <div class="taste-grid">
      <section><h2>What pulls you in</h2><p>Learned from your ratings, wants and passes. Tap one to filter For you by it.</p>${pos.length ? barsHTML(pos, 2) : `<p class="hint">Rate a few films to see this.</p>`}</section>
      <section><h2>What pushes you away</h2><p>Negative affinity. These sink films down the list rather than hiding them.</p>${neg.length ? barsHTML(neg, 2) : `<p class="hint">Nothing yet. Pass on or score a few films low.</p>`}
        <h2 class="gap">Gore tolerance</h2><p>Your affinity for each gore level. Extreme starts slightly negative until your own ratings say otherwise.</p>${barsHTML(gore, 2)}</section>
    </div>
    <section class="taste-plan"><h2>Rotate in this month</h2><p class="sub">Your best unseen matches that aren’t on your services, and the cheapest single subscription that unlocks most of them. Cancel after a month, then rotate.</p>
      ${plan.length ? `<ol class="plan">${plan.map(p => {
        const s = SVC[p.k] || {};
        return `<li><h3>${esc(svcName(p.k))}<span>${s.p ? `£${s.p.toFixed(2)} a month` : p.k.startsWith("ch:") ? "Prime Video channel" : ""}${s.note ? `, ${esc(s.note)}` : ""}</span></h3>
          <p>${p.fs.length} of your top unseen matches, average ${Math.round(p.fs.reduce((x, f) => x + f._m, 0) / p.fs.length)}%: <span class="films">${p.fs.slice(0, 6).map(f => esc(f.t)).join(", ")}${p.fs.length > 6 ? "…" : ""}</span></p></li>`;
      }).join("")}</ol>` : `<p class="hint">Everything you’d want is already on your services or free.</p>`}
      <p class="sub">Prices checked October 2026.</p></section>
    <div class="how">
      <p><b>How the recommendations work.</b> Every film is a bag of features: subgenre tags (hand-picked, from Wikidata and from the synopsis), director, decade, where it’s from, whether it’s subtitled, gore level and length. Each button you press is a signal: scores run from −2.5 for a 1 (Hated) through −0.5 for a 5 (Meh) and +1 for a 7 (Liked) to +2.5 for a 10 (Favourite); Want is +0.6 and Pass −1. Your affinity for a feature is the average signal across films that have it, pulled toward zero until there’s enough evidence.</p>
      <p>A film’s score adds up its feature affinities, a boost when JustWatch lists it as similar to something you rated, and a small nudge from IMDb and Rotten Tomatoes. Every seventh slot is a wildcard: a well-reviewed film built from features you haven’t rated yet, so the model keeps learning instead of narrowing.</p>
      <p>The pool rebuilds every morning from JustWatch UK: popular, trending and newly added horror, everything near films people chose to share (Settings, Help grow the pool), films people added from TMDB, and the hand-picked list. ${FILMS.filter(f => f.cur).length} films are hand-picked. <a href="/about">More about the Dread List</a></p>
    </div>`;
  document.querySelectorAll("#taste .trk i").forEach(i => i.style.setProperty("--w", i.dataset.w));
}

/* ---------- Refresh orchestration ---------- */
function counts() {
  const w = FILMS.filter(f => { const e = eff(f.id); return e.w && !isDone(e); }).length;
  const r = FILMS.filter(f => isDone(eff(f.id))).length;
  $("nWant").textContent = w ? w : "";
  $("nRated").textContent = r ? r : "";
  if (typeof renderNote === "function") renderNote();
}
function refresh(opts) {
  if (FILMS.length) { topUpSnaps(); if (adoptGone()) buildDirs(); }
  learn();
  scoreAll();
  counts();
  renderView(opts);
  if (ui.film && $("filmDlg").open) renderFilmSheet();
  if (ui.sheet && $("sheet").open) renderSheet();
}
function renderView(opts) {
  const v = ui.view, keep = !!(opts && opts.keepBar);
  document.querySelectorAll(".view").forEach(s => { s.hidden = s.id !== "view-" + v; });
  document.querySelectorAll(".tabs a").forEach(a => a.setAttribute("aria-current", a.dataset.view === v ? "page" : "false"));
  document.body.dataset.view = v;
  // The bar lives in whichever of For you and the Watchlist is showing, so its ids stay unique.
  if (v !== "for") $("barFor").innerHTML = "";
  if (v !== "want") $("barWant").innerHTML = "";
  const y = window.scrollY;
  if (v === "for") renderFor(keep && !!$("q"));
  else if (v === "want") renderWant(keep && !!$("q"));
  else if (v === "rated") renderRated(keep && !!$("rq"));
  else if (v === "together") renderTogether(keep);
  else if (v === "profile") renderProfile(keep);
  else if (v === "welcome" && typeof renderWelcome === "function") renderWelcome();
  else renderTaste();
  if (opts && opts.keepScroll !== false) window.scrollTo(0, y);
}
/* Views: #for, #want, #rated, #together (and #together/<list id>), #taste, #welcome, and public profiles at /u/<name>. */
let routedPath = location.pathname;
function route() {
  routedPath = location.pathname;
  const pm = /^\/u\/([A-Za-z0-9_-]{1,40})\/?$/.exec(location.pathname);
  const h = (location.hash || (typeof firstVisit === "function" && firstVisit() ? "#welcome" : "#for")).slice(1);
  let next = "for", film = null;
  if (pm) { next = "profile"; ui.profileName = pm[1].toLowerCase(); }
  else if (/^together(\/[A-Za-z0-9_-]{16})?$/.test(h)) { next = "together"; ui.listId = h.split("/")[1] || null; }
  else if (/^film=[a-z0-9][a-z0-9-]{0,79}$/.test(h)) { film = h.slice(5); history.replaceState(null, "", location.pathname + "#for"); }
  else if (["for", "want", "rated", "taste", "welcome"].includes(h)) next = h;
  if (next !== ui.view) { ui.q = ""; ui.loose = false; }
  ui.view = next;
  ui.focus = null;
  refresh({keepScroll: false});
  window.scrollTo(0, 0);
  // A shared link to one film (/#film=<id>) opens its details over For you.
  if (film) { if (BY.has(film) || ALIAS.has(film)) openFilm(film); else toast("That film isn’t in the Dread List any more."); }
}
/* Go to a view from anywhere, including from a profile page (a different path) without reloading. */
function go(hash) {
  if (location.pathname !== "/") { history.pushState(null, "", "/" + hash); route(); }
  else if (location.hash !== hash) location.hash = hash;
  else route();
}

/* ---------- Actions ---------- */
function act(id, what, extra) {
  const f = BY.get(id);
  if (!f) return;
  const e = eff(id);
  if (what === "want") setEntry(id, e.w ? {} : {w: 1}, e.w ? `Removed ${f.t} from your watchlist` : `Added ${f.t} to your watchlist`);
  else if (what === "pass") setEntry(id, e.x ? {} : {x: 1}, e.x ? `Unpassed ${f.t}` : `Passed on ${f.t}`);
  else if (what === "seen") { ui.rating.add(id); refresh({keepBar: true}); focusRow(id); }
  else if (what === "cancel") { ui.rating.delete(id); refresh({keepBar: true}); }
  else if (what === "rate") {
    const s = clamp(Math.round(Number(extra)) || 0, 1, 10);
    ui.rating.delete(id);
    setEntry(id, {s, r: tierOf(s), seen: 1}, `${f.t}: ${s}/10, ${SCORE_WORD[s]}`);
  }
  else if (what === "clear") setEntry(id, {}, `Removed your rating for ${f.t}`);
}
function undoLast() {
  const u = undo.pop();
  if (!u) { toast("Nothing to undo"); return; }
  state.films[u.id] = Object.assign({}, u.prev || {}, {t: nowISO()});
  saveLocal();
  queuePush([u.id]);
  refresh({keepBar: true});
  toast("Undone");
}
let toastTimer = null;
/* The toast is a popover, so it shows above an open sheet too (sheets sit in the browser's top layer). */
function toast(text, canUndo) {
  const t = $("toast");
  $("toastText").textContent = text;
  $("toastUndo").hidden = !canUndo;
  t.hidden = false;
  if (t.showPopover) { try { if (t.matches(":popover-open")) t.hidePopover(); t.showPopover(); } catch (e) { /* not supported */ } }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; if (t.hidePopover) { try { t.hidePopover(); } catch (e) { /* closed */ } } }, 5000);
}
function focusRow(id) {
  ui.focus = id;
  document.querySelectorAll(".film.is-focus").forEach(n => n.classList.remove("is-focus"));
  const row = document.querySelector(`.view:not([hidden]) .film[data-id="${CSS.escape(id)}"]`);
  if (row) { row.classList.add("is-focus"); row.focus({preventScroll: true}); row.scrollIntoView({block: "nearest"}); }
}
/* Filter the list from anywhere (a director or tag in the details sheet, a suggestion): close the sheet, show For you
   (or keep the Watchlist), and bring the list into view. */
function filterTo(patch) {
  hideDlg($("filmDlg"));
  Object.assign(ui, {shown: PAGE, loose: false}, patch);
  showSuggest(false);
  if (ui.view !== "for" && ui.view !== "want") go("#for"); else refresh();
  const bar = $(ui.view === "want" ? "barWant" : "barFor");
  if (bar && bar.getBoundingClientRect().top < 0) window.scrollTo(0, Math.max(0, bar.offsetTop - 70));
}
function setDir(name) { filterTo({dir: name || ""}); }
function refocus(sel) {
  const el = document.querySelector(`.view:not([hidden]) ${sel}`);
  if (el) el.focus();
}

/* ---------- Events ---------- */
function wire() {
  window.addEventListener("hashchange", route);
  window.addEventListener("popstate", () => { if (location.pathname !== routedPath) route(); });
  // Tabs and the brand are links to /#view; on a profile page, switch views without a reload.
  document.addEventListener("click", e => {
    const a = e.target.closest(".tabs a, a.brand");
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    const hash = new URL(a.href).hash;
    if (location.pathname !== "/") { e.preventDefault(); go(hash); }
  });
  // A poster that fails to load (e.g. a film that has left the pool) becomes a blank tile instead of a broken image.
  document.addEventListener("error", e => {
    const t = e.target;
    if (t && t.tagName === "IMG" && !t.dataset.dead) { t.dataset.dead = "1"; t.removeAttribute("src"); t.classList.add("blank"); }
  }, true);
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-act], [data-theme-set], [data-sheet], [data-set-open], [data-close]");
    if (!b) {
      // Tapping a row's text (not a button or link) opens its details too.
      const row = e.target.closest(".view .film .main");
      if (row && !e.target.closest("a, button, input, select")) openFilm(row.closest(".film").dataset.id);
      return;
    }
    if (b.dataset.themeSet) { setCfg({theme: b.dataset.themeSet}); return; }
    if (b.dataset.sheet) { openSheet(b.dataset.sheet); return; }
    if (b.dataset.setOpen) { hideDlg($("sheet")); hideDlg($("filmDlg")); openSettings(b.dataset.setOpen); return; }
    if (b.hasAttribute("data-close")) { hideDlg(b.closest("dialog")); return; }
    const a = b.dataset.act, row = b.closest("[data-id]"), id = row && row.dataset.id;
    if (a === "open" && id) { ui.focus = id; openFilm(id); return; }
    if (a === "openid") { openFilm(b.dataset.id2); return; }
    if (a === "tag") {
      const key = b.dataset.key;
      if (key.startsWith("d:")) { setDir(key.slice(2)); return; }
      filterTo({tag: key, q: ""});
      return;
    }
    if (a === "untag") { ui.tag = null; refresh(); return; }
    if (a === "dir") { const k = b.dataset.key; filterTo({dir: ui.dir === k && !b.closest("#suggest") ? "" : k, q: b.closest("#suggest") ? "" : ui.q}); return; }
    if (a === "undir") { setDir(""); return; }
    if (a === "clearall") { Object.assign(ui, {q: "", dir: "", tag: null, svc: new Set(), gore: "any", len: "any", loose: false, shown: PAGE}); refresh(); return; }
    if (a === "svc") {
      const k = b.dataset.key;
      ui.svc.has(k) ? ui.svc.delete(k) : ui.svc.add(k);
      ui.shown = PAGE;
      refresh();
      return;
    }
    if (a === "svcall") { ui.svc = new Set(); ui.shown = PAGE; refresh(); return; }
    if (a === "loose" || a === "unloose") { ui.loose = a === "loose"; ui.shown = PAGE; refresh({keepBar: true}); return; }
    if (a === "rf") { ui.rf = ui.rf === b.dataset.v && b.dataset.v !== "all" ? "all" : b.dataset.v; refresh(); refocus(`[data-act="rf"][data-v="${CSS.escape(b.dataset.v)}"]`); return; }
    if (a === "roll") { ui.roll++; renderTonight(); return; }
    if (a === "jump" || a === "jumpopen") { openFilm(b.dataset.id2); return; }
    if (a === "find") { if (typeof openFind === "function") openFind(($("q") && $("q").value) || ui.q); return; }
    if (id) act(id, a, b.dataset.rate);
  });
  // Hovering a score previews its word under the meter.
  const preview = (e, on) => {
    const b = e.target.closest && e.target.closest(".rate10 button");
    if (!b) return;
    const w = b.closest(".rate10").querySelector(".rword");
    w.textContent = on ? `${b.dataset.rate} · ${b.dataset.w}` : w.dataset.cur;
  };
  document.addEventListener("mouseover", e => preview(e, true));
  document.addEventListener("mouseout", e => preview(e, false));
  document.addEventListener("focusin", e => {
    preview(e, true);
    if (e.target.id === "q") showSuggest(true);
  });
  document.addEventListener("focusout", e => {
    preview(e, false);
    // Leave the suggestions up long enough for a tap on one to land (iOS doesn't focus buttons it taps).
    if (e.target.id === "q" || (e.target.closest && e.target.closest("#suggest"))) {
      setTimeout(() => { const s = $("suggest"); if (s && !s.contains(document.activeElement) && document.activeElement !== $("q")) showSuggest(false); }, 250);
    }
  });
  $("moreFor").addEventListener("click", () => { ui.shown += PAGE; refresh({keepBar: true}); });
  document.addEventListener("input", e => {
    const t = e.target;
    if (t.id === "q") {
      ui.q = t.value; ui.shown = PAGE; ui.loose = false;
      showSuggest(true);
      clearTimeout(wire.t);
      wire.t = setTimeout(() => refresh({keepBar: true}), 120);
    } else if (t.id === "rq") {
      ui.rq = t.value;
      clearTimeout(wire.t);
      wire.t = setTimeout(() => refresh({keepBar: true}), 120);
    }
  });
  document.addEventListener("change", e => {
    const t = e.target;
    if (t.id === "sort") { ui.sort = t.value; ui.shown = PAGE; refresh(); refocus("#sort"); }
    else if (t.id === "fGore") { ui.gore = t.value; ui.shown = PAGE; refresh(); refocus("#fGore"); }
    else if (t.id === "fLen") { ui.len = t.value; ui.shown = PAGE; refresh(); refocus("#fLen"); }
    else if (t.id === "fLang") { setCfg({en: t.value === "1" ? 1 : 0}, true); refocus("#fLang"); }
    else if (t.id === "rsort") { ui.rsort = t.value; refresh(); refocus("#rsort"); }
    else if (t.id === "svcMore" && t.value) { ui.svc.add(t.value); ui.shown = PAGE; refresh(); }
  });
  document.addEventListener("keydown", e => {
    if (e.target.id === "q" && e.key === "Enter") { e.preventDefault(); showSuggest(false); e.target.blur(); return; }
    if (e.target.closest("input, select, textarea, dialog")) {
      if (e.key === "Escape" && /^(q|rq)$/.test(e.target.id)) { showSuggest(false); e.target.blur(); }
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const rows = [...document.querySelectorAll(".view:not([hidden]) .list .film")];
    const idx = rows.findIndex(r => r.dataset.id === ui.focus);
    const k = e.key;
    if (k === "j" || k === "k") {
      e.preventDefault();
      if (!rows.length) return;
      const next = k === "j" ? Math.min(rows.length - 1, idx + 1) : Math.max(0, idx < 0 ? 0 : idx - 1);
      focusRow(rows[next].dataset.id);
      return;
    }
    if (k === "/") { const q = $("q") || $("rq"); if (q) { e.preventDefault(); q.focus(); q.select(); } return; }
    if (k === "u") { undoLast(); return; }
    if (k === "r" && ui.view === "for") { ui.roll++; renderTonight(); return; }
    if (!ui.focus || !BY.has(ui.focus)) return;
    if (k === "Enter" && e.target.closest("button, a")) return;
    const id = ui.focus, nextId = rows[idx + 1] ? rows[idx + 1].dataset.id : rows[idx - 1] ? rows[idx - 1].dataset.id : null;
    const move = () => { if (nextId && !document.querySelector(`.view:not([hidden]) .film[data-id="${CSS.escape(id)}"]`)) focusRow(nextId); else focusRow(id); };
    if (k === "o" || k === "Enter") { e.preventDefault(); openFilm(id); }
    else if (k === "w") { act(id, "want"); move(); }
    else if (k === "x") { act(id, "pass"); move(); }
    else if (k === "s") { act(id, "seen"); }
    else if (/^[0-9]$/.test(k)) { act(id, "rate", k === "0" ? 10 : Number(k)); move(); }
    else if (k === "Escape") { ui.rating.delete(id); refresh({keepBar: true}); focusRow(id); }
  });
  // Dialogs: the details sheet and the filter sheet close on the button, Escape, or a tap outside.
  for (const d of document.querySelectorAll("dialog")) {
    d.addEventListener("close", () => {
      if (d.id === "filmDlg") { const id = ui.film; ui.film = null; if (id) setTimeout(() => focusRow(id), 0); }
      if (d.id === "sheet") ui.sheet = null;
      dlgClosed();
    });
    d.addEventListener("click", e => { if (e.target === d) hideDlg(d); });
  }
  $("closeFilm").addEventListener("click", () => hideDlg($("filmDlg")));
  $("toastUndo").addEventListener("click", undoLast);
  const setTop = () => document.documentElement.style.setProperty("--top-h", document.querySelector(".top").offsetHeight + "px");
  window.addEventListener("resize", setTop);
  setTop();
  if (isStandalone()) document.documentElement.classList.add("standalone");
  wireSettings();
}

/* ---------- Settings ----------
   One dialog, in sections: a menu of sections on phones (tap one to open it, Back to return), the menu and the open
   section side by side on wider screens. */
const PANES = {account: "Account", services: "Streaming services", content: "Content", look: "Appearance", data: "Your data", about: "About"};
let setPane = null;
function setCfg(patch, rebar) {
  state.cfg = cfg = Object.assign({}, cfg, patch, {t: nowISO()});
  saveLocal();
  queuePush("cfg");
  applyTheme();
  fillSettings();
  refresh({keepBar: !rebar});
}
function applyTheme() {
  if (cfg.theme === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = cfg.theme;
}
function fillSettings() {
  // Built once, then only ticked and unticked, so a switch keeps its focus and animation as you use it.
  if (!$("svcChecks").children.length) {
    $("svcChecks").innerHTML = OWNABLE.map(k => {
      const s = SVC[k];
      return `<label class="sw"><span>${esc(s.n)}${k === "hbo" ? ` <small>comes with NOW Entertainment</small>` : s.p ? ` <small>£${s.p.toFixed(2)} a month</small>` : ""}</span><input type="checkbox" class="tog" data-svc="${k}"></label>`;
    }).join("");
    $("flagChecks").innerHTML = Object.entries(FLAGS).map(([k, l]) => `<label class="sw"><span>${esc(l)}</span><input type="checkbox" class="tog" data-flag="${k}"></label>`).join("");
  }
  document.querySelectorAll("#svcChecks [data-svc]").forEach(i => { i.checked = !!cfg.svc[i.dataset.svc]; });
  document.querySelectorAll("#flagChecks [data-flag]").forEach(i => { i.checked = !!cfg.hide[i.dataset.flag]; });
  $("cfgFree").checked = !!cfg.free;
  $("cfgEn").checked = !!cfg.en;
  document.querySelectorAll("[data-theme-set]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.themeSet === cfg.theme)));
  const nSvc = OWNABLE.filter(k => cfg.svc[k]).length, nHide = Object.values(cfg.hide).filter(Boolean).length;
  const sum = {
    account: acct.user ? "@" + acct.user.handle : acct.server === false ? "This browser only" : "Not signed in",
    services: nSvc ? `${plural(nSvc, "service")}${cfg.free ? " + free TV" : ""}` : cfg.free ? "Free TV only" : "None picked",
    content: [nHide ? `Hiding ${nHide} flag${nHide === 1 ? "" : "s"}` : "", cfg.en ? "English only" : ""].filter(Boolean).join(" · ") || "Nothing hidden",
    look: {auto: "Match device", dark: "Dark", light: "Light"}[cfg.theme] || "Match device"
  };
  for (const [k, v] of Object.entries(sum)) { const el = document.querySelector(`.set-nav [data-pane="${k}"] small`); if (el) el.textContent = v; }
  renderAccountBox();
}
function showPane(p) {
  setPane = p && PANES[p] ? p : null;
  const d = $("settings");
  d.classList.toggle("in-pane", !!setPane);
  document.querySelectorAll(".set-pane").forEach(s => { s.hidden = s.dataset.pane !== setPane; });
  document.querySelectorAll(".set-nav [data-pane]").forEach(b => b.setAttribute("aria-current", b.dataset.pane === setPane ? "true" : "false"));
  $("setBack").hidden = !setPane;
  $("set-h").textContent = setPane && !wide() ? PANES[setPane] : "Settings";
  const body = d.querySelector(".set-panes");
  if (body) body.scrollTop = 0;
}
function openSettings(pane) {
  const d = $("settings");
  fillSettings();
  showPane(pane || (wide() ? "account" : null));
  showDlg(d);
  setTimeout(() => {
    const el = setPane ? d.querySelector(`.set-pane[data-pane="${setPane}"] h3, .set-pane[data-pane="${setPane}"] input, .set-pane[data-pane="${setPane}"] button`) : d.querySelector(".set-nav button");
    if (el && el.focus) el.focus({preventScroll: true});
  }, 40);
}
function wireSettings() {
  const d = $("settings");
  $("openSettings").addEventListener("click", () => openSettings());
  $("closeSettings").addEventListener("click", () => hideDlg(d));
  $("setBack").addEventListener("click", () => { showPane(null); const b = d.querySelector(".set-nav button"); if (b) b.focus(); });
  d.querySelector(".set-nav").addEventListener("click", e => {
    const b = e.target.closest("[data-pane]");
    if (b) showPane(b.dataset.pane);
  });
  window.addEventListener("resize", () => { if (d.open && wide() && !setPane) showPane("account"); else if (d.open) $("set-h").textContent = setPane && !wide() ? PANES[setPane] : "Settings"; });
  d.addEventListener("change", e => {
    const t = e.target;
    if (t.dataset.svc) setCfg({svc: Object.assign({}, cfg.svc, {[t.dataset.svc]: t.checked ? 1 : 0})});
    else if (t.dataset.flag) setCfg({hide: Object.assign({}, cfg.hide, {[t.dataset.flag]: t.checked ? 1 : 0})});
    else if (t.id === "cfgFree") setCfg({free: t.checked ? 1 : 0});
    else if (t.id === "cfgEn") setCfg({en: t.checked ? 1 : 0}, true);
    else if (t.id === "importFile" && t.files && t.files[0]) importFile(t.files[0]);
  });
  $("exportBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state, null, 1)], {type: "application/json"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `dread-list-${todayISO()}.json`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
  $("resetBtn").addEventListener("click", () => {
    if (!confirm(`Clear every rating, want and pass${acct.user ? " in your account, on every device" : " in this browser"}? Export first if you might want them back.`)) return;
    const t = nowISO(), ids = Object.keys(state.films);
    for (const id of ids) state.films[id] = {t};
    saveLocal(); queuePush(ids); refresh(); toast("Cleared all ratings");
  });
}
function importFile(file) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const raw = JSON.parse(r.result), incoming = normState(raw);
      if (!raw || typeof raw !== "object" || !raw.films) throw new Error("not an export");
      state = merge(state, incoming); cfg = state.cfg;
      saveLocal(); queuePush(Object.keys(incoming.films)); if (raw.cfg) queuePush("cfg"); applyTheme(); fillSettings(); refresh();
      toast(`Imported ${Object.keys(incoming.films).length} entries`);
    } catch (e) { toast("That file isn’t a Dread List export."); }
  };
  r.readAsText(file);
}

/* Merge two states film by film: the newer timestamp wins, the same rule as account sync. */
function merge(a, b) {
  const out = {v: 3, films: Object.assign({}, a.films), cfg: a.cfg};
  for (const [id, e] of Object.entries(b.films || {})) { const cur = out.films[id]; if (!cur || String(e.t || "") > String(cur.t || "")) out.films[id] = e; }
  if (b.cfg && String(b.cfg.t || "") > String((a.cfg && a.cfg.t) || "")) out.cfg = b.cfg;
  return out;
}

/* ---------- Boot ----------
   The page loads its film data and asks the server who you are at the same time. Signed in, your list comes from your
   account (cached in this browser for speed); otherwise it lives in this browser. On GitHub Pages or offline there is
   no server, and the page works as before, browser-only. */
const timeNow = () => new Date().toLocaleTimeString("en-GB", {hour: "2-digit", minute: "2-digit"});
async function boot() {
  applyTheme();
  wire();
  store.del("dread.sync.v1"); // the first version's per-browser token, long unused
  const dataP = fetch("/data.json", {cache: "no-cache"}).then(res => { if (!res.ok) throw new Error(String(res.status)); return res.json(); });
  const acctP = initAccount();
  try {
    prepare(await dataP);
  } catch (e) {
    $("boot").textContent = "The film data didn’t load. Check your connection and refresh the page.";
    return;
  }
  await acctP;
  cfg = state.cfg;
  applyTheme();
  if (ALIAS.size && migrateAliases()) { adoptGone(); buildDirs(); }
  $("boot").remove();
  const when = DATA_CHECKED && !isNaN(DATA_CHECKED) ? DATA_CHECKED.toLocaleString("en-GB", {day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"}) : "unknown";
  $("source").textContent = `UK availability, prices and scores from JustWatch, refreshed every morning (last check ${when}). Subgenres from Wikidata. Gore marked ~ is estimated from the certificate and synopsis. BBC iPlayer needs a TV licence.`;
  await afterBoot();
  route();
  startSync();
}
document.addEventListener("DOMContentLoaded", boot, {once: true});
