"use strict";
/* Dread List: a horror recommender that learns from your buttons.
   data.json is rebuilt daily by refresh.py (JustWatch UK + Wikidata). Ratings, wants, passes and settings live in
   this browser and can sync to a private GitHub repo. No third-party requests from the page itself. */

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
const fold = s => String(s == null ? "" : s).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const foldKey = s => fold(s).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const LANG_NAMES = (() => { try { return new Intl.DisplayNames(["en-GB"], {type: "language"}); } catch (e) { return null; } })();
function langName(code) {
  if (!code || code === "xx") return "Not English";
  try { const n = LANG_NAMES && LANG_NAMES.of(code); if (n && n.toLowerCase() !== code) return n; } catch (e) { /* unknown code */ }
  return code.toUpperCase();
}

/* ---------- State ---------- */
let FILMS = [], BY = new Map(), SEED = new Map(), NEIGH = new Map(), FEAT = new Map(), DATA_CHECKED = null;
let state = normState(store.get(KEY_STATE));
let M = {aff: new Map(), cnt: new Map(), signals: 0};
/* Filters shared by For you and the Watchlist: q search, svc services (any of), dir director, tag feature, gore, len,
   sort. loose shows every search match whatever the filters. rf, rq and rsort belong to Rated. */
const ui = {view: "for", q: "", svc: new Set(), dir: "", gore: "any", len: "any", sort: "match", tag: null, shown: PAGE, loose: false,
  open: new Set(), rating: new Set(), focus: null, rf: "all", rq: "", rsort: "recent", roll: 0, wild: new Set(), jumping: false};
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
function eff(id) {
  const e = state.films[id];
  if (e) return e;
  const s = SEED.get(id);
  return s ? {s, r: tierOf(s), seen: 1, src: "profile"} : EMPTY;
}
const sig = e => e.s ? SCORE_SIG[e.s] : e.x ? SIG_PASS : e.w ? SIG_WANT : null;
const isDone = e => !!(e.s || e.seen);
/* A compact copy of a film travels with your rating, so it keeps teaching the model (and stays in Rated, synopsis
   and all) even after the film drops out of the daily pool. */
const SNAP_KEYS = ["t", "y", "jid", "px", "tg", "ta", "dir", "co", "g", "ge", "fl", "rn", "im", "rt", "imdb", "jw", "d", "lg", "ot"];
const snapVal = v => v !== undefined && v !== null && !(Array.isArray(v) && !v.length);
function snap(f) {
  const s = {};
  if (f) SNAP_KEYS.forEach(k => { if (snapVal(f[k])) s[k] = f[k]; });
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
  queuePush();
  refresh();
  if (label) toast(label, true);
}
function saveLocal() { store.set(KEY_STATE, state); }

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
/* Every director in the pool, most films first, for the director filter. */
let DIRS = [];
function buildDirs() {
  const n = new Map();
  FILMS.forEach(f => (f.dir || []).forEach(d => n.set(d, (n.get(d) || 0) + 1)));
  DIRS = [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  // One suggestion list for the director box, kept outside the bar so it isn't rebuilt on every render.
  let dl = $("dirList");
  if (!dl) { dl = document.createElement("datalist"); dl.id = "dirList"; document.body.append(dl); }
  dl.innerHTML = DIRS.map(([d, c]) => `<option value="${esc(d)}">${c} film${c === 1 ? "" : "s"}</option>`).join("");
}
/* Films you rated, wanted or passed that are no longer in today's pool come back from the copy saved with the rating. */
function adoptGone() {
  let added = 0;
  for (const [id, e] of Object.entries(state.films)) {
    if (!e.f || BY.has(id)) continue;
    const f = Object.assign({id, gone: 1, o: []}, e.f);
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
function learn() {
  const num = new Map(), den = new Map(), cnt = new Map();
  let signals = 0;
  for (const f of FILMS) {
    const s = sig(eff(f.id));
    if (s == null) continue;
    signals++;
    for (const [k, w] of FEAT.get(f.id)) {
      num.set(k, (num.get(k) || 0) + s * w);
      den.set(k, (den.get(k) || 0) + w);
      cnt.set(k, (cnt.get(k) || 0) + 1);
    }
  }
  const aff = new Map();
  new Set([...den.keys(), ...Object.keys(PRIOR)]).forEach(k => aff.set(k, (SHRINK * (PRIOR[k] || 0) + (num.get(k) || 0)) / (SHRINK + (den.get(k) || 0))));
  M = {aff, cnt, signals};
}
function quality(f) {
  let q = 0;
  if (typeof f.im === "number") q += 0.35 * clamp((f.im - 6.3) / 0.8, -2, 2) * Math.min(1, (f.iv || 0) / 6000 + (f.cur || f.seed ? 1 : 0));
  if (typeof f.rt === "number") q += 0.2 * clamp((f.rt - 75) / 20, -2, 1.5);
  return q;
}
const matchPct = T => Math.round(100 / (1 + Math.exp(-1.25 * (T - 1.25))));
function scoreAll() {
  for (const f of FILMS) {
    let s = 0, mass = 0, unk = 0;
    for (const [k, w] of FEAT.get(f.id)) {
      s += w * (M.aff.get(k) || 0); mass += w; unk += w / (1 + (M.cnt.get(k) || 0));
    }
    const fit = mass ? s / Math.sqrt(mass) : 0;
    let nb = 0, pos = null, neg = null, best = 0, worst = 0;
    for (const j of NEIGH.get(f.id) || []) {
      const sj = sig(eff(j));
      if (sj == null || Math.abs(sj) < 0.9) continue;
      nb += 0.35 * sj;
      if (sj > best) { best = sj; pos = j; }
      if (sj < worst) { worst = sj; neg = j; }
    }
    nb = clamp(nb, -1.2, 1.2);
    f._fit = fit; f._nb = nb; f._q = quality(f); f._pos = pos; f._neg = neg; f._unk = mass ? unk / mass : 1;
    f._T = fit + nb + f._q;
    f._m = matchPct(f._T);
  }
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
const jwLink = f => f.jw ? "https://www.justwatch.com" + f.jw : "https://www.justwatch.com/uk/search?q=" + encodeURIComponent(f.t);

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
   so nothing you look for vanishes. Returns the list, the films the service chips count against, and how many
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
function posterHTML(f, cls, w, h) {
  return f.px ? `<img class="${cls}" src="p/${esc(f.jid)}.webp" alt="" loading="lazy" decoding="async" width="${w}" height="${h}">`
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
  return `<span class="watch none">Not streaming in the UK</span>`;
}
function factsHTML(f) {
  const bits = [];
  if (typeof f.im === "number") bits.push(`<span>IMDb <b>${f.im.toFixed(1)}</b></span>`);
  if (typeof f.rt === "number") bits.push(`<span>RT <b>${f.rt}%</b></span>`);
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
  if (e.x) b.push(`<span class="badge">Passed</span>`);
  if (f.p && !isDone(e)) b.push(`<span class="badge pick">Start here</span>`);
  if (ui.wild.has(f.id)) b.push(`<span class="badge wild" title="Picked to test something the model hasn't learned yet">Wildcard</span>`);
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
function rowHTML(f) {
  const e = eff(f.id), a = avail(f), open = ui.open.has(f.id), done = isDone(e);
  const pitch = f.w || f.d || "";
  let left, line;
  if (e.s) left = `<div class="m sc ${scoreClass(e.s)}" title="Your rating: ${e.s}/10, ${esc(SCORE_WORD[e.s])}"><b>${e.s}</b><small>/10</small></div>`;
  else if (e.seen) left = `<div class="m" title="Seen, not rated yet"><b class="cool">--</b></div>`;
  else left = `<div class="m" title="Predicted match"><b class="${matchClass(f._m)}">${f._m}</b><small>%</small></div>`;
  if (done) {
    line = (f.tg || []).concat(f.ta || []).slice(0, 4).map(t => `<span>${esc(TAGS[t] || t)}</span>`).join("");
  } else {
    const r = reasons(f);
    line = r.pos.map(x => `<span class="p">${esc(x)}</span>`).join("") + r.neg.map(x => `<span class="n">${esc(x)}</span>`).join("") +
      r.flags.map(x => `<span class="f">${esc(x)}</span>`).join("");
  }
  return `<article class="film${open ? " open" : ""}${done ? " done" : ""}${ui.focus === f.id ? " is-focus" : ""}" data-id="${esc(f.id)}" tabindex="-1">
    ${left}
    ${posterHTML(f, "pst", 46, 69)}
    <div class="main">
      <h3><button type="button" class="ttl" data-act="open" aria-expanded="${open}">${esc(f.t)}</button><span class="yr">${esc(f.y || "")}</span>${dirHTML(f)}${badgesHTML(f, a)}</h3>
      ${pitch ? `<p class="pitch">${esc(pitch)}</p>` : ""}
      <div class="meta2">${line ? `<p class="why">${line}</p>` : ""}${factsHTML(f)}</div>
    </div>
    <div class="side"><span class="wbox">${watchHTML(f, a)}</span><span class="acts">${actsHTML(f)}</span></div>
    ${open ? detailHTML(f, a) : ""}
  </article>`;
}
function detailHTML(f, a) {
  const e = eff(f.id), done = isDone(e);
  const offers = [];
  a.own.forEach(o => offers.push(`<li><a class="own" href="${esc(o[1] || jwLink(f))}" target="_blank" rel="noopener noreferrer">${esc(svcName(o[0]))}</a><small>${o[2] ? "until " + esc(shortDate(o[2])) : "yours"}</small></li>`));
  a.free.forEach(o => offers.push(`<li><a href="${esc(o[1] || jwLink(f))}" target="_blank" rel="noopener noreferrer">${esc(svcName(o[0]))}</a><small>free${o[0] === "bbc" ? ", TV licence" : ""}${o[2] ? " until " + esc(shortDate(o[2])) : ""}</small></li>`));
  a.other.forEach(o => {
    const s = SVC[o[0]], extra = o[0].startsWith("ch:") ? "Prime Video channel" : s && s.p ? `£${s.p.toFixed(2)} a month` : isFree(o[0]) ? "free" : "subscription";
    offers.push(`<li><a href="${esc(o[1] || jwLink(f))}" target="_blank" rel="noopener noreferrer">${esc(svcName(o[0]))}</a><small>${esc(extra)}</small></li>`);
  });
  if (f.rent) offers.push(`<li>${f.rent[2] ? `<a href="${esc(f.rent[2])}" target="_blank" rel="noopener noreferrer">Rent on ${esc(f.rent[1] || "store")}</a>` : "Rent"}<small>£${f.rent[0].toFixed(2)}</small></li>`);
  if (f.buy) offers.push(`<li>Buy on ${esc(f.buy[1] || "store")}<small>£${f.buy[0].toFixed(2)}</small></li>`);
  if (!offers.length) offers.push(f.gone ? `<li>No longer in the daily pool. Check JustWatch for where it streams now.</li>` : `<li>Not streaming, rentable or in cinemas in the UK right now</li>`);
  const tags = [...(f.tg || []).map(t => [t, 0]), ...(f.ta || []).map(t => [t, 1])].map(([t, auto]) => {
    const v = M.aff.get("t:" + t) || 0;
    return `<button type="button" class="tag${auto ? " auto" : ""}${v > 0.3 ? " pos" : v < -0.3 ? " neg" : ""}" data-act="tag" data-key="t:${esc(t)}" title="${auto ? "Auto-tagged. " : ""}Your affinity ${v >= 0 ? "+" : ""}${v.toFixed(2)}">${esc(TAGS[t] || t)}</button>`;
  }).join("");
  const sims = [...(NEIGH.get(f.id) || [])].map(id => BY.get(id)).filter(Boolean)
    .sort((x, y) => (sig(eff(y.id)) || 0) - (sig(eff(x.id)) || 0) || y._T - x._T).slice(0, 8)
    .map(s => { const se = eff(s.id); return `<button type="button" data-act="jump" data-id2="${esc(s.id)}">${esc(s.t)} <span class="${se.s ? "r" : ""}">${se.s ? se.s + "/10" : s._m + "%"}</span></button>`; }).join("");
  const meta = [];
  if (e.s) meta.push(`<dt>Your rating</dt><dd><b class="${scoreClass(e.s)}">${e.s}/10</b> ${esc(SCORE_WORD[e.s])}<small>${e.src === "profile" ? " · from your profile" : e.t ? " · " + esc(new Date(e.t).toLocaleDateString("en-GB", {day: "numeric", month: "short", year: "numeric"})) : ""}</small></dd>`);
  if ((f.dir || []).length) meta.push(`<dt>Director</dt><dd>${f.dir.map(d => `<button type="button" class="tag" data-act="dir" data-key="${esc(d)}" title="Only films by ${esc(d)}">${esc(d)}</button>`).join(" ")}</dd>`);
  if (f.lg) meta.push(`<dt>Language</dt><dd>${esc(langName(f.lg))}, subtitled</dd>`);
  if (f.ot) meta.push(`<dt>Original title</dt><dd>${esc(f.ot)}</dd>`);
  if ((f.co || []).length) meta.push(`<dt>Made in</dt><dd>${esc(f.co.join(", "))}</dd>`);
  if (f.ce) meta.push(`<dt>Certificate</dt><dd>${esc(f.ce)}</dd>`);
  if (f.rn) meta.push(`<dt>Runtime</dt><dd>${runtime(f.rn)}</dd>`);
  if (f.aka) meta.push(`<dt>Also</dt><dd>${esc(f.aka)}</dd>`);
  const links = [`<a href="${esc(jwLink(f))}" target="_blank" rel="noopener noreferrer">JustWatch</a>`];
  if (f.imdb) links.push(`<a href="https://www.imdb.com/title/${esc(f.imdb)}/" target="_blank" rel="noopener noreferrer">IMDb</a>`, `<a href="https://letterboxd.com/imdb/${esc(f.imdb)}/" target="_blank" rel="noopener noreferrer">Letterboxd</a>`);
  links.push(`<a href="https://www.youtube.com/results?search_query=${encodeURIComponent(f.t + " " + (f.y || "") + " trailer")}" target="_blank" rel="noopener noreferrer">Trailer</a>`);
  const pct = n => (n >= 0 ? "+" : "−") + Math.abs(n).toFixed(2);
  const synopsis = f.w && f.d ? `<h4>Synopsis</h4><p>${esc(f.d)}</p>` : !f.w && !f.d ? `<h4>Synopsis</h4><p class="hint">No synopsis saved for this one.</p>` : "";
  return `<div class="detail">
    <div>
      ${synopsis}
      <h4>Tags</h4><div class="tagrow">${tags || '<span class="hint">None yet</span>'}</div>
      ${sims ? `<h4>Similar films</h4><div class="simrow">${sims}</div>` : ""}
      ${done ? "" : `<h4>Why ${f._m}%</h4>
      <div class="calc"><span>Taste fit</span><b>${pct(f._fit)}</b><span>Similar films you rated</span><b>${pct(f._nb)}</b><span>Critics</span><b>${pct(f._q)}</b><span>Score</span><b>${pct(f._T)}</b></div>`}
    </div>
    <div>
      <h4>Where to watch in the UK</h4><ul class="offers">${offers.join("")}</ul>
      ${meta.length ? `<h4>Details</h4><dl>${meta.join("")}</dl>` : ""}
      <h4>Links</h4><div class="links">${links.join("")}</div>
    </div>
  </div>`;
}

/* ---------- Views ---------- */
function renderTonight() {
  const pool = FILMS.filter(f => isCandidate(f) && passes(f, {basic: true}) && avail(f).tonight).sort(SORTS.match);
  const box = $("tonight");
  if (!pool.length) { box.innerHTML = `<div class="lab"><h2><i class="rec" aria-hidden="true"></i>Tonight</h2></div><p class="none">Nothing unseen is on your services right now. Check the services you pay for in Settings.</p>`; return; }
  const top = pool.slice(0, 6), f = top[ui.roll % top.length], a = avail(f);
  box.innerHTML = `<div class="lab"><h2><i class="rec" aria-hidden="true"></i>Tonight’s tape</h2><span class="sub">Best match you can watch now</span>
      <button type="button" class="act quiet roll" data-act="roll" title="Roll again (r)">Roll again</button></div>
    ${f.px ? `<img src="p/${esc(f.jid)}.webp" alt="" width="92" height="138">` : ""}
    <div class="film-lite" data-id="${esc(f.id)}">
      <p class="tt"><span class="big">${f._m}%</span> <button type="button" data-act="jumpopen" data-id2="${esc(f.id)}">${esc(f.t)}</button> <span class="yr">${esc(f.y || "")}</span></p>
      <div class="meta">${watchHTML(f, a)}${factsHTML(f)}</div>
      <p>${esc(f.w || f.d || "")}</p>
      <div class="acts" data-id="${esc(f.id)}">${actsHTML(f)}</div>
    </div>`;
}
function renderStrips() {
  const c = FILMS.filter(f => isCandidate(f) && passes(f, {basic: true}));
  const fresh = c.filter(f => f.nw && daysUntil(f.nw[0]) >= -NEW_DAYS && (cfg.svc[f.nw[1]] || (cfg.free && isFree(f.nw[1]))) && (f.o || []).some(o => o[0] === f.nw[1]))
    .sort(SORTS.match).slice(0, 6);
  const leaving = c.map(f => [f, avail(f).leave]).filter(([, l]) => l && daysUntil(l) <= SOON_DAYS).sort((x, y) => y[0]._T - x[0]._T).slice(0, 6);
  const li = (f, when, soon) => `<li><button type="button" data-act="jumpopen" data-id2="${esc(f.id)}"><span class="mm ${matchClass(f._m)}">${f._m}</span>${posterHTML(f, "", 28, 42)}<span class="st">${esc(f.t)}<small>${esc(f.y || "")}</small></span><span class="when${soon ? " soon" : ""}">${esc(when)}</span></button></li>`;
  $("strips").innerHTML = `<section class="strip"><h2>New on your services</h2><p class="sub">Added in the last two weeks, best matches first</p>
      ${fresh.length ? `<ol>${fresh.map(f => li(f, `${svcName(f.nw[1])}, ${shortDate(f.nw[0])}`)).join("")}</ol>` : `<p class="empty">Nothing new that fits you this fortnight.</p>`}</section>
    <section class="strip"><h2>Leaving soon</h2><p class="sub">Last chance on your services in the next 30 days</p>
      ${leaving.length ? `<ol>${leaving.map(([f, l]) => li(f, `Leaves ${shortDate(l)}`, daysUntil(l) <= 7)).join("")}</ol>` : `<p class="empty">Nothing you’d want is leaving this month.</p>`}</section>`;
}
/* ---------- The filter bar (For you and the Watchlist) ---------- */
const SORT_OPTS = [["match", "Best match"], ["imdb", "IMDb"], ["rt", "Rotten Tomatoes"], ["new", "Newest"], ["short", "Shortest"], ["leaving", "Leaving soonest"]];
/* Service chips: Tonight, each service you pay for (NOW and HBO Max as one), Free and Rent. */
function svcTokens() {
  const own = OWNABLE.filter(k => cfg.svc[k]), both = own.includes("hbo") && own.includes("nowe");
  const toks = [["tonight", "Tonight", "On your services, or free"]];
  own.forEach(k => {
    if (both && k === "nowe") return;
    toks.push(both && k === "hbo" ? ["hbo|nowe", "NOW & HBO Max", "NOW Entertainment, which includes HBO Max"] : [k, SVC[k].n, ""]);
  });
  toks.push(["free", "Free", "BBC iPlayer, Channel 4, ITVX, My5, Tubi and the other free services"], ["rent", "Rent", "Not on your services, but rentable"]);
  return toks;
}
const tokName = k => k === "subs" ? "Other subscriptions" : k === "tonight" ? "Tonight" : k === "free" ? "Free" : k === "rent" ? "Rent" : k.split("|").map(svcName).join(" & ");
function chipHTML(k, label, tip, removable) {
  return `<button type="button" class="chip${removable ? " rm" : ""}" data-act="svc" data-key="${esc(k)}" aria-pressed="${ui.svc.has(k)}"${tip ? ` title="${esc(tip)}"` : ""}>${esc(label)}<span class="c" data-c="${esc(k)}"></span>${removable ? `<b aria-hidden="true">×</b><span class="sr">Remove</span>` : ""}</button>`;
}
/* Every other service in the pool, most films first, to add as a chip. */
function moreSvcHTML(fixedKeys) {
  const n = new Map();
  FILMS.forEach(f => { if (!f.gone) (f.o || []).forEach(o => { if (!fixedKeys.has(o[0]) && !ui.svc.has(o[0])) n.set(o[0], (n.get(o[0]) || 0) + 1); }); });
  const groups = [["Subscriptions", k => !isFree(k) && !k.startsWith("ch:")], ["Prime Video channels", k => k.startsWith("ch:")], ["Free services", k => isFree(k)]];
  return `<select id="svcMore" aria-label="Filter by another service"><option value="">+ More</option>` +
    (ui.svc.has("subs") ? "" : `<option value="subs">Any subscription you don’t have</option>`) +
    groups.map(([label, test]) => {
      const ks = [...n].filter(([k]) => test(k)).sort((a, b) => b[1] - a[1] || svcName(a[0]).localeCompare(svcName(b[0])));
      return ks.length ? `<optgroup label="${label}">${ks.map(([k, c]) => `<option value="${esc(k)}">${esc(svcName(k))} · ${c}</option>`).join("")}</optgroup>` : "";
    }).join("") + `</select>`;
}
function barHTML() {
  const seg = (name, opts, cur) => `<span class="seg" role="group" aria-label="${esc(name)}">${opts.map(([v, l]) => `<button type="button" data-set="${esc(name)}" data-v="${esc(v)}" aria-pressed="${cur === v}">${esc(l)}</button>`).join("")}</span>`;
  const toks = svcTokens(), fixed = new Set(toks.map(t => t[0])), fixedKeys = new Set(toks.flatMap(t => t[0].split("|")));
  const extra = [...ui.svc].filter(k => !fixed.has(k));
  return `<div class="search"><input type="search" id="q" placeholder="Search titles, directors, tags, languages" value="${esc(ui.q)}" aria-label="Search" autocomplete="off"></div>
    <div class="dirbox"><input type="search" id="dirq" list="dirList" placeholder="Any director" value="${esc(ui.dir)}" aria-label="Filter by director" autocomplete="off" spellcheck="false"></div>
    <div class="filters svcrow" role="group" aria-label="Where to watch"><span class="lbl">Where</span>
      <button type="button" class="chip" data-act="svcall" aria-pressed="${!ui.svc.size}">Anywhere</button>${toks.map(([k, l, t]) => chipHTML(k, l, t)).join("")}${extra.map(k => chipHTML(k, tokName(k), "", true)).join("")}${moreSvcHTML(fixedKeys)}</div>
    <div class="filters">
      <div class="grp"><span>Gore</span>${seg("gore", [["any", "Any"], ["H", "≤ High"], ["M", "≤ Med"], ["L", "Low"]], ui.gore)}</div>
      <div class="grp"><span>Length</span>${seg("len", [["any", "Any"], ["100", "≤ 100m"]], ui.len)}</div>
      <div class="grp"><span>Language</span><span class="seg" role="group" aria-label="Language"><button type="button" data-act="en" data-v="0" aria-pressed="${!cfg.en}">Any</button><button type="button" data-act="en" data-v="1" aria-pressed="${!!cfg.en}" title="Hide films that aren’t in English. Remembered and synced.">English only</button></span></div>
      <div class="grp"><label for="sort"><span>Sort</span></label> <select id="sort">${SORT_OPTS.map(([v, l]) => `<option value="${v}"${ui.sort === v ? " selected" : ""}>${l}</option>`).join("")}</select></div>
    </div>
    <p class="count" id="count"></p>`;
}
/* Live counts on the service chips: how many of the films in view each one would leave. */
function updateSvcCounts(base) {
  document.querySelectorAll(".view:not([hidden]) .bar [data-c]").forEach(el => {
    const n = base.filter(f => svcMatch(f, el.dataset.c)).length;
    el.textContent = n.toLocaleString("en-GB");
  });
}
function chipsHTML() {
  const x = (act, label, sr) => `<button type="button" class="chipx" data-act="${act}">${esc(label)} <b aria-hidden="true">×</b><span class="sr">${sr}</span></button>`;
  return (ui.dir ? x("undir", "Dir. " + ui.dir, "Clear the director") : "") + (ui.tag ? x("untag", featLabel(ui.tag), "Clear the tag filter") : "") +
    (ui.svc.size ? x("svcall", [...ui.svc].map(tokName).join(" or "), "Clear the services") : "");
}

/* ---------- Lists ---------- */
function renderFor(keepBar) {
  renderTonight();
  renderStrips();
  if (!keepBar) $("barFor").innerHTML = barHTML();
  const {list, base, hidden} = forYouList(), shown = list.slice(0, ui.shown), look = lookup();
  const seen = look ? list.filter(f => isDone(eff(f.id))).length : 0;
  $("listFor").innerHTML = shown.length ? shown.map(rowHTML).join("") :
    `<p class="empty">${look ? (hidden ? "No matches with these filters." : `Nothing matches${ui.q ? ` “${esc(ui.q)}”` : ""}.`) : `Nothing matches. ${ui.tag ? "Clear the tag filter" : "Loosen a filter"} to see more.`}</p>`;
  $("moreFor").hidden = list.length <= ui.shown;
  updateSvcCounts(base);
  const n = list.length.toLocaleString("en-GB");
  $("count").innerHTML = (look ? `<span>${n} match${list.length === 1 ? "" : "es"}${seen ? `, ${seen} you’ve seen` : ""}</span>` : `<span>${shown.length} of ${n} unseen films</span>`) + chipsHTML() +
    (hidden ? `<button type="button" class="chipx more-x" data-act="loose">+ ${hidden} hidden by filters</button>` : "") +
    (look && ui.loose ? `<button type="button" class="chipx" data-act="unloose">Filters off <b aria-hidden="true">×</b><span class="sr">Turn the filters back on</span></button>` : "");
}
function renderWant(keepBar) {
  ui.wild = new Set();
  if (!keepBar) $("barWant").innerHTML = barHTML();
  const all = FILMS.filter(f => { const e = eff(f.id); return e.w && !isDone(e); });
  const base = all.filter(f => passes(f, {skipSvc: true}));
  const list = base.filter(onAnySvc).sort(SORTS[ui.sort] || SORTS.match);
  updateSvcCounts(base);
  $("count").innerHTML = `<span>${list.length === all.length ? `${all.length} film${all.length === 1 ? "" : "s"} on your watchlist` : `${list.length} of ${all.length} on your watchlist`}</span>` + chipsHTML();
  if (!all.length) { $("listWant").innerHTML = `<p class="empty">Tap Want on anything in For you and it lands here, ranked by match and grouped by where you can watch it.</p>`; return; }
  if (!list.length) { $("listWant").innerHTML = `<p class="empty">Nothing on your watchlist matches these filters.</p>`; return; }
  const groups = [["Watch tonight", f => avail(f).tonight], ["Rent", f => !avail(f).tonight && f.rent], ["On other services", f => !avail(f).tonight && !f.rent && avail(f).other.length], ["Not streaming", () => true]];
  const seen = new Set();
  $("listWant").innerHTML = groups.map(([name, test]) => {
    const g = list.filter(f => !seen.has(f.id) && test(f));
    g.forEach(f => seen.add(f.id));
    return g.length ? `<div class="sect"><h2>${esc(name)}</h2><span>${g.length}</span></div>` + g.map(rowHTML).join("") : "";
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
    $("ratedHead").innerHTML = `<div class="search"><input type="search" id="rq" placeholder="Search your ratings: titles, directors, tags" value="${esc(ui.rq)}" aria-label="Search your ratings" autocomplete="off"></div>
      <div class="hist" role="group" aria-label="Filter by score"><button type="button" class="all" data-act="rf" data-v="all" aria-pressed="${ui.rf === "all"}">All<span>${all.length}</span></button>${cols.join("")}${unrated ? `<button type="button" class="all" data-act="rf" data-v="unrated" aria-pressed="${ui.rf === "unrated"}">Unrated<span>${unrated}</span></button>` : ""}</div>
      <div class="grp"><label for="rsort"><span>Sort</span></label> <select id="rsort">${[["recent", "Recently rated"], ["high", "Highest first"], ["low", "Lowest first"], ["az", "A–Z"], ["year", "Newest film"]]
        .map(([v, l]) => `<option value="${v}"${ui.rsort === v ? " selected" : ""}>${l}</option>`).join("")}</select></div>
      <p class="count" id="rcount"></p>`;
    document.querySelectorAll("#ratedHead .hist i").forEach(i => i.style.setProperty("--h", i.dataset.h));
  }
  const rf = ui.rf;
  const list = all.filter(f => { const s = eff(f.id).s; return (rf === "all" || (rf === "unrated" ? !s : s === Number(rf))) && (!ui.rq || matchesQuery(f, ui.rq)); })
    .sort(RSORTS[ui.rsort] || RSORTS.recent);
  $("listRated").innerHTML = list.length ? list.map(rowHTML).join("") : `<p class="empty">${all.length ? "Nothing here matches." : "No ratings yet. Press Seen it on anything you’ve watched."}</p>`;
  $("rcount").innerHTML = `<span>${list.length === all.length ? `${all.length} film${all.length === 1 ? "" : "s"}` : `${list.length} of ${all.length}`}${n ? `, average ${(sum / n).toFixed(1)}` : ""}</span>` +
    `<span class="sub">Tap a title for the synopsis. Change a score and the model relearns instantly; “from your profile” means it came from what you told Claude.</span>`;
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
      <div><b>${FILMS.length.toLocaleString("en-GB")}</b><span>films in the pool</span></div><div><b>${tonight}</b><span>unseen on your services</span></div>
    </div>
    <div class="taste-grid">
      <section><h2>What pulls you in</h2><p>Learned from your ratings, wants and passes. Tap one to filter For you by it.</p>${pos.length ? barsHTML(pos, 2) : `<p class="hint">Rate a few films to see this.</p>`}</section>
      <section><h2>What pushes you away</h2><p>Negative affinity. These sink films down the list rather than hiding them.</p>${neg.length ? barsHTML(neg, 2) : `<p class="hint">Nothing yet. Pass on or score a few films low.</p>`}
        <h2 class="gap">Gore tolerance</h2><p>Your affinity for each gore level. Extreme starts slightly negative from what you’ve said about Hostel and Texas Chainsaw.</p>${barsHTML(gore, 2)}</section>
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
      <p>The pool rebuilds every morning from JustWatch UK: popular, trending and newly added horror, everything near your rated films, and the hand-picked list. ${FILMS.filter(f => f.cur).length} films are hand-picked.</p>
    </div>`;
  document.querySelectorAll("#taste .trk i").forEach(i => i.style.setProperty("--w", i.dataset.w));
}

/* ---------- Refresh orchestration ---------- */
function counts() {
  const w = FILMS.filter(f => { const e = eff(f.id); return e.w && !isDone(e); }).length;
  const r = FILMS.filter(f => isDone(eff(f.id))).length;
  $("nWant").textContent = w ? w : "";
  $("nRated").textContent = r ? r : "";
}
function refresh(opts) {
  if (FILMS.length) { topUpSnaps(); if (adoptGone()) buildDirs(); }
  learn();
  scoreAll();
  counts();
  renderView(opts);
}
function renderView(opts) {
  const v = ui.view, keep = !!(opts && opts.keepBar);
  document.querySelectorAll(".view").forEach(s => { s.hidden = s.id !== "view-" + v; });
  document.querySelectorAll(".tabs a").forEach(a => a.setAttribute("aria-current", a.dataset.view === v ? "page" : "false"));
  // The bar lives in whichever of For you and the Watchlist is showing, so its ids stay unique.
  if (v !== "for") $("barFor").innerHTML = "";
  if (v !== "want") $("barWant").innerHTML = "";
  const y = window.scrollY;
  if (v === "for") renderFor(keep && !!$("q"));
  else if (v === "want") renderWant(keep && !!$("q"));
  else if (v === "rated") renderRated(keep && !!$("rq"));
  else renderTaste();
  if (opts && opts.keepScroll !== false) window.scrollTo(0, y);
}
function route() {
  const v = (location.hash || "#for").slice(1);
  const next = ["for", "want", "rated", "taste"].includes(v) ? v : "for";
  if (next !== ui.view && !ui.jumping) { ui.q = ""; ui.loose = false; }
  ui.jumping = false;
  ui.view = next;
  ui.focus = null;
  refresh({keepScroll: false});
  window.scrollTo(0, 0);
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
  let entry = u.prev;
  if (!entry) entry = SEED.has(u.id) ? {s: SEED.get(u.id), r: tierOf(SEED.get(u.id)), seen: 1, src: "profile"} : {};
  state.films[u.id] = Object.assign({}, entry, {t: nowISO()});
  saveLocal();
  queuePush();
  refresh({keepBar: true});
  toast("Undone");
}
let toastTimer = null;
function toast(text, canUndo) {
  $("toastText").textContent = text;
  $("toastUndo").hidden = !canUndo;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $("toast").hidden = true; }, 5000);
}
function focusRow(id) {
  ui.focus = id;
  document.querySelectorAll(".film.is-focus").forEach(n => n.classList.remove("is-focus"));
  const row = document.querySelector(`.view:not([hidden]) .film[data-id="${CSS.escape(id)}"]`);
  if (row) { row.classList.add("is-focus"); row.focus({preventScroll: true}); row.scrollIntoView({block: "nearest"}); }
}
/* Open a film from anywhere: films you've seen open in Rated, everything else in For you. */
function jump(id, open) {
  const f = BY.get(id);
  if (!f) return;
  if (open) ui.open.add(id);
  if (isDone(eff(id))) {
    ui.rf = "all"; ui.rq = "";
    if (ui.view !== "rated") location.hash = "#rated"; else refresh();
  } else {
    ui.q = f.t; ui.tag = null; ui.dir = ""; ui.svc = new Set(); ui.len = "any"; ui.shown = PAGE; ui.loose = true; ui.jumping = true;
    if (ui.view !== "for") location.hash = "#for"; else { ui.jumping = false; refresh(); }
  }
  setTimeout(() => focusRow(id), 30);
}
function setDir(name) {
  ui.dir = name || ""; ui.shown = PAGE; ui.loose = false;
  if (ui.view === "rated" || ui.view === "taste") location.hash = "#for"; else refresh();
}
/* The director box takes an exact name from the list, or the best partial match when you press Enter or leave it. */
function dirFrom(text, partial) {
  const k = foldKey(text);
  if (!k) return "";
  const exact = DIRS.find(([d]) => foldKey(d) === k);
  if (exact || !partial) return exact ? exact[0] : null;
  const part = DIRS.find(([d]) => foldKey(d).startsWith(k)) || DIRS.find(([d]) => foldKey(d).split(" ").some(w => w.startsWith(k))) || DIRS.find(([d]) => foldKey(d).includes(k));
  return part ? part[0] : null;
}
function refocus(sel) {
  const el = document.querySelector(`.view:not([hidden]) ${sel}`);
  if (el) el.focus();
}

/* ---------- Events ---------- */
function wire() {
  window.addEventListener("hashchange", route);
  // A poster that fails to load (e.g. a film that has left the pool) becomes a blank tile instead of a broken image.
  document.addEventListener("error", e => {
    const t = e.target;
    if (t && t.tagName === "IMG" && !t.dataset.dead) { t.dataset.dead = "1"; t.removeAttribute("src"); t.classList.add("blank"); }
  }, true);
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-act], [data-set], [data-theme-set]");
    if (!b) return;
    if (b.dataset.themeSet) { setCfg({theme: b.dataset.themeSet}); return; }
    if (b.dataset.set) {
      const k = b.dataset.set;
      ui[k] = b.dataset.v;
      ui.shown = PAGE;
      refresh({keepBar: false});
      refocus(`[data-set="${k}"][data-v="${CSS.escape(b.dataset.v)}"]`);
      return;
    }
    const a = b.dataset.act, row = b.closest("[data-id]"), id = row && row.dataset.id;
    if (a === "open" && id) { ui.open.has(id) ? ui.open.delete(id) : ui.open.add(id); ui.focus = id; refresh({keepBar: true}); return; }
    if (a === "tag") {
      const key = b.dataset.key;
      if (key.startsWith("d:")) { setDir(key.slice(2)); return; }
      ui.tag = key; ui.q = ""; ui.loose = false; ui.shown = PAGE;
      if (ui.view !== "for") location.hash = "#for"; else refresh();
      window.scrollTo(0, $("barFor").offsetTop - 60);
      return;
    }
    if (a === "untag") { ui.tag = null; refresh(); return; }
    if (a === "dir") { setDir(ui.dir === b.dataset.key ? "" : b.dataset.key); return; }
    if (a === "undir") { setDir(""); return; }
    if (a === "svc") {
      const k = b.dataset.key;
      ui.svc.has(k) ? ui.svc.delete(k) : ui.svc.add(k);
      ui.shown = PAGE;
      refresh();
      refocus(`[data-act="svc"][data-key="${CSS.escape(k)}"]`);
      return;
    }
    if (a === "svcall") { ui.svc = new Set(); ui.shown = PAGE; refresh(); refocus(`[data-act="svcall"]`); return; }
    if (a === "en") { setCfg({en: b.dataset.v === "1" ? 1 : 0}, true); refocus(`[data-act="en"][data-v="${b.dataset.v}"]`); return; }
    if (a === "loose" || a === "unloose") { ui.loose = a === "loose"; ui.shown = PAGE; refresh({keepBar: true}); return; }
    if (a === "rf") { ui.rf = ui.rf === b.dataset.v && b.dataset.v !== "all" ? "all" : b.dataset.v; refresh(); refocus(`[data-act="rf"][data-v="${CSS.escape(b.dataset.v)}"]`); return; }
    if (a === "roll") { ui.roll++; renderTonight(); return; }
    if (a === "jump" || a === "jumpopen") { jump(b.dataset.id2, true); return; }
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
  document.addEventListener("focusin", e => preview(e, true));
  document.addEventListener("focusout", e => preview(e, false));
  $("moreFor").addEventListener("click", () => { ui.shown += PAGE; refresh({keepBar: true}); });
  document.addEventListener("input", e => {
    const t = e.target;
    if (t.id === "q") {
      ui.q = t.value; ui.shown = PAGE; ui.loose = false;
      clearTimeout(wire.t);
      wire.t = setTimeout(() => refresh({keepBar: true}), 120);
    } else if (t.id === "rq") {
      ui.rq = t.value;
      clearTimeout(wire.t);
      wire.t = setTimeout(() => refresh({keepBar: true}), 120);
    } else if (t.id === "dirq") {
      // Picking from the suggestions, or typing a full name, applies at once; clearing the box shows every director.
      const d = dirFrom(t.value, false);
      if (d !== null && d !== ui.dir) { ui.dir = d; ui.shown = PAGE; ui.loose = false; refresh({keepBar: true}); }
    }
  });
  document.addEventListener("change", e => {
    const t = e.target;
    if (t.id === "sort") { ui.sort = t.value; ui.shown = PAGE; refresh({keepBar: true}); }
    else if (t.id === "rsort") { ui.rsort = t.value; refresh({keepBar: true}); }
    else if (t.id === "svcMore" && t.value) { ui.svc.add(t.value); ui.shown = PAGE; refresh(); refocus("#svcMore"); }
    else if (t.id === "dirq") {
      const d = dirFrom(t.value, true);
      if (d === null) { toast(`No director called “${t.value}” in the pool`); t.value = ui.dir; return; }
      t.value = d;
      if (d !== ui.dir) { ui.dir = d; ui.shown = PAGE; ui.loose = false; refresh({keepBar: true}); }
    }
  });
  $("toastUndo").addEventListener("click", undoLast);
  document.addEventListener("keydown", e => {
    if (e.target.closest("input, select, textarea, dialog")) {
      if (e.key === "Escape" && /^(q|rq|dirq)$/.test(e.target.id)) e.target.blur();
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
    if (k === "o" || k === "Enter") { e.preventDefault(); ui.open.has(id) ? ui.open.delete(id) : ui.open.add(id); refresh({keepBar: true}); focusRow(id); }
    else if (k === "w") { act(id, "want"); move(); }
    else if (k === "x") { act(id, "pass"); move(); }
    else if (k === "s") { act(id, "seen"); }
    else if (/^[0-9]$/.test(k)) { act(id, "rate", k === "0" ? 10 : Number(k)); move(); }
    else if (k === "Escape") { ui.rating.delete(id); refresh({keepBar: true}); focusRow(id); }
  });
  const setTop = () => document.documentElement.style.setProperty("--top-h", document.querySelector(".top").offsetHeight + "px");
  window.addEventListener("resize", setTop);
  setTop();
  wireSettings();
}

/* ---------- Settings ---------- */
function setCfg(patch, rebar) {
  state.cfg = cfg = Object.assign({}, cfg, patch, {t: nowISO()});
  saveLocal();
  queuePush();
  applyTheme();
  fillSettings();
  refresh({keepBar: !rebar});
}
function applyTheme() {
  if (cfg.theme === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = cfg.theme;
}
function fillSettings() {
  $("svcChecks").innerHTML = OWNABLE.map(k => {
    const s = SVC[k];
    return `<label class="check"><input type="checkbox" data-svc="${k}"${cfg.svc[k] ? " checked" : ""}> <span>${esc(s.n)}${s.p && !cfg.svc[k] ? ` <small>£${s.p.toFixed(2)}</small>` : ""}${k === "hbo" ? ` <small>via NOW</small>` : ""}</span></label>`;
  }).join("");
  $("flagChecks").innerHTML = Object.entries(FLAGS).map(([k, l]) => `<label class="check"><input type="checkbox" data-flag="${k}"${cfg.hide[k] ? " checked" : ""}> ${esc(l)}</label>`).join("");
  $("cfgFree").checked = !!cfg.free;
  document.querySelectorAll("[data-theme-set]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.themeSet === cfg.theme)));
  const share = $("cfgShare");
  if (share) share.checked = cfg.share === 1;
  renderSync();
}
function openSettings(focusId) {
  const d = $("settings");
  fillSettings();
  if (typeof d.showModal === "function") { if (!d.open) d.showModal(); } else d.setAttribute("open", "");
  const focus = () => { const el = focusId && $(focusId); if (el) el.focus(); };
  setTimeout(focus, 30);
  if (!sync) checkVault(true).then(() => { renderSync(); setTimeout(focus, 30); });
}
function wireSettings() {
  const d = $("settings");
  $("openSettings").addEventListener("click", () => openSettings());
  $("closeSettings").addEventListener("click", () => { if (typeof d.close === "function") d.close(); else d.removeAttribute("open"); });
  d.addEventListener("change", e => {
    const t = e.target;
    if (t.dataset.svc) setCfg({svc: Object.assign({}, cfg.svc, {[t.dataset.svc]: t.checked ? 1 : 0})});
    else if (t.dataset.flag) setCfg({hide: Object.assign({}, cfg.hide, {[t.dataset.flag]: t.checked ? 1 : 0})});
    else if (t.id === "cfgFree") setCfg({free: t.checked ? 1 : 0});
    else if (t.id === "cfgShare") setCfg({share: t.checked ? 1 : 0});
    else if (t.id === "importFile" && t.files && t.files[0]) importFile(t.files[0]);
  });
  d.addEventListener("submit", e => {
    e.preventDefault();
    const f = e.target;
    if (f.id === "unlockForm") doUnlock(f);
    else if (f.id === "setupForm") doSetup(f);
    else if (f.id === "tokenForm") doReplaceToken(f);
  });
  d.addEventListener("click", e => {
    const b = e.target.closest("[data-sync]");
    if (!b) return;
    const a = b.dataset.sync;
    if (a === "pair") showPair();
    else if (a === "copy") copyPair(b);
    else if (a === "now") pullAndMerge(true);
    else if (a === "forget") forgetBrowser();
    else if (a === "recheck") { b.textContent = "Checking…"; checkVault(true).then(() => renderSync(true)); }
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
    if (!confirm("Clear every rating, want and pass, including the ones from your profile? Export first if you might want them back.")) return;
    const t = nowISO();
    for (const id of new Set([...Object.keys(state.films), ...SEED.keys()])) state.films[id] = {t};
    saveLocal(); queuePush(); refresh(); toast("Cleared all ratings");
  });
}
function importFile(file) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const incoming = normState(JSON.parse(r.result));
      state = merge(state, incoming); cfg = state.cfg;
      saveLocal(); queuePush(); applyTheme(); fillSettings(); refresh();
      toast(`Imported ${Object.keys(incoming.films).length} entries`);
    } catch (e) { syncErr("That file isn’t a Dread List export."); }
  };
  r.readAsText(file);
}

/* ---------- Sync: end-to-end encrypted in the public dread-sync repo ----------
   vault.json holds the GitHub token encrypted with a key derived from your passphrase (PBKDF2-SHA256, 600,000 rounds,
   AES-256-GCM). state.json holds your ratings and settings encrypted with the same key. Any browser that knows the
   passphrase can unlock the token and sync. GitHub only ever stores ciphertext, plus an optional taste summary
   (film ids, no dates) that the nightly rebuild and the weekly curator read. The token can only touch dread-sync. */
const SYNC_OWNER = "CyberSecDigestDaily", SYNC_NAME = "dread-sync", SYNC_REPO = SYNC_OWNER + "/" + SYNC_NAME;
const SYNC_API = "https://api.github.com/repos/" + SYNC_REPO;
const KDF_ITER = 600000, CREDS = "dread.sync.v2", AAD_VAULT = "dread-vault-v1", AAD_STATE = "dread-state-v1";
const NEW_REPO_URL = `https://github.com/new?owner=${SYNC_OWNER}&name=${SYNC_NAME}&visibility=public&description=${encodeURIComponent("Encrypted sync data for the Dread List")}`;
const NEW_TOKEN_URL = `https://github.com/settings/personal-access-tokens/new?name=${encodeURIComponent("Dread List sync")}&description=${encodeURIComponent("Sync for cybersecdigestdaily.github.io/dread. Repository access: only dread-sync.")}&target_name=${SYNC_OWNER}&expires_in=366&contents=write`;
let sync = null, syncKey = null, shaState = null, lastPull = 0, syncState = {kind: null, text: "Ratings are saved in this browser only."};
let vaultInfo = {checked: false, repo: null, vault: null};

const te = new TextEncoder(), td = new TextDecoder();
const toB64 = bytes => { let s = ""; new Uint8Array(bytes).forEach(b => { s += String.fromCharCode(b); }); return btoa(s); };
const fromB64 = s => Uint8Array.from(atob(String(s).replace(/\s/g, "")), c => c.charCodeAt(0));
const b64enc = str => toB64(te.encode(str));
const b64dec = s => td.decode(fromB64(s));
const b64url = str => b64enc(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = s => { const t = s.replace(/-/g, "+").replace(/_/g, "/"); return b64dec(t + "=".repeat((4 - t.length % 4) % 4)); };
const timeNow = () => new Date().toLocaleTimeString("en-GB", {hour: "2-digit", minute: "2-digit"});

async function deriveKey(pass, salt, iter) {
  const base = await crypto.subtle.importKey("raw", te.encode(pass.normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({name: "PBKDF2", hash: "SHA-256", salt, iterations: iter}, base, {name: "AES-GCM", length: 256}, true, ["encrypt", "decrypt"]);
}
async function seal(key, text, aad) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({name: "AES-GCM", iv, additionalData: te.encode(aad)}, key, te.encode(text));
  return {iv: toB64(iv), ct: toB64(ct)};
}
async function unseal(key, box, aad) {
  return td.decode(await crypto.subtle.decrypt({name: "AES-GCM", iv: fromB64(box.iv), additionalData: te.encode(aad)}, key, fromB64(box.ct)));
}
const importRaw = b64 => crypto.subtle.importKey("raw", fromB64(b64), {name: "AES-GCM"}, true, ["encrypt", "decrypt"]);
const exportRaw = async key => toB64(await crypto.subtle.exportKey("raw", key));

function ghHeaders(token, json) {
  return Object.assign({"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"},
    token ? {"Authorization": "Bearer " + token} : {}, json ? {"Content-Type": "application/json"} : {});
}
function httpError(res) {
  const e = new Error(res.status === 401 ? "GitHub rejected the token: it has expired or been revoked. Replace it under Sync in Settings."
    : res.status === 403 ? "The token can’t write to dread-sync. It needs Contents: read and write on that repository."
    : res.status === 404 ? "dread-sync wasn’t found, or the token can’t see it."
    : `GitHub returned an error (${res.status}).`);
  e.status = res.status;
  return e;
}
async function ghFile(path, token) {
  const res = await fetch(`${SYNC_API}/contents/${path}`, {cache: "no-store", headers: ghHeaders(token)});
  if (res.status === 404) return null;
  if (!res.ok) throw httpError(res);
  const j = await res.json();
  return {sha: j.sha, data: JSON.parse(b64dec(j.content))};
}
function ghWrite(path, token, data, sha, message) {
  return fetch(`${SYNC_API}/contents/${path}`, {method: "PUT", headers: ghHeaders(token, true),
    body: JSON.stringify(Object.assign({message, content: b64enc(JSON.stringify(data) + "\n")}, sha ? {sha} : {}))});
}

/* Credentials on this browser: localStorage when remembered, sessionStorage otherwise. */
function loadCreds() {
  for (const s of ["localStorage", "sessionStorage"]) {
    try { const c = JSON.parse(window[s].getItem(CREDS)); if (c && c.token && c.key) return c; } catch (e) { /* blocked */ }
  }
  return null;
}
function credsRemembered() { try { return !!localStorage.getItem(CREDS); } catch (e) { return false; } }
function dropCreds() { for (const s of ["localStorage", "sessionStorage"]) { try { window[s].removeItem(CREDS); } catch (e) { /* blocked */ } } }
async function useCreds(c, remember) {
  syncKey = await importRaw(c.key);
  sync = {token: c.token, key: c.key};
  dropCreds();
  try { (remember ? localStorage : sessionStorage).setItem(CREDS, JSON.stringify(sync)); } catch (e) { /* storage blocked: synced for this page only */ }
}

function setStatus(kind, text) {
  syncState = {kind, text};
  $("syncDot").className = "dot" + (kind ? " " + kind : "");
  $("openSettings").title = text;
  const line = document.querySelector("#syncBox .sync-status");
  if (line) line.innerHTML = statusHTML();
  syncNote();
}
const statusHTML = () => `<span class="dot${syncState.kind ? " " + syncState.kind : ""}" aria-hidden="true"></span>${esc(syncState.text)}`;
function syncErr(text) {
  const e = $("sErr");
  if (e) { e.textContent = text; e.hidden = false; } else toast(text);
}
function busy(form, on, label) {
  const b = form.querySelector("button[type=submit]");
  if (!b) return;
  if (on) { b.dataset.label = b.textContent; b.textContent = label; b.disabled = true; const e = $("sErr"); if (e) e.hidden = true; }
  else { b.disabled = false; if (b.dataset.label) b.textContent = b.dataset.label; }
}

async function checkVault(force) {
  if (vaultInfo.checked && !force) return vaultInfo;
  try {
    const r = await fetch(SYNC_API, {cache: "no-store", headers: ghHeaders()});
    const repo = r.ok ? true : r.status === 404 ? false : null;
    vaultInfo = {checked: true, repo, vault: repo ? !!(await ghFile("vault.json")) : false};
  } catch (e) { vaultInfo = {checked: true, repo: null, vault: null}; }
  if (!sync && vaultInfo.vault) setStatus(null, "Sync is set up but locked on this browser.");
  syncNote();
  return vaultInfo;
}
function syncNote() {
  const n = $("syncNote");
  if (!n) return;
  let dismissed = false;
  try { dismissed = sessionStorage.getItem("dread.note") === "1"; } catch (e) { /* blocked */ }
  if (sync || dismissed || !vaultInfo.checked || vaultInfo.vault === null) { n.hidden = true; return; }
  n.innerHTML = vaultInfo.vault
    ? `<span>Your ratings aren’t syncing on this browser.</span><button type="button" class="btn" data-note="open">Unlock sync</button><button type="button" class="act quiet" data-note="hide">Not now</button>`
    : `<span>Rate on your phone, laptop and PC alike: sync takes two minutes to set up.</span><button type="button" class="btn" data-note="open">Set up sync</button><button type="button" class="act quiet" data-note="hide">Not now</button>`;
  n.hidden = false;
}

let syncMode = null;
function renderSync(force) {
  const box = $("syncBox");
  if (!box) return;
  const mode = sync ? "on" : vaultInfo.vault ? "locked" : vaultInfo.checked ? "setup" : "checking";
  if (mode === syncMode && !force && box.childElementCount) { const line = box.querySelector(".sync-status"); if (line) line.innerHTML = statusHTML(); return; }
  syncMode = mode;
  const user = `<input type="text" name="username" autocomplete="username" value="Dread List sync" class="sr" tabindex="-1" readonly aria-hidden="true">`;
  let body = "";
  if (mode === "on") {
    body = `<p class="hint">Ratings, wants, passes and settings follow you to every browser you unlock. They’re saved encrypted in <a href="https://github.com/${SYNC_REPO}" target="_blank" rel="noopener noreferrer">${SYNC_NAME}</a>.</p>
      <div class="btns left"><button type="button" class="btn" data-sync="pair">Add a device</button><button type="button" class="btn ghost" data-sync="now">Sync now</button><button type="button" class="btn ghost" data-sync="forget">Forget this browser</button></div>
      <div id="pairBox" class="pair" hidden><div id="qr" class="qr"></div><div><p class="hint">Scan this with your phone’s camera, or send yourself the link. It carries your sync key: anyone with it can read and change your ratings, so keep it to yourself.</p><div class="btns left"><button type="button" class="btn ghost" data-sync="copy">Copy link</button></div></div></div>
      <label class="check"><input type="checkbox" id="cfgShare"${cfg.share === 1 ? " checked" : ""}> <span>Tailor new films to me: publish a taste summary in ${SYNC_NAME} (the ids of films you rated, grouped as loved, liked, meh or disliked, wanted or passed; no scores, no dates, nothing else). The nightly rebuild then pulls in films similar to them and the Sunday curator reads it. Off means everything stays encrypted.</span></label>
      <details><summary>Replace the token</summary><form id="tokenForm" class="syncform">
        <label for="rTok">New token</label><input id="rTok" type="password" autocomplete="off" spellcheck="false" placeholder="github_pat_…" required>
        <div class="btns left"><button type="submit" class="btn">Save token</button><a class="btn ghost" href="${NEW_TOKEN_URL}" target="_blank" rel="noopener noreferrer">Create a token</a></div></form></details>`;
  } else if (mode === "locked") {
    body = `<p class="hint">Sync is set up. Unlock it on this browser with your passphrase.</p>
      <form id="unlockForm" class="syncform">${user}
        <label for="uPass">Passphrase</label><input id="uPass" name="password" type="password" autocomplete="current-password" required>
        <label class="check"><input type="checkbox" id="uRemember" checked> Remember on this browser</label>
        <div class="btns left"><button type="submit" class="btn">Unlock</button></div>
      </form>
      <p class="hint">If Firefox clears site data when it closes, let it save this passphrase and it will fill it in for you, or add an exception for cybersecdigestdaily.github.io under Settings, Privacy &amp; Security, Cookies and Site Data.</p>`;
  } else if (mode === "setup") {
    body = `<p class="hint">Three one-off steps here. Every other browser then only needs your passphrase.</p>
      <ol class="steps">
        <li><a href="${NEW_REPO_URL}" target="_blank" rel="noopener noreferrer">Create the dread-sync repository</a>. Everything is prefilled; just press Create repository. Your ratings are encrypted before they’re saved there.
          ${vaultInfo.repo ? `<span class="okay">Found it.</span>` : `<button type="button" class="act quiet" data-sync="recheck">I’ve created it</button>`}</li>
        <li><a href="${NEW_TOKEN_URL}" target="_blank" rel="noopener noreferrer">Create a token</a>. Name, expiry and Contents: Read and write are prefilled. Under Repository access choose Only select repositories, then dread-sync, and press Generate token.</li>
        <li>Paste the token and choose a passphrase of four or more random words.</li>
      </ol>
      <form id="setupForm" class="syncform">${user}
        <label for="sTok">Token</label><input id="sTok" type="password" autocomplete="off" spellcheck="false" placeholder="github_pat_…" required>
        <label for="sPass">Passphrase</label><input id="sPass" name="password" type="password" autocomplete="new-password" minlength="12" required>
        <label for="sPass2">Passphrase again</label><input id="sPass2" type="password" autocomplete="new-password" minlength="12" required>
        <div class="btns left"><button type="submit" class="btn">Turn on sync</button></div>
      </form>`;
  } else {
    body = `<p class="hint">Checking for sync…</p>`;
  }
  box.innerHTML = `<p class="sync-status">${statusHTML()}</p>${body}<p class="err" id="sErr" hidden></p>`;
}

async function doSetup(form) {
  const token = form.querySelector("#sTok").value.trim(), pass = form.querySelector("#sPass").value, pass2 = form.querySelector("#sPass2").value;
  if (!/^(github_pat_|ghp_)\w{20,}$/.test(token)) { syncErr("That doesn’t look like a GitHub token. It should start with github_pat_."); return; }
  if (pass.length < 12) { syncErr("Use a passphrase of at least 12 characters. Four random words works well."); return; }
  if (pass !== pass2) { syncErr("The two passphrases don’t match."); return; }
  busy(form, true, "Turning on sync…");
  try {
    const repo = await fetch(SYNC_API, {cache: "no-store", headers: ghHeaders(token)});
    if (repo.status === 404) throw new Error("Create the dread-sync repository first (step 1), then try again.");
    if (!repo.ok) throw httpError(repo);
    const existing = await ghFile("vault.json", token);
    let key, salt, iter = KDF_ITER;
    if (existing) {
      iter = existing.data.iter || KDF_ITER;
      salt = existing.data.salt;
      key = await deriveKey(pass, fromB64(salt), iter);
      try { await unseal(key, existing.data, AAD_VAULT); } catch (e) { throw new Error("Sync already exists with a different passphrase. Unlock it instead, or delete vault.json in dread-sync to start again."); }
    } else {
      const s = crypto.getRandomValues(new Uint8Array(16));
      salt = toB64(s);
      key = await deriveKey(pass, s, iter);
    }
    const res = await ghWrite("vault.json", token, Object.assign({v: 1, kdf: "PBKDF2-SHA256", iter, salt}, await seal(key, token, AAD_VAULT)),
      existing && existing.sha, existing ? "Update the sync token" : "Set up sync");
    if (!res.ok) throw httpError(res);
    await useCreds({token, key: await exportRaw(key)}, true);
    vaultInfo = {checked: true, repo: true, vault: true};
    await ensureReadme();
    await pullAndMerge(true);
    renderSync(true);
    toast("Sync is on. Unlock your other browsers with the passphrase.");
  } catch (e) { busy(form, false); syncErr(e.message); }
}
async function doUnlock(form) {
  const pass = form.querySelector("#uPass").value, remember = form.querySelector("#uRemember").checked;
  busy(form, true, "Unlocking…");
  try {
    const v = await ghFile("vault.json");
    if (!v) throw new Error("Sync isn’t set up yet. Set it up on one browser first.");
    const key = await deriveKey(pass, fromB64(v.data.salt), v.data.iter || KDF_ITER);
    let token;
    try { token = await unseal(key, v.data, AAD_VAULT); } catch (e) { throw new Error("That passphrase doesn’t unlock sync."); }
    await useCreds({token, key: await exportRaw(key)}, remember);
    await pullAndMerge(true);
    renderSync(true);
    toast("Sync unlocked on this browser");
  } catch (e) { busy(form, false); syncErr(e.message); }
}
async function doReplaceToken(form) {
  const token = form.querySelector("#rTok").value.trim();
  if (!/^(github_pat_|ghp_)\w{20,}$/.test(token)) { syncErr("That doesn’t look like a GitHub token. It should start with github_pat_."); return; }
  busy(form, true, "Saving…");
  try {
    const cur = await ghFile("vault.json", token);
    if (!cur) throw new Error("vault.json is missing from dread-sync. Forget this browser and set sync up again.");
    const res = await ghWrite("vault.json", token, Object.assign({}, cur.data, await seal(syncKey, token, AAD_VAULT)), cur.sha, "Replace the sync token");
    if (!res.ok) throw httpError(res);
    await useCreds({token, key: sync.key}, credsRemembered());
    await pullAndMerge(true);
    renderSync(true);
    toast("Token replaced. Other browsers pick it up next time you unlock them.");
  } catch (e) { busy(form, false); syncErr(e.message); }
}
async function ensureReadme() {
  try {
    if (await ghFile("README.md", sync.token)) return;
    const text = "# dread-sync\n\nEncrypted sync data for the Dread List (https://cybersecdigestdaily.github.io/dread/).\n\n" +
      "- `vault.json`: the sync token, encrypted with a key derived from a passphrase (PBKDF2-SHA256, 600,000 rounds, AES-256-GCM).\n" +
      "- `state.json`: ratings and settings, encrypted with the same key. Its `taste` field is an optional plaintext summary (film ids only, no dates) used by the nightly rebuild and the weekly curator.\n\n" +
      "Every save from the page is a commit. Nothing here is readable without the passphrase except `taste`.\n";
    await fetch(`${SYNC_API}/contents/README.md`, {method: "PUT", headers: ghHeaders(sync.token, true), body: JSON.stringify({message: "Explain the files", content: b64enc(text)})});
  } catch (e) { /* optional */ }
}
function forgetBrowser() {
  if (!confirm("Stop syncing on this browser? Your ratings stay here and in sync, and you can unlock again with your passphrase.")) return;
  dropCreds();
  sync = null; syncKey = null; shaState = null;
  vaultInfo = {checked: true, repo: true, vault: true};
  setStatus(null, "Sync is locked on this browser.");
  renderSync(true);
}

/* Pairing: a link carrying the token and key in the URL fragment, which browsers never send to a server. */
const pairLink = () => location.origin + location.pathname + "#pair=" + b64url(JSON.stringify({t: sync.token, k: sync.key}));
function loadScript(src) {
  return new Promise((ok, fail) => {
    if (window.qrcode) { ok(); return; }
    const s = document.createElement("script");
    s.src = src; s.onload = ok; s.onerror = fail;
    document.head.append(s);
  });
}
function qrSVG(text) {
  const qr = window.qrcode(0, "L");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount(), m = 4;
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + m} ${r + m}h1v1h-1z`;
  return `<svg viewBox="0 0 ${n + 2 * m} ${n + 2 * m}" width="240" height="240" shape-rendering="crispEdges" role="img" aria-label="QR code for the pairing link"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
async function showPair() {
  const box = $("pairBox");
  if (!box || !sync) return;
  box.hidden = !box.hidden;
  if (box.hidden) return;
  try { await loadScript("vendor/qrcode.js"); $("qr").innerHTML = qrSVG(pairLink()); }
  catch (e) { $("qr").textContent = "The QR code didn’t load. Copy the link instead."; }
}
async function copyPair(btn) {
  try { await navigator.clipboard.writeText(pairLink()); btn.textContent = "Copied"; }
  catch (e) { window.prompt("Copy this link", pairLink()); }
  setTimeout(() => { btn.textContent = "Copy link"; }, 2000);
}
async function acceptPair() {
  const m = /^#pair=([A-Za-z0-9_-]+)$/.exec(location.hash);
  if (!m) return false;
  history.replaceState(null, "", location.pathname + location.search + "#for");
  try {
    const c = JSON.parse(unb64url(m[1]));
    if (!c.t || !c.k) throw new Error("bad link");
    await useCreds({token: c.t, key: c.k}, true);
    toast("This browser is now synced");
    return true;
  } catch (e) {
    toast("That pairing link didn’t work. Unlock with your passphrase in Settings instead.");
    return false;
  }
}
/* State file: pull, merge by per-film timestamps, push. */
async function pullRemote() {
  const f = await ghFile("state.json", sync.token);
  if (!f) { shaState = null; return normState(null); }
  shaState = f.sha;
  if (!f.data || !f.data.ct) return normState(null);
  try { return normState(JSON.parse(await unseal(syncKey, f.data, AAD_STATE))); }
  catch (e) { throw new Error("Couldn’t decrypt the synced ratings. If the passphrase changed on another browser, forget this one and unlock again."); }
}
function merge(a, b) {
  const out = {v: 2, films: Object.assign({}, a.films), cfg: a.cfg};
  for (const [id, e] of Object.entries(b.films || {})) { const cur = out.films[id]; if (!cur || String(e.t || "") > String(cur.t || "")) out.films[id] = e; }
  if (b.cfg && String(b.cfg.t || "") > String((a.cfg && a.cfg.t) || "")) out.cfg = b.cfg;
  return out;
}
const same = (a, b) => JSON.stringify([Object.entries(a.films).sort(), a.cfg]) === JSON.stringify([Object.entries(b.films).sort(), b.cfg]);
function tasteSummary() {
  const t = {updated: todayISO(), loved: [], liked: [], meh: [], disliked: [], want: [], pass: [], svc: OWNABLE.filter(k => cfg.svc[k])};
  for (const f of FILMS) {
    const e = eff(f.id);
    if (e.s) t[tierOf(e.s)].push(f.id); else if (e.w) t.want.push(f.id); else if (e.x) t.pass.push(f.id);
  }
  return t;
}
async function pushNow() {
  const body = async () => Object.assign({v: 1}, await seal(syncKey, JSON.stringify(state), AAD_STATE), cfg.share === 1 && FILMS.length ? {taste: tasteSummary()} : {});
  const msg = () => `Sync ${nowISO().slice(0, 16)}Z`;
  let res = await ghWrite("state.json", sync.token, await body(), shaState, msg());
  if (res.status === 409 || res.status === 422) {
    const remote = await pullRemote();
    state = merge(state, remote); cfg = state.cfg; saveLocal();
    res = await ghWrite("state.json", sync.token, await body(), shaState, msg());
  }
  if (!res.ok) throw httpError(res);
  shaState = (await res.json()).content.sha;
}
let pushTimer = null, pushing = false, again = false;
function queuePush() {
  if (!sync) return;
  setStatus("busy", "Saving…");
  clearTimeout(pushTimer);
  pushTimer = setTimeout(runPush, 1200);
}
async function runPush() {
  if (pushing) { again = true; return; }
  pushing = true;
  try { await pushNow(); setStatus("on", `Synced at ${timeNow()}`); }
  catch (e) { setStatus("err", e.message + " Ratings are still saved in this browser."); }
  finally { pushing = false; if (again) { again = false; runPush(); } }
}
async function pullAndMerge(force) {
  if (!sync || (!force && Date.now() - lastPull < 60000)) return;
  lastPull = Date.now();
  setStatus("busy", "Syncing…");
  try {
    const remote = await pullRemote(), merged = merge(state, remote);
    const changedLocal = !same(merged, state), changedRemote = !same(merged, remote) || !shaState;
    state = merged; cfg = state.cfg; saveLocal();
    if (changedLocal && FILMS.length) { applyTheme(); refresh({keepBar: true}); }
    if (changedRemote) await pushNow();
    setStatus("on", `Synced at ${timeNow()}`);
  } catch (e) { setStatus("err", e.message); }
}

/* ---------- Boot ---------- */
async function boot() {
  applyTheme();
  wire();
  store.del("dread.sync.v1"); // the previous version's per-browser token, no longer used
  $("syncNote").addEventListener("click", e => {
    const b = e.target.closest("[data-note]");
    if (!b) return;
    if (b.dataset.note === "open") openSettings(vaultInfo.vault ? "uPass" : null);
    else { try { sessionStorage.setItem("dread.note", "1"); } catch (err) { /* blocked */ } syncNote(); }
  });
  try {
    const res = await fetch("data.json", {cache: "no-cache"});
    if (!res.ok) throw new Error(String(res.status));
    prepare(await res.json());
  } catch (e) {
    $("boot").textContent = "The film data didn’t load. Check your connection and refresh the page.";
    return;
  }
  $("boot").remove();
  const when = DATA_CHECKED && !isNaN(DATA_CHECKED) ? DATA_CHECKED.toLocaleString("en-GB", {day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"}) : "unknown";
  $("source").textContent = `UK availability, prices and scores from JustWatch, refreshed every morning (last check ${when}). Subgenres from Wikidata. Gore marked ~ is estimated from the certificate and synopsis. BBC iPlayer needs a TV licence.`;
  if (!(await acceptPair())) {
    const c = loadCreds();
    if (c) { try { await useCreds(c, credsRemembered()); } catch (e) { dropCreds(); } }
  }
  setStatus(sync ? "busy" : null, sync ? "Syncing…" : "Ratings are saved in this browser only.");
  route();
  if (sync) pullAndMerge(true); else checkVault();
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") pullAndMerge(); });
}
boot();
