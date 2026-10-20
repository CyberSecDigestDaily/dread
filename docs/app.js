"use strict";

/* ---------- Static config ---------- */
const VIBES = {
  ff:   {name: "Found footage & broadcast", like: "If you liked Late Night with the Devil, REC, Marble Hornets"},
  lim:  {name: "Liminal & mind-bending",    like: "If you liked Backrooms, Vivarium, Cube"},
  cre:  {name: "Creatures & body horror",   like: "If you liked The Thing, The Void, Alien"},
  folk: {name: "Folk, faith & period",      like: "If you liked The VVitch, Midsommar, The Ritual, Nosferatu"},
  claus:{name: "Claustrophobia & outbreaks",like: "If you liked The Descent, The Night Eats the World, The Crazies"},
  old:  {name: "Older, still holds up",     like: "Pre-2000 picks that pass the same test as The Thing and Alien"}
};
const VIBE_ORDER = ["ff", "lim", "cre", "folk", "claus", "old"];
const WHERE = [["any", "Any"], ["prime", "Prime Video"], ["shudder", "Shudder"], ["netflix", "Netflix"], ["disney", "Disney+"], ["now", "NOW / HBO Max"], ["free", "Free"], ["rent", "Rent only"]];
const SUB_KEY = {"Prime Video": "prime", "Shudder": "shudder", "Netflix": "netflix", "Disney+": "disney", "NOW": "now", "HBO Max": "now"};
const GORE = {L: "Gore · Low", M: "Gore · Medium", H: "Gore · High", U: "Gore · too new to rate"};
const STEPS = [
  {k: "prime",   name: "Prime Video",          cost: "Included with Amazon Prime (£8.99 a month on its own, with ads)"},
  {k: "free",    name: "Free with ads",        cost: "Tubi, Plex, Pluto TV, Channel 4, BBC iPlayer"},
  {k: "shudder", name: "Shudder",              cost: "£4.99 a month with a 7-day free trial, or add it as a Prime Video channel"},
  {k: "netflix", name: "Netflix",              cost: "From £7.99 a month with ads"},
  {k: "now",     name: "NOW Cinema",           cost: "£6.99 a month"},
  {k: "disney",  name: "Disney+",              cost: "From £6.99 a month"},
  {k: "rest",    name: "Rent or buy the rest", cost: ""}
];
const KEY_STATE = "dread.state.v1";
const KEY_SYNC = "dread.sync.v1";

/* ---------- Storage (browser storage can be blocked or wiped; never rely on it) ---------- */
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* storage unavailable */ } }
};

/* ---------- State ---------- */
let FILMS = [];
let REST = new Set();
let mine = normaliseState(store.get(KEY_STATE));          // {v:1, films:{id:{seen, score, t}}}
let sync = store.get(KEY_SYNC);                           // {token, repo, path} or null
let remoteSha = null;
const ui = {vibe: "all", where: "any", picks: false, gore: false, hideSeen: false, sort: "vibe"};

function normaliseState(s) {
  return (s && typeof s === "object" && s.films && typeof s.films === "object") ? {v: 1, films: s.films} : {v: 1, films: {}};
}
const entry = id => mine.films[id] || {};
const isSeen = id => !!entry(id).seen;

/* ---------- Helpers ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const price = f => parseFloat(String(f.rent || f.buy || "0").replace(/[^0-9.]/g, "")) || 0;
const subKeys = f => (f.subs || []).map(n => SUB_KEY[n]).filter(Boolean);
function has(f, k) {
  if (k === "any") return true;
  if (k === "free") return (f.free || []).length > 0;
  if (k === "rent") return (f.subs || []).length === 0 && (f.free || []).length === 0;
  return subKeys(f).includes(k);
}
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/* ---------- Ladder ---------- */
function buildLadder() {
  const total = FILMS.length, covered = new Set(), list = $("ladder");
  list.textContent = "";
  STEPS.forEach(st => {
    const before = covered.size;
    const fresh = FILMS.filter(f => !covered.has(f.id) && (st.k === "rest" || has(f, st.k)));
    fresh.forEach(f => covered.add(f.id));
    if (st.k === "rest") REST = new Set(fresh.map(f => f.id));
    let cost = st.cost;
    if (st.k === "rest") {
      const sum = fresh.reduce((a, f) => a + price(f), 0);
      cost = fresh.length ? `About £${sum.toFixed(2)} for all ${fresh.length} at the cheapest UK store` : "Nothing left to rent";
    }
    const li = el("li"), b = el("button");
    b.type = "button";
    b.dataset.step = st.k;
    b.setAttribute("aria-pressed", "false");
    const track = el("span", "track"), p = el("span", "p"), w = el("span", "w");
    track.setAttribute("aria-hidden", "true");
    p.style.width = (before / total * 100) + "%";
    w.style.width = (fresh.length / total * 100) + "%";
    track.append(p, w);
    const n = el("span", "n"), nb = el("b", null, "+" + fresh.length);
    n.append(nb, document.createTextNode(` · ${covered.size} of ${total}`));
    b.append(el("span", "nm", st.name), track, n, el("span", "cost", cost));
    li.append(b);
    list.append(li);
  });
}

/* ---------- Chips ---------- */
function buildChips() {
  const vc = $("vibeChips");
  [["all", "All"], ...VIBE_ORDER.map(k => [k, VIBES[k].name])].forEach(([k, name]) => {
    const b = el("button", "chip", name);
    b.type = "button"; b.dataset.vibe = k; b.setAttribute("aria-pressed", "false");
    vc.append(b);
  });
  const wc = $("whereChips");
  WHERE.forEach(([k, name]) => {
    const b = el("button", "chip", name);
    b.type = "button"; b.dataset.where = k; b.setAttribute("aria-pressed", "false");
    wc.append(b);
  });
}
function syncChips() {
  document.querySelectorAll("[data-vibe]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.vibe === ui.vibe)));
  document.querySelectorAll("[data-where]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.where === ui.where)));
  document.querySelectorAll("[data-step]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.step === ui.where)));
}

/* ---------- Rows ---------- */
function whereHTML(f) {
  const lines = [], subs = f.subs || [], free = f.free || [];
  if (subs.length) lines.push(["svc", subs.join(" · ")]);
  if (free.length) lines.push([lines.length ? "small" : "svc", "Free: " + free.join(", ")]);
  if (f.rent) lines.push([lines.length ? "small" : "svc", "Rent from " + f.rent]);
  else if (f.buy) lines.push([lines.length ? "small" : "svc", "Buy from " + f.buy]);
  if ((f.channels || []).length) lines.push(["small", f.channels.join(", ") + " (paid add-on)"]);
  if (!lines.length) lines.push(["small", "Not streaming in the UK right now"]);
  return lines.map(([c, t]) => `<div class="${c}">${esc(t)}</div>`).join("");
}
function scoreSelect(f) {
  const cur = entry(f.id).score || "";
  let opts = `<option value="">–</option>`;
  for (let i = 10; i >= 1; i--) opts += `<option value="${i}"${String(cur) === String(i) ? " selected" : ""}>${i}</option>`;
  return `<label class="mine" for="score-${esc(f.id)}">Your score <select id="score-${esc(f.id)}" data-score="${esc(f.id)}">${opts}</select></label>`;
}
function rowHTML(f) {
  const seen = isSeen(f.id);
  const link = f.jw ? "https://www.justwatch.com" + f.jw : "https://www.justwatch.com/uk/search?q=" + encodeURIComponent(f.t);
  const imdb = typeof f.imdb === "number" ? f.imdb.toFixed(1) : "–";
  const rt = typeof f.rt === "number" ? f.rt + "%" : "–";
  return `<article class="film${seen ? " is-seen" : ""}" data-id="${esc(f.id)}">
    <label class="seen"><input type="checkbox" id="seen-${esc(f.id)}" data-seen="${esc(f.id)}"${seen ? " checked" : ""} aria-label="Seen ${esc(f.t)}"></label>
    <div class="body">
      <h3><a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(f.t)}</a><span class="yr">${esc(f.y)}</span>${f.p ? '<span class="pick">Start here</span>' : ""}</h3>
      <p class="why">${esc(f.w)}</p>
      <p class="tags"><span class="gore g-${esc(f.g)}">${esc(GORE[f.g] || "")}</span>${f.aka ? `<span class="aka">${esc(f.aka)}</span>` : ""}${seen ? scoreSelect(f) : ""}</p>
    </div>
    <div class="facts">
      <dl class="scores"><div><dt>IMDb</dt><dd>${imdb}</dd></div><div><dt>RT</dt><dd>${rt}</dd></div></dl>
      <div class="where">${whereHTML(f)}</div>
    </div>
  </article>`;
}
function matches(f) {
  if (ui.vibe !== "all" && f.v !== ui.vibe) return false;
  if (ui.where === "rest") { if (!REST.has(f.id)) return false; }
  else if (!has(f, ui.where)) return false;
  if (ui.picks && !f.p) return false;
  if (ui.gore && f.g === "H") return false;
  if (ui.hideSeen && isSeen(f.id)) return false;
  return true;
}
function updateCount(n) {
  const seenCount = FILMS.filter(f => isSeen(f.id)).length;
  $("count").textContent = `Showing ${n} of ${FILMS.length} · ${seenCount} seen`;
}
function render() {
  const list = FILMS.filter(matches);
  let html = "";
  if (!list.length) {
    html = `<p class="empty">Nothing matches those filters. Clear one of them to see more.</p>`;
  } else if (ui.sort === "vibe") {
    VIBE_ORDER.forEach(k => {
      const g = list.filter(f => f.v === k);
      if (!g.length) return;
      html += `<div class="group"><h2>${esc(VIBES[k].name)}</h2><p>${esc(VIBES[k].like)} · ${g.length} film${g.length > 1 ? "s" : ""}</p></div>` + g.map(rowHTML).join("");
    });
  } else {
    const key = {rt: f => f.rt || 0, imdb: f => f.imdb || 0, new: f => f.y, mine: f => entry(f.id).score || 0}[ui.sort];
    html = list.slice().sort((a, b) => key(b) - key(a) || (b.rt || 0) - (a.rt || 0)).map(rowHTML).join("");
  }
  $("list").innerHTML = html;
  updateCount(list.length);
}

/* ---------- Local + remote saving ---------- */
function touch(id, patch) {
  const cur = entry(id);
  mine.films[id] = Object.assign({}, cur, patch, {t: new Date().toISOString()});
  store.set(KEY_STATE, mine);
  queuePush();
}

const b64enc = str => { const bytes = new TextEncoder().encode(str); let bin = ""; for (const b of bytes) bin += String.fromCharCode(b); return btoa(bin); };
const b64dec = b64 => { const bin = atob(String(b64).replace(/\s/g, "")); return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))); };

function setStatus(kind, text) {
  const bar = $("syncbar");
  bar.classList.remove("is-on", "is-busy", "is-err");
  if (kind) bar.classList.add("is-" + kind);
  $("syncText").textContent = text;
  $("syncOpen").textContent = sync ? "Sync settings" : "Sync across devices";
}
const timeNow = () => new Date().toLocaleTimeString("en-GB", {hour: "2-digit", minute: "2-digit"});

async function gh(method, body) {
  const path = sync.path.split("/").map(encodeURIComponent).join("/");
  const res = await fetch(`https://api.github.com/repos/${sync.repo}/contents/${path}`, {
    method,
    cache: "no-store",
    headers: Object.assign({
      "Accept": "application/vnd.github+json",
      "Authorization": "Bearer " + sync.token,
      "X-GitHub-Api-Version": "2022-11-28"
    }, body ? {"Content-Type": "application/json"} : {}),
    body: body ? JSON.stringify(body) : undefined
  });
  return res;
}
function explain(res) {
  if (res.status === 401) return "GitHub rejected the token. Check it hasn’t expired.";
  if (res.status === 403) return "The token can’t write to that repository. It needs Contents: read and write.";
  if (res.status === 404) return "Repository not found, or the token can’t see it.";
  return `GitHub returned an error (${res.status}).`;
}
async function pull() {
  const res = await gh("GET");
  if (res.status === 404) {
    // The file doesn't exist yet, but check the repo itself is reachable before treating it as empty.
    const repo = await fetch(`https://api.github.com/repos/${sync.repo}`, {cache: "no-store", headers: {"Accept": "application/vnd.github+json", "Authorization": "Bearer " + sync.token}});
    if (!repo.ok) throw new Error(explain(repo));
    remoteSha = null;
    return {v: 1, films: {}};
  }
  if (!res.ok) throw new Error(explain(res));
  const j = await res.json();
  remoteSha = j.sha;
  try { return normaliseState(JSON.parse(b64dec(j.content))); } catch (e) { return {v: 1, films: {}}; }
}
function merge(a, b) {
  const out = {v: 1, films: Object.assign({}, a.films)};
  for (const [id, e] of Object.entries(b.films || {})) {
    const cur = out.films[id];
    if (!cur || String(e.t || "") > String(cur.t || "")) out.films[id] = e;
  }
  return out;
}
const same = (a, b) => JSON.stringify(Object.entries(a.films).sort()) === JSON.stringify(Object.entries(b.films).sort());

async function pushNow() {
  const body = () => Object.assign({
    message: `Dread list update ${new Date().toISOString().slice(0, 16)}Z`,
    content: b64enc(JSON.stringify(mine, null, 1) + "\n")
  }, remoteSha ? {sha: remoteSha} : {});
  let res = await gh("PUT", body());
  if (res.status === 409 || res.status === 422) {
    // Another device saved first: merge both sides and try once more.
    const remote = await pull();
    mine = merge(mine, remote);
    store.set(KEY_STATE, mine);
    res = await gh("PUT", body());
  }
  if (!res.ok) throw new Error(explain(res));
  const j = await res.json();
  remoteSha = j.content && j.content.sha;
}

let pushTimer = null, pushing = false, again = false;
function queuePush() {
  if (!sync) { setStatus(null, "Saved in this browser only."); return; }
  setStatus("busy", "Saving…");
  clearTimeout(pushTimer);
  pushTimer = setTimeout(runPush, 1200);
}
async function runPush() {
  if (pushing) { again = true; return; }
  pushing = true;
  try {
    await pushNow();
    setStatus("on", `Synced at ${timeNow()}`);
  } catch (e) {
    setStatus("err", e.message + " Your ticks are still saved in this browser.");
  } finally {
    pushing = false;
    if (again) { again = false; runPush(); }
  }
}
async function pullAndMerge() {
  if (!sync) return;
  setStatus("busy", "Syncing…");
  try {
    const remote = await pull();
    const merged = merge(mine, remote);
    const changedLocal = !same(merged, mine);
    const changedRemote = !same(merged, remote);
    mine = merged;
    store.set(KEY_STATE, mine);
    if (changedLocal) render();
    if (changedRemote) await pushNow();
    setStatus("on", `Synced at ${timeNow()}`);
  } catch (e) {
    setStatus("err", e.message);
  }
}

/* ---------- Sync dialog ---------- */
function openDialog() {
  const d = $("syncDialog");
  $("sTok").value = sync ? sync.token : "";
  if (sync) { $("sRepo").value = sync.repo; $("sPath").value = sync.path; }
  $("sErr").hidden = true;
  $("sOff").hidden = !sync;
  if (typeof d.showModal === "function") d.showModal(); else d.setAttribute("open", "");
  $("sTok").focus();
}
function closeDialog() {
  const d = $("syncDialog");
  if (typeof d.close === "function") d.close(); else d.removeAttribute("open");
}
async function saveSync() {
  const token = $("sTok").value.trim(), repo = $("sRepo").value.trim().replace(/^https:\/\/github\.com\//, "").replace(/\/$/, ""), path = $("sPath").value.trim().replace(/^\//, "");
  const err = $("sErr");
  err.hidden = true;
  if (!token || !/^[\w.-]+\/[\w.-]+$/.test(repo) || !path) {
    err.textContent = "Fill in a token, a repository as owner/name, and a file name.";
    err.hidden = false;
    return;
  }
  const btn = $("sSave");
  btn.disabled = true; btn.textContent = "Checking…";
  const previous = sync;
  sync = {token, repo, path};
  try {
    const remote = await pull();
    mine = merge(mine, remote);
    store.set(KEY_STATE, mine);
    await pushNow();
    store.set(KEY_SYNC, sync);
    closeDialog();
    render();
    setStatus("on", `Synced at ${timeNow()}`);
  } catch (e) {
    sync = previous;
    err.textContent = e.message;
    err.hidden = false;
  } finally {
    btn.disabled = false; btn.textContent = "Save and sync";
  }
}
function turnOffSync() {
  sync = null;
  remoteSha = null;
  store.del(KEY_SYNC);
  closeDialog();
  setStatus(null, "Sync is off. Ticks are saved in this browser only.");
}

/* ---------- Events ---------- */
function wire() {
  $("ladder").addEventListener("click", e => {
    const b = e.target.closest("button[data-step]");
    if (!b) return;
    ui.where = b.dataset.step;
    ui.vibe = "all";
    syncChips(); render();
    const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    $("controls").scrollIntoView({behavior: reduce ? "auto" : "smooth", block: "start"});
  });
  $("vibeChips").addEventListener("click", e => { const b = e.target.closest("[data-vibe]"); if (!b) return; ui.vibe = b.dataset.vibe; syncChips(); render(); });
  $("whereChips").addEventListener("click", e => { const b = e.target.closest("[data-where]"); if (!b) return; ui.where = b.dataset.where; syncChips(); render(); });
  $("tPicks").addEventListener("change", e => { ui.picks = e.target.checked; render(); });
  $("tGore").addEventListener("change", e => { ui.gore = e.target.checked; render(); });
  $("tSeen").addEventListener("change", e => { ui.hideSeen = e.target.checked; render(); });
  $("sortSel").addEventListener("change", e => { ui.sort = e.target.value; render(); });

  $("list").addEventListener("change", e => {
    const seenBox = e.target.closest("input[data-seen]");
    if (seenBox) {
      const id = seenBox.dataset.seen;
      touch(id, {seen: seenBox.checked});
      if (ui.hideSeen) { render(); return; }
      const row = seenBox.closest(".film"), f = FILMS.find(x => x.id === id);
      if (row && f) row.outerHTML = rowHTML(f);
      updateCount(FILMS.filter(matches).length);
      const fresh = document.getElementById("seen-" + id);
      if (fresh) fresh.focus();
      return;
    }
    const scoreSel = e.target.closest("select[data-score]");
    if (scoreSel) touch(scoreSel.dataset.score, {score: scoreSel.value ? Number(scoreSel.value) : null});
  });

  $("syncOpen").addEventListener("click", openDialog);
  $("sCancel").addEventListener("click", closeDialog);
  $("sSave").addEventListener("click", saveSync);
  $("sOff").addEventListener("click", turnOffSync);
  $("syncDialog").addEventListener("keydown", e => { if (e.key === "Enter" && e.target.tagName === "INPUT") { e.preventDefault(); saveSync(); } });

  // Pick up changes made on another device when you come back to this tab.
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") pullAndMerge(); });
}

/* ---------- Boot ---------- */
async function boot() {
  buildChips();
  syncChips();
  wire();
  setStatus(sync ? "busy" : null, sync ? "Syncing…" : "Ticks are saved in this browser only.");
  try {
    const res = await fetch("data.json", {cache: "no-cache"});
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    FILMS = data.films || [];
    const d = data.checked ? new Date(data.checked) : null;
    $("stamp").textContent = d && !isNaN(d) ? d.toLocaleDateString("en-GB", {day: "2-digit", month: "short", year: "numeric"}).toUpperCase() : "";
  } catch (e) {
    $("list").innerHTML = `<p class="empty">The list didn’t load. Check your connection and refresh the page.</p>`;
    $("stamp").textContent = "";
    return;
  }
  buildLadder();
  syncChips();
  render();
  if (sync) pullAndMerge();
}
boot();
