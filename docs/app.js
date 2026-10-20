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
const DEFAULT_CFG = {svc: {nf: 1, pv: 1, dp: 1, hbo: 1, nowe: 1, cr: 1}, free: 1, hide: {}, theme: "auto", t: ""};
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
const RATE = {disliked: -2, meh: -0.5, liked: 1, loved: 2};
const RATE_ORDER = ["disliked", "meh", "liked", "loved"];
const RATE_LABEL = {disliked: "Disliked", meh: "Meh", liked: "Liked", loved: "Loved"};
const SIG_WANT = 0.6, SIG_PASS = -1, SHRINK = 1.5;
const PRIOR = {"e:pre-1980": -0.6, "e:1980s": -0.2, "g:X": -1.2, "f:sexual-violence": -1.5, "f:spiders": -0.4, "f:snakes": -0.4, "f:child-harm": -0.3, "f:animal-harm": -0.3};
const REGION = {GB: "uk-ie", IE: "uk-ie", US: "us", KR: "korea", JP: "japan", ES: "spain", FR: "france", IT: "italy",
  DE: "germany", AT: "germany", NO: "nordic", SE: "nordic", DK: "nordic", FI: "nordic", IS: "nordic", AR: "latam", MX: "latam",
  BR: "latam", CL: "latam", CO: "latam", UY: "latam", PE: "latam", CA: "canada", AU: "anz", NZ: "anz", TH: "asia", TW: "asia",
  ID: "asia", PH: "asia", MY: "asia", HK: "asia", CN: "asia", IN: "asia", VN: "asia", SG: "asia"};
const REGION_LABEL = {"uk-ie": "British & Irish", us: "American", korea: "Korean", japan: "Japanese", spain: "Spanish",
  france: "French", italy: "Italian", germany: "German-language", nordic: "Nordic", latam: "Latin American", canada: "Canadian",
  anz: "Australian & NZ", asia: "Other Asian", other: "Elsewhere"};
const PAGE = 40, WILD_EVERY = 7, SOON_DAYS = 30, NEW_DAYS = 14;
const KEY_STATE = "dread.state.v1", KEY_SYNC = "dread.sync.v1";
const MONEY_KEY = "moneyplan.gh.token", MONEY_REPO = "CyberSecDigestDaily/money-plan-data", SYNC_FILE = "dread-list.json";

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
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* storage blocked */ } },
  raw(k) { try { return localStorage.getItem(k) || sessionStorage.getItem(k); } catch (e) { return null; } }
};
const svcName = k => SVC[k] ? SVC[k].n : k.startsWith("ch:") ? k.slice(3) : k.startsWith("free:") ? k.slice(5) : k;
const isFree = k => !!(SVC[k] && SVC[k].free) || k.startsWith("free:");

/* ---------- State ---------- */
let FILMS = [], BY = new Map(), SEED = new Map(), NEIGH = new Map(), FEAT = new Map(), DATA_CHECKED = null;
let state = normState(store.get(KEY_STATE));
let sync = store.get(KEY_SYNC), remoteSha = null;
let M = {aff: new Map(), cnt: new Map(), signals: 0};
const ui = {view: "for", q: "", where: "all", gore: "any", len: "any", sort: "match", tag: null, shown: PAGE,
  open: new Set(), rating: new Set(), focus: null, ratedFilter: "all", roll: 0, wild: new Set()};
const undo = [];
let cfg = state.cfg;

function defaultCfg() { return JSON.parse(JSON.stringify(DEFAULT_CFG)); }
function normState(s) {
  const out = {v: 2, films: {}, cfg: defaultCfg()};
  if (!s || typeof s !== "object") return out;
  for (const [id, e] of Object.entries(s.films || {})) {
    if (!e || typeof e !== "object") continue;
    const n = {t: String(e.t || "")};
    if (e.r && RATE[e.r] !== undefined) n.r = e.r;
    else if (typeof e.score === "number" && e.score > 0) n.r = e.score >= 9 ? "loved" : e.score >= 7 ? "liked" : e.score >= 5 ? "meh" : "disliked";
    if (e.seen || n.r) n.seen = 1;
    if (e.w && !n.r) n.w = 1;
    if (e.x && !n.r) n.x = 1;
    if (e.src) n.src = String(e.src);
    out.films[id] = n;
  }
  if (s.cfg && typeof s.cfg === "object") {
    const c = defaultCfg();
    out.cfg = {svc: Object.assign({}, s.cfg.svc || c.svc), free: s.cfg.free === 0 ? 0 : 1, hide: Object.assign({}, s.cfg.hide || {}),
      theme: ["auto", "dark", "light"].includes(s.cfg.theme) ? s.cfg.theme : "auto", t: String(s.cfg.t || "")};
  }
  return out;
}
const EMPTY = Object.freeze({});
function eff(id) {
  const e = state.films[id];
  if (e) return e;
  const s = SEED.get(id);
  return s ? {r: s, seen: 1, src: "profile"} : EMPTY;
}
const sig = e => e.r ? RATE[e.r] : e.x ? SIG_PASS : e.w ? SIG_WANT : null;
function setEntry(id, entry, label) {
  undo.push({id, prev: state.films[id] ? Object.assign({}, state.films[id]) : null});
  if (undo.length > 30) undo.shift();
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
  SEED = new Map(FILMS.filter(f => f.seed && RATE[f.seed] !== undefined).map(f => [f.id, f.seed]));
  NEIGH = new Map();
  const link = (a, b) => { if (!BY.has(a) || !BY.has(b) || a === b) return; if (!NEIGH.has(a)) NEIGH.set(a, new Set()); NEIGH.get(a).add(b); };
  FILMS.forEach(f => (f.sim || []).forEach(j => { link(f.id, j); link(j, f.id); }));
  FEAT = new Map(FILMS.map(f => [f.id, features(f)]));
  DATA_CHECKED = data.checked ? new Date(data.checked) : null;
}
function era(y) { return y >= 2020 ? "2020s" : y >= 2010 ? "2010s" : y >= 2000 ? "2000s" : y >= 1990 ? "1990s" : y >= 1980 ? "1980s" : "pre-1980"; }
function features(f) {
  const m = new Map(), add = (k, w) => { if (!(m.get(k) >= w)) m.set(k, w); };
  (f.tg || []).forEach(t => add("t:" + t, 1));
  (f.ta || []).forEach(t => add("t:" + t, 0.6));
  (f.dir || []).forEach(d => add("d:" + d, 1));
  if (f.y) add("e:" + era(f.y), 0.5);
  if (f.co && f.co[0]) add("c:" + (REGION[f.co[0]] || "other"), 0.4);
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
  return k;
}

/* ---------- Model ----------
   Each film is a bag of weighted features (tags, director, era, region, gore, flags, length). Your affinity for a
   feature is the shrunk mean of your signals on films that have it: loved +2, liked +1, meh -0.5, disliked -2,
   want +0.6, pass -1, pulled toward 0 (or a small prior) until there is evidence. A film's fit is the sum of its
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
const isCandidate = f => { const e = eff(f.id); return !e.r && !e.seen && !e.x; };
const hiddenByFlags = f => (f.fl || []).some(x => cfg.hide[x]);
function hasFeature(f, key) { return FEAT.get(f.id).some(([k]) => k === key); }
function matchesQuery(f, q) {
  const hay = [f.t, f.aka, (f.dir || []).join(" "), (f.tg || []).map(t => TAGS[t] || t).join(" "), String(f.y || "")].join(" ").toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every(w => hay.includes(w));
}
function passes(f, opts) {
  if (hiddenByFlags(f)) return false;
  if (ui.gore !== "any" && GORE_RANK[f.g || "M"] > GORE_RANK[ui.gore]) return false;
  if (opts && opts.basic) return true;
  if (ui.len === "100" && f.rn && f.rn > 100) return false;
  if (ui.tag && !hasFeature(f, ui.tag)) return false;
  if (ui.q && !matchesQuery(f, ui.q)) return false;
  if (ui.where !== "all") {
    const a = avail(f);
    if (ui.where === "tonight" && !a.tonight) return false;
    if (ui.where === "rent" && (a.tonight || !f.rent)) return false;
    if (ui.where === "subs" && (a.tonight || !a.other.some(o => !isFree(o[0])))) return false;
  }
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
function forYouList() {
  const pool = FILMS.filter(f => isCandidate(f) && passes(f));
  let list = pool.slice().sort(SORTS[ui.sort] || SORTS.match);
  ui.wild = new Set();
  if (ui.sort === "match" && !ui.q && !ui.tag) {
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
  return list;
}

/* ---------- Rendering: shared pieces ---------- */
function posterHTML(f, cls, w, h) {
  return f.px ? `<img class="${cls}" src="p/${esc(f.jid)}.webp" alt="" loading="lazy" decoding="async" width="${w}" height="${h}">`
    : `<span class="${cls} blank" aria-hidden="true">?</span>`;
}
function matchClass(m) { return m >= 85 ? "hot" : m < 50 ? "cool" : ""; }
function watchHTML(f, a) {
  if (a.own.length) { const o = a.own[0]; return `<a class="watch mine" href="${esc(o[1] || jwLink(f))}" target="_blank" rel="noopener noreferrer">Watch on ${esc(svcName(o[0]))}</a>`; }
  if (a.free.length) { const o = a.free[0]; return `<a class="watch free" href="${esc(o[1] || jwLink(f))}" target="_blank" rel="noopener noreferrer">Free on ${esc(svcName(o[0]))}</a>`; }
  const sub = a.other.find(o => !isFree(o[0]));
  if (f.rent) {
    const href = f.rent[2] || jwLink(f);
    return `<a class="watch rent" href="${esc(href)}" target="_blank" rel="noopener noreferrer">Rent £${f.rent[0].toFixed(2)}${f.rent[1] ? " on " + esc(f.rent[1]) : ""}</a>${sub ? `<span class="alt">or on ${esc(svcName(sub[0]))}</span>` : ""}`;
  }
  if (sub) return `<a class="watch other" href="${esc(sub[1] || jwLink(f))}" target="_blank" rel="noopener noreferrer">On ${esc(svcName(sub[0]))}</a>`;
  if (f.buy) return `<a class="watch rent" href="${esc(jwLink(f))}" target="_blank" rel="noopener noreferrer">Buy £${f.buy[0].toFixed(2)}</a>`;
  if (f.cin) return `<span class="watch other">In cinemas</span>`;
  return `<span class="watch none">Not streaming in the UK</span>`;
}
function factsHTML(f) {
  const bits = [];
  if (typeof f.im === "number") bits.push(`<span>IMDb <b>${f.im.toFixed(1)}</b></span>`);
  if (typeof f.rt === "number") bits.push(`<span>RT <b>${f.rt}%</b></span>`);
  if (f.rn) bits.push(`<span>${runtime(f.rn)}</span>`);
  const g = f.g || "M";
  bits.push(`<span class="gore g-${esc(g)}" title="${esc(GORE[g])} gore${f.ge ? ", estimated" : ""}">Gore ${f.ge ? "~" : ""}${esc(g)}</span>`);
  return `<span class="facts">${bits.join("")}</span>`;
}
function badgesHTML(f, a) {
  const b = [];
  if (f.p) b.push(`<span class="badge pick">Start here</span>`);
  if (ui.wild.has(f.id)) b.push(`<span class="badge wild" title="Picked to test something the model hasn't learned yet">Wildcard</span>`);
  if (f.nw && daysUntil(f.nw[0]) >= -NEW_DAYS && (cfg.svc[f.nw[1]] || (cfg.free && isFree(f.nw[1])))) b.push(`<span class="badge new">New on ${esc(svcName(f.nw[1]))}</span>`);
  if (a.leave && daysUntil(a.leave) <= SOON_DAYS) b.push(`<span class="badge leave">Leaves ${esc(shortDate(a.leave))}</span>`);
  if (f.cin && !a.tonight) b.push(`<span class="badge">In cinemas</span>`);
  return b.join("");
}
function actsHTML(f) {
  const e = eff(f.id);
  if (ui.rating.has(f.id) || e.r || e.seen) {
    return `<span class="rate" role="group" aria-label="Rate ${esc(f.t)}">${RATE_ORDER.map((r, i) =>
      `<button type="button" data-act="rate" data-rate="${r}" aria-pressed="${e.r === r}" title="${RATE_LABEL[r]} (${i + 1})">${RATE_LABEL[r]}</button>`).join("")}</span>` +
      (e.r || e.seen ? "" : `<button type="button" class="act quiet" data-act="cancel">Cancel</button>`);
  }
  return `<button type="button" class="act" data-act="want" aria-pressed="${!!e.w}" title="Add to watchlist (w)">${e.w ? "Wanted" : "Want"}</button>` +
    `<button type="button" class="act quiet" data-act="pass" title="Not for me (x)">Pass</button>` +
    `<button type="button" class="act" data-act="seen" title="Seen it: rate it (s or 1–4)">Seen it</button>`;
}
function rowHTML(f) {
  const a = avail(f), r = reasons(f), open = ui.open.has(f.id), m = f._m;
  const pitch = f.w || f.d || "";
  const why = r.pos.map(x => `<span class="p">${esc(x)}</span>`).join("") + r.neg.map(x => `<span class="n">${esc(x)}</span>`).join("") +
    r.flags.map(x => `<span class="f">${esc(x)}</span>`).join("");
  return `<article class="film${open ? " open" : ""}${ui.focus === f.id ? " is-focus" : ""}" data-id="${esc(f.id)}" tabindex="-1">
    <div class="m" title="Predicted match"><b class="${matchClass(m)}">${m}</b><small>%</small></div>
    ${posterHTML(f, "pst", 46, 69)}
    <div class="main">
      <h3><button type="button" class="ttl" data-act="open" aria-expanded="${open}">${esc(f.t)}</button><span class="yr">${esc(f.y || "")}</span>${badgesHTML(f, a)}</h3>
      ${pitch ? `<p class="pitch">${esc(pitch)}</p>` : ""}
      <div class="meta2">${why ? `<p class="why">${why}</p>` : ""}${factsHTML(f)}</div>
    </div>
    <div class="side"><span class="wbox">${watchHTML(f, a)}</span><span class="acts">${actsHTML(f)}</span></div>
    ${open ? detailHTML(f, a) : ""}
  </article>`;
}
function detailHTML(f, a) {
  const offers = [];
  a.own.forEach(o => offers.push(`<li><a class="own" href="${esc(o[1] || jwLink(f))}" target="_blank" rel="noopener noreferrer">${esc(svcName(o[0]))}</a><small>${o[2] ? "until " + esc(shortDate(o[2])) : "yours"}</small></li>`));
  a.free.forEach(o => offers.push(`<li><a href="${esc(o[1] || jwLink(f))}" target="_blank" rel="noopener noreferrer">${esc(svcName(o[0]))}</a><small>free${o[0] === "bbc" ? ", TV licence" : ""}${o[2] ? " until " + esc(shortDate(o[2])) : ""}</small></li>`));
  a.other.forEach(o => {
    const s = SVC[o[0]], extra = o[0].startsWith("ch:") ? "Prime Video channel" : s && s.p ? `£${s.p.toFixed(2)} a month` : isFree(o[0]) ? "free" : "subscription";
    offers.push(`<li><a href="${esc(o[1] || jwLink(f))}" target="_blank" rel="noopener noreferrer">${esc(svcName(o[0]))}</a><small>${esc(extra)}</small></li>`);
  });
  if (f.rent) offers.push(`<li>${f.rent[2] ? `<a href="${esc(f.rent[2])}" target="_blank" rel="noopener noreferrer">Rent on ${esc(f.rent[1] || "store")}</a>` : "Rent"}<small>£${f.rent[0].toFixed(2)}</small></li>`);
  if (f.buy) offers.push(`<li>Buy on ${esc(f.buy[1] || "store")}<small>£${f.buy[0].toFixed(2)}</small></li>`);
  if (!offers.length) offers.push(`<li>Not streaming, rentable or in cinemas in the UK right now</li>`);
  const tags = [...(f.tg || []).map(t => [t, 0]), ...(f.ta || []).map(t => [t, 1])].map(([t, auto]) => {
    const v = M.aff.get("t:" + t) || 0;
    return `<button type="button" class="tag${auto ? " auto" : ""}${v > 0.3 ? " pos" : v < -0.3 ? " neg" : ""}" data-act="tag" data-key="t:${esc(t)}" title="${auto ? "Auto-tagged. " : ""}Your affinity ${v >= 0 ? "+" : ""}${v.toFixed(2)}">${esc(TAGS[t] || t)}</button>`;
  }).join("");
  const sims = [...(NEIGH.get(f.id) || [])].map(id => BY.get(id)).filter(Boolean)
    .sort((x, y) => (sig(eff(y.id)) || 0) - (sig(eff(x.id)) || 0) || y._T - x._T).slice(0, 8)
    .map(s => { const e = eff(s.id); return `<button type="button" data-act="jump" data-id2="${esc(s.id)}">${esc(s.t)} <span class="${e.r ? "r" : ""}">${e.r ? RATE_LABEL[e.r] : s._m + "%"}</span></button>`; }).join("");
  const meta = [];
  if ((f.dir || []).length) meta.push(`<dt>Director</dt><dd><button type="button" class="tag" data-act="tag" data-key="d:${esc(f.dir[0])}">${esc(f.dir.join(", "))}</button></dd>`);
  if ((f.co || []).length) meta.push(`<dt>Made in</dt><dd>${esc(f.co.join(", "))}</dd>`);
  if (f.ce) meta.push(`<dt>Certificate</dt><dd>${esc(f.ce)}</dd>`);
  if (f.rn) meta.push(`<dt>Runtime</dt><dd>${runtime(f.rn)}</dd>`);
  if (f.aka) meta.push(`<dt>Also</dt><dd>${esc(f.aka)}</dd>`);
  const links = [`<a href="${esc(jwLink(f))}" target="_blank" rel="noopener noreferrer">JustWatch</a>`];
  if (f.imdb) links.push(`<a href="https://www.imdb.com/title/${esc(f.imdb)}/" target="_blank" rel="noopener noreferrer">IMDb</a>`, `<a href="https://letterboxd.com/imdb/${esc(f.imdb)}/" target="_blank" rel="noopener noreferrer">Letterboxd</a>`);
  links.push(`<a href="https://www.youtube.com/results?search_query=${encodeURIComponent(f.t + " " + (f.y || "") + " trailer")}" target="_blank" rel="noopener noreferrer">Trailer</a>`);
  const pct = n => (n >= 0 ? "+" : "−") + Math.abs(n).toFixed(2);
  return `<div class="detail">
    <div>
      ${f.w && f.d ? `<h4>Synopsis</h4><p>${esc(f.d)}</p>` : ""}
      <h4>Tags</h4><div class="tagrow">${tags || '<span class="hint">None yet</span>'}</div>
      ${sims ? `<h4>Similar films</h4><div class="simrow">${sims}</div>` : ""}
      <h4>Why ${f._m}%</h4>
      <div class="calc"><span>Taste fit</span><b>${pct(f._fit)}</b><span>Similar films you rated</span><b>${pct(f._nb)}</b><span>Critics</span><b>${pct(f._q)}</b><span>Score</span><b>${pct(f._T)}</b></div>
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
function barHTML() {
  const seg = (name, opts, cur) => `<span class="seg" role="group" aria-label="${esc(name)}">${opts.map(([v, l]) => `<button type="button" data-set="${esc(name)}" data-v="${esc(v)}" aria-pressed="${cur === v}">${esc(l)}</button>`).join("")}</span>`;
  return `<div class="search"><input type="search" id="q" placeholder="Search titles, directors, tags" value="${esc(ui.q)}" aria-label="Search" autocomplete="off"></div>
    <div class="filters"><div class="grp"><span>Where</span>${seg("where", [["all", "Anywhere"], ["tonight", "Tonight"], ["rent", "Rent"], ["subs", "Other subs"]], ui.where)}</div>
    <div class="grp"><span>Gore</span>${seg("gore", [["any", "Any"], ["H", "≤ High"], ["M", "≤ Med"], ["L", "Low"]], ui.gore)}</div>
    <div class="grp"><span>Length</span>${seg("len", [["any", "Any"], ["100", "≤ 100m"]], ui.len)}</div>
    <div class="grp"><label for="sort"><span>Sort</span></label> <select id="sort">${[["match", "Best match"], ["imdb", "IMDb"], ["rt", "Rotten Tomatoes"], ["new", "Newest"], ["short", "Shortest"], ["leaving", "Leaving soonest"]]
      .map(([v, l]) => `<option value="${v}"${ui.sort === v ? " selected" : ""}>${l}</option>`).join("")}</select></div></div>
    <p class="count" id="count"></p>`;
}
function renderFor(keepBar) {
  renderTonight();
  renderStrips();
  if (!keepBar) $("barFor").innerHTML = barHTML();
  const list = forYouList(), shown = list.slice(0, ui.shown);
  $("listFor").innerHTML = shown.length ? shown.map(rowHTML).join("") :
    `<p class="empty">Nothing matches. ${ui.tag || ui.q ? "Clear the search or tag filter" : "Loosen a filter"} to see more.</p>`;
  $("moreFor").hidden = list.length <= ui.shown;
  $("count").innerHTML = `<span>${shown.length} of ${list.length.toLocaleString("en-GB")} unseen films</span>` +
    (ui.tag ? `<button type="button" class="chipx" data-act="untag">${esc(featLabel(ui.tag))} <b aria-hidden="true">×</b><span class="sr">Clear tag filter</span></button>` : "");
}
function renderWant() {
  ui.wild = new Set();
  const list = FILMS.filter(f => { const e = eff(f.id); return e.w && !e.r && !e.seen; }).sort(SORTS.match);
  $("barWant").innerHTML = `<p class="count">${list.length} film${list.length === 1 ? "" : "s"} on your watchlist, best match first</p>`;
  if (!list.length) { $("listWant").innerHTML = `<p class="empty">Tap Want on anything in For you and it lands here, ranked by match and grouped by where you can watch it.</p>`; return; }
  const groups = [["Watch tonight", f => avail(f).tonight], ["Rent", f => !avail(f).tonight && f.rent], ["On other services", f => !avail(f).tonight && !f.rent && avail(f).other.length], ["Not streaming", () => true]];
  const seen = new Set();
  $("listWant").innerHTML = groups.map(([name, test]) => {
    const g = list.filter(f => !seen.has(f.id) && test(f));
    g.forEach(f => seen.add(f.id));
    return g.length ? `<div class="sect"><h2>${esc(name)}</h2><span>${g.length}</span></div>` + g.map(rowHTML).join("") : "";
  }).join("");
}
function renderRated() {
  const all = FILMS.filter(f => eff(f.id).r || eff(f.id).seen);
  const counts = Object.fromEntries(RATE_ORDER.map(r => [r, all.filter(f => eff(f.id).r === r).length]));
  const unrated = all.filter(f => !eff(f.id).r).length;
  const seg = [["all", "All", all.length], ...RATE_ORDER.slice().reverse().map(r => [r, RATE_LABEL[r], counts[r]])].concat(unrated ? [["unrated", "Seen, not rated", unrated]] : []);
  $("ratedHead").innerHTML = `<span class="seg" role="group" aria-label="Filter by rating">${seg.map(([v, l, n]) => `<button type="button" data-set="ratedFilter" data-v="${v}" aria-pressed="${ui.ratedFilter === v}">${l}<span>${n}</span></button>`).join("")}</span>
    <span class="sub">Change a rating and the model relearns instantly. Ratings marked "from your profile" came from what you told Claude.</span>`;
  const list = all.filter(f => ui.ratedFilter === "all" || eff(f.id).r === ui.ratedFilter || (ui.ratedFilter === "unrated" && !eff(f.id).r))
    .sort((a, b) => String(eff(b.id).t || "").localeCompare(String(eff(a.id).t || "")) || (RATE[eff(b.id).r] || 0) - (RATE[eff(a.id).r] || 0) || a.t.localeCompare(b.t));
  $("listRated").innerHTML = list.length ? list.map(f => {
    const e = eff(f.id);
    return `<article class="film slim${ui.focus === f.id ? " is-focus" : ""}" data-id="${esc(f.id)}" tabindex="-1">
      ${posterHTML(f, "pst", 46, 69)}
      <div class="main"><h3><a class="ttl" href="${esc(jwLink(f))}" target="_blank" rel="noopener noreferrer">${esc(f.t)}</a><span class="yr">${esc(f.y || "")}</span>${e.src === "profile" ? `<span class="src">from your profile</span>` : e.t ? `<span class="src">${esc(new Date(e.t).toLocaleDateString("en-GB", {day: "numeric", month: "short"}))}</span>` : ""}</h3>
        <p class="why">${(f.tg || []).slice(0, 4).map(t => `<span>${esc(TAGS[t] || t)}</span>`).join("")}</p></div>
      <div class="side"><span class="acts">${actsHTML(f)}</span><button type="button" class="clear" data-act="clear" title="Remove rating">Remove</button></div>
    </article>`;
  }).join("") : `<p class="empty">No ratings here yet.</p>`;
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
  const rated = FILMS.filter(f => eff(f.id).r), wants = FILMS.filter(f => { const e = eff(f.id); return e.w && !e.r; }).length;
  const passed = FILMS.filter(f => eff(f.id).x).length, tonight = FILMS.filter(f => isCandidate(f) && avail(f).tonight).length;
  const plan = planner();
  $("taste").innerHTML = `
    <div class="stats">
      <div><b>${rated.length}</b><span>rated</span></div><div><b>${wants}</b><span>wanted</span></div><div><b>${passed}</b><span>passed</span></div>
      <div><b>${FILMS.length.toLocaleString("en-GB")}</b><span>films in the pool</span></div><div><b>${tonight}</b><span>unseen on your services</span></div>
    </div>
    <div class="taste-grid">
      <section><h2>What pulls you in</h2><p>Learned from your ratings, wants and passes. Tap one to filter For you by it.</p>${pos.length ? barsHTML(pos, 2) : `<p class="hint">Rate a few films to see this.</p>`}</section>
      <section><h2>What pushes you away</h2><p>Negative affinity. These sink films down the list rather than hiding them.</p>${neg.length ? barsHTML(neg, 2) : `<p class="hint">Nothing yet. Pass on or dislike a few films.</p>`}
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
      <p><b>How the recommendations work.</b> Every film is a bag of features: subgenre tags (hand-picked, from Wikidata and from the synopsis), director, decade, country, gore level and length. Each button you press is a signal (Loved +2, Liked +1, Meh −0.5, Disliked −2, Want +0.6, Pass −1). Your affinity for a feature is the average signal across films that have it, pulled toward zero until there’s enough evidence.</p>
      <p>A film’s score adds up its feature affinities, a boost when JustWatch lists it as similar to something you rated, and a small nudge from IMDb and Rotten Tomatoes. Every seventh slot is a wildcard: a well-reviewed film built from features you haven’t rated yet, so the model keeps learning instead of narrowing.</p>
      <p>The pool rebuilds every morning from JustWatch UK: popular, trending and newly added horror, everything near your rated films, and the hand-picked list. ${FILMS.filter(f => f.cur).length} films are hand-picked.</p>
    </div>`;
  document.querySelectorAll("#taste .trk i").forEach(i => i.style.setProperty("--w", i.dataset.w));
}

/* ---------- Refresh orchestration ---------- */
function counts() {
  const w = FILMS.filter(f => { const e = eff(f.id); return e.w && !e.r && !e.seen; }).length;
  const r = FILMS.filter(f => eff(f.id).r || eff(f.id).seen).length;
  $("nWant").textContent = w ? w : "";
  $("nRated").textContent = r ? r : "";
}
function refresh(opts) {
  learn();
  scoreAll();
  counts();
  renderView(opts);
}
function renderView(opts) {
  const v = ui.view;
  document.querySelectorAll(".view").forEach(s => { s.hidden = s.id !== "view-" + v; });
  document.querySelectorAll(".tabs a").forEach(a => a.setAttribute("aria-current", a.dataset.view === v ? "page" : "false"));
  const y = window.scrollY;
  if (v === "for") renderFor(opts && opts.keepBar);
  else if (v === "want") renderWant();
  else if (v === "rated") renderRated();
  else renderTaste();
  if (opts && opts.keepScroll !== false) window.scrollTo(0, y);
}
function route() {
  const v = (location.hash || "#for").slice(1);
  ui.view = ["for", "want", "rated", "taste"].includes(v) ? v : "for";
  ui.focus = null;
  refresh({keepScroll: false});
  window.scrollTo(0, 0);
}

/* ---------- Actions ---------- */
function act(id, what, extra) {
  const f = BY.get(id);
  if (!f) return;
  const e = eff(id), base = {};
  if (e.src) base.src = e.src;
  if (what === "want") setEntry(id, e.w ? {} : {w: 1}, e.w ? `Removed ${f.t} from your watchlist` : `Added ${f.t} to your watchlist`);
  else if (what === "pass") setEntry(id, e.x ? {} : {x: 1}, `Passed on ${f.t}`);
  else if (what === "seen") { ui.rating.add(id); refresh({keepBar: true}); focusRow(id); }
  else if (what === "cancel") { ui.rating.delete(id); refresh({keepBar: true}); }
  else if (what === "rate") { ui.rating.delete(id); setEntry(id, {r: extra, seen: 1, d: todayISO()}, `${RATE_LABEL[extra]} ${f.t}`); }
  else if (what === "clear") setEntry(id, {}, `Removed your rating for ${f.t}`);
}
function undoLast() {
  const u = undo.pop();
  if (!u) { toast("Nothing to undo"); return; }
  let entry = u.prev;
  if (!entry) entry = SEED.has(u.id) ? {r: SEED.get(u.id), seen: 1, src: "profile"} : {};
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
function jump(id, open) {
  const f = BY.get(id);
  if (!f) return;
  if (eff(id).r) { ui.ratedFilter = "all"; location.hash = "#rated"; setTimeout(() => focusRow(id), 30); return; }
  ui.q = f.t; ui.tag = null; ui.where = "all"; ui.gore = "any"; ui.len = "any"; ui.shown = PAGE;
  if (open) ui.open.add(id);
  if (ui.view !== "for") location.hash = "#for"; else refresh();
  setTimeout(() => { const row = document.querySelector(`#listFor .film[data-id="${CSS.escape(id)}"]`); if (row) { focusRow(id); } }, 30);
}

/* ---------- Events ---------- */
function wire() {
  window.addEventListener("hashchange", route);
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-act], [data-set], [data-theme-set]");
    if (!b) return;
    if (b.dataset.themeSet) { setCfg({theme: b.dataset.themeSet}); return; }
    if (b.dataset.set) {
      const k = b.dataset.set;
      ui[k] = b.dataset.v;
      if (k !== "ratedFilter") ui.shown = PAGE;
      refresh({keepBar: false});
      const again = document.querySelector(`.view:not([hidden]) [data-set="${k}"][data-v="${CSS.escape(b.dataset.v)}"]`);
      if (again) again.focus();
      return;
    }
    const a = b.dataset.act, row = b.closest("[data-id]"), id = row && row.dataset.id;
    if (a === "open" && id) { ui.open.has(id) ? ui.open.delete(id) : ui.open.add(id); ui.focus = id; refresh({keepBar: true}); return; }
    if (a === "tag") { ui.tag = b.dataset.key; ui.q = ""; ui.shown = PAGE; if (ui.view !== "for") location.hash = "#for"; else refresh(); window.scrollTo(0, $("barFor").offsetTop - 60); return; }
    if (a === "untag") { ui.tag = null; refresh(); return; }
    if (a === "roll") { ui.roll++; renderTonight(); return; }
    if (a === "jump" || a === "jumpopen") { jump(b.dataset.id2, true); return; }
    if (id) act(id, a, b.dataset.rate);
  });
  $("moreFor").addEventListener("click", () => { ui.shown += PAGE; refresh({keepBar: true}); });
  document.addEventListener("input", e => {
    if (e.target.id === "q") {
      ui.q = e.target.value; ui.shown = PAGE;
      clearTimeout(wire.t);
      wire.t = setTimeout(() => refresh({keepBar: true}), 120);
    }
  });
  document.addEventListener("change", e => { if (e.target.id === "sort") { ui.sort = e.target.value; ui.shown = PAGE; refresh({keepBar: true}); } });
  $("toastUndo").addEventListener("click", undoLast);
  document.addEventListener("keydown", e => {
    if (e.target.closest("input, select, textarea, dialog")) {
      if (e.key === "Escape" && e.target.id === "q") e.target.blur();
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
    if (k === "/") { const q = $("q"); if (q) { e.preventDefault(); q.focus(); q.select(); } return; }
    if (k === "u") { undoLast(); return; }
    if (k === "r" && ui.view === "for") { ui.roll++; renderTonight(); return; }
    if (!ui.focus || !BY.has(ui.focus)) return;
    const id = ui.focus, nextId = rows[idx + 1] ? rows[idx + 1].dataset.id : rows[idx - 1] ? rows[idx - 1].dataset.id : null;
    const move = () => { if (nextId && !document.querySelector(`.view:not([hidden]) .film[data-id="${CSS.escape(id)}"]`)) focusRow(nextId); else focusRow(id); };
    if (k === "o" || k === "Enter") { e.preventDefault(); ui.open.has(id) ? ui.open.delete(id) : ui.open.add(id); refresh({keepBar: true}); focusRow(id); }
    else if (k === "w") { act(id, "want"); move(); }
    else if (k === "x") { act(id, "pass"); move(); }
    else if (k === "s") { act(id, "seen"); }
    else if (["1", "2", "3", "4"].includes(k)) { act(id, "rate", RATE_ORDER[Number(k) - 1]); move(); }
    else if (k === "Escape") { ui.rating.delete(id); refresh({keepBar: true}); focusRow(id); }
  });
  const setTop = () => document.documentElement.style.setProperty("--top-h", document.querySelector(".top").offsetHeight + "px");
  window.addEventListener("resize", setTop);
  setTop();
  wireSettings();
}

/* ---------- Settings ---------- */
function setCfg(patch) {
  state.cfg = cfg = Object.assign({}, cfg, patch, {t: nowISO()});
  saveLocal();
  queuePush();
  applyTheme();
  fillSettings();
  refresh({keepBar: true});
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
  const money = store.raw(MONEY_KEY);
  $("moneyBox").hidden = !money || (sync && sync.token === money);
  $("sOff").hidden = !sync;
  if (sync) { $("sRepo").value = sync.repo; $("sPath").value = sync.path; }
}
function wireSettings() {
  const d = $("settings");
  $("openSettings").addEventListener("click", () => { fillSettings(); $("sErr").hidden = true; if (typeof d.showModal === "function") d.showModal(); else d.setAttribute("open", ""); });
  d.addEventListener("change", e => {
    const t = e.target;
    if (t.dataset.svc) setCfg({svc: Object.assign({}, cfg.svc, {[t.dataset.svc]: t.checked ? 1 : 0})});
    else if (t.dataset.flag) setCfg({hide: Object.assign({}, cfg.hide, {[t.dataset.flag]: t.checked ? 1 : 0})});
    else if (t.id === "cfgFree") setCfg({free: t.checked ? 1 : 0});
    else if (t.id === "importFile" && t.files && t.files[0]) importFile(t.files[0]);
  });
  d.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.matches("input[type=text], input[type=password]")) { e.preventDefault(); $("sSave").click(); } });
  $("useMoney").addEventListener("click", () => connect({token: store.raw(MONEY_KEY), repo: MONEY_REPO, path: SYNC_FILE}, $("useMoney")));
  $("sSave").addEventListener("click", () => {
    const token = $("sTok").value.trim() || (sync && sync.token) || "";
    const repo = $("sRepo").value.trim().replace(/^https:\/\/github\.com\//, "").replace(/\/$/, ""), path = $("sPath").value.trim().replace(/^\//, "");
    if (!token || !/^[\w.-]+\/[\w.-]+$/.test(repo) || !path) { showErr("Fill in a token, a repository as owner/name and a file name."); return; }
    connect({token, repo, path}, $("sSave"));
  });
  $("sOff").addEventListener("click", () => { sync = null; remoteSha = null; store.del(KEY_SYNC); setStatus(null, "Sync is off. Ratings are saved in this browser only."); fillSettings(); });
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
    } catch (e) { showErr("That file isn’t a Dread List export."); }
  };
  r.readAsText(file);
}
function showErr(text) { $("sErr").textContent = text; $("sErr").hidden = false; }

/* ---------- Sync (GitHub contents API, private repo) ---------- */
const b64enc = str => { const bytes = new TextEncoder().encode(str); let bin = ""; for (const b of bytes) bin += String.fromCharCode(b); return btoa(bin); };
const b64dec = b64 => new TextDecoder().decode(Uint8Array.from(atob(String(b64).replace(/\s/g, "")), c => c.charCodeAt(0)));
const timeNow = () => new Date().toLocaleTimeString("en-GB", {hour: "2-digit", minute: "2-digit"});
function setStatus(kind, text) {
  const dot = $("syncDot");
  dot.className = "dot" + (kind ? " " + kind : "");
  $("syncText").textContent = text;
  $("openSettings").title = text;
}
async function gh(conn, method, body) {
  const path = conn.path.split("/").map(encodeURIComponent).join("/");
  return fetch(`https://api.github.com/repos/${conn.repo}/contents/${path}`, {
    method, cache: "no-store",
    headers: Object.assign({"Accept": "application/vnd.github+json", "Authorization": "Bearer " + conn.token, "X-GitHub-Api-Version": "2022-11-28"},
      body ? {"Content-Type": "application/json"} : {}),
    body: body ? JSON.stringify(body) : undefined
  });
}
function explain(res) {
  if (res.status === 401) return "GitHub rejected the token. Check it hasn’t expired.";
  if (res.status === 403) return "The token can’t write to that repository. It needs Contents: read and write.";
  if (res.status === 404) return "Repository not found, or the token can’t see it.";
  return `GitHub returned an error (${res.status}).`;
}
async function pull(conn) {
  const res = await gh(conn, "GET");
  if (res.status === 404) {
    const repo = await fetch(`https://api.github.com/repos/${conn.repo}`, {cache: "no-store", headers: {"Accept": "application/vnd.github+json", "Authorization": "Bearer " + conn.token}});
    if (!repo.ok) throw new Error(explain(repo));
    remoteSha = null;
    return normState(null);
  }
  if (!res.ok) throw new Error(explain(res));
  const j = await res.json();
  remoteSha = j.sha;
  try { return normState(JSON.parse(b64dec(j.content))); } catch (e) { return normState(null); }
}
function merge(a, b) {
  const out = {v: 2, films: Object.assign({}, a.films), cfg: a.cfg};
  for (const [id, e] of Object.entries(b.films || {})) { const cur = out.films[id]; if (!cur || String(e.t || "") > String(cur.t || "")) out.films[id] = e; }
  if (b.cfg && String(b.cfg.t || "") > String((a.cfg && a.cfg.t) || "")) out.cfg = b.cfg;
  return out;
}
const same = (a, b) => JSON.stringify([Object.entries(a.films).sort(), a.cfg]) === JSON.stringify([Object.entries(b.films).sort(), b.cfg]);
async function pushNow(conn) {
  const body = () => Object.assign({message: `Dread list update ${nowISO().slice(0, 16)}Z`, content: b64enc(JSON.stringify(state) + "\n")}, remoteSha ? {sha: remoteSha} : {});
  let res = await gh(conn, "PUT", body());
  if (res.status === 409 || res.status === 422) {
    const remote = await pull(conn);
    state = merge(state, remote); cfg = state.cfg; saveLocal();
    res = await gh(conn, "PUT", body());
  }
  if (!res.ok) throw new Error(explain(res));
  const j = await res.json();
  remoteSha = j.content && j.content.sha;
}
let pushTimer = null, pushing = false, again = false;
function queuePush() {
  if (!sync) { setStatus(null, "Ratings are saved in this browser only."); return; }
  setStatus("busy", "Saving…");
  clearTimeout(pushTimer);
  pushTimer = setTimeout(runPush, 1200);
}
async function runPush() {
  if (pushing) { again = true; return; }
  pushing = true;
  try { await pushNow(sync); setStatus("on", `Synced at ${timeNow()}`); }
  catch (e) { setStatus("err", e.message + " Ratings are still saved in this browser."); }
  finally { pushing = false; if (again) { again = false; runPush(); } }
}
async function pullAndMerge() {
  if (!sync) return;
  setStatus("busy", "Syncing…");
  try {
    const remote = await pull(sync), merged = merge(state, remote);
    const changedLocal = !same(merged, state), changedRemote = !same(merged, remote);
    state = merged; cfg = state.cfg; saveLocal();
    if (changedLocal) { applyTheme(); refresh({keepBar: true}); }
    if (changedRemote) await pushNow(sync);
    setStatus("on", `Synced at ${timeNow()}`);
  } catch (e) { setStatus("err", e.message); }
}
async function connect(conn, btn) {
  $("sErr").hidden = true;
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = "Checking…";
  try {
    const remote = await pull(conn);
    state = merge(state, remote); cfg = state.cfg; saveLocal();
    await pushNow(conn);
    sync = conn; store.set(KEY_SYNC, sync);
    setStatus("on", `Synced to ${conn.repo}/${conn.path} at ${timeNow()}`);
    applyTheme(); fillSettings(); refresh();
  } catch (e) { showErr(e.message); }
  finally { btn.disabled = false; btn.textContent = label; }
}

/* ---------- Boot ---------- */
async function boot() {
  applyTheme();
  wire();
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
  if (sync) setStatus("busy", "Syncing…");
  else if (store.raw(MONEY_KEY)) setStatus(null, "Sync is off. Open Settings to use your Money Plan connection.");
  else setStatus(null, "Ratings are saved in this browser only.");
  route();
  if (sync) pullAndMerge();
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") pullAndMerge(); });
}
boot();
