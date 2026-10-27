"use strict";
/* Adding a film the Dread List doesn't have yet. Search TMDB through our own server (/api/find), pick the right one,
   and it joins your list straight away with what TMDB knows: poster, synopsis, director and the UK services it's on.
   The server counts the add (never who made it), and the nightly rebuild finds the film on JustWatch and brings it
   into everyone's pool with deep links and prices; your rating moves across to it by itself. */

const fnd = {on: null, q: "", res: null, busy: false, err: "", seq: 0, timer: null};
const findOn = () => fnd.on === true;

async function checkFind() {
  try { fnd.on = !!(await api("GET", "/api/find/status")).on; } catch (e) { fnd.on = false; }
  if (fnd.on && FILMS.length && (ui.q || ui.view === "welcome")) refresh({keepBar: true});
}

/* A search result that's already in the pool (or already on your list): same title and year, or the same TMDB id. */
function inPool(r) {
  const own = BY.get("tmdb-" + r.tm);
  if (own) return own;
  const names = [r.t, r.ot].filter(Boolean).map(foldKey);
  return FILMS.find(f => f.tm === r.tm) || FILMS.find(f => !f.foreign && f.y && r.y && Math.abs(f.y - r.y) <= 1 &&
    [f.t, f.ot, f.aka].filter(Boolean).map(foldKey).some(n => names.includes(n))) || null;
}

function openFind(q) {
  fnd.q = String(q || "").trim();
  fnd.res = null; fnd.err = "";
  showSuggest(false);
  renderFind();
  showDlg($("findDlg"));
  if (fnd.q.length >= 2) runFind(fnd.q);
  else setTimeout(() => { const i = $("fq"); if (i) i.focus(); }, 40);
}
async function runFind(q) {
  q = String(q || "").trim();
  fnd.q = q;
  if (q.length < 2) { fnd.res = null; renderFindResults(); return; }
  const seq = ++fnd.seq;
  fnd.busy = true; fnd.err = "";
  renderFindResults();
  try {
    const r = await api("GET", "/api/find?q=" + encodeURIComponent(q));
    if (seq !== fnd.seq) return;
    fnd.res = r.results || [];
  } catch (e) {
    if (seq !== fnd.seq) return;
    fnd.res = null;
    fnd.err = e.code === "not_configured" ? "Film search isn’t switched on yet." : e.message;
  }
  fnd.busy = false;
  renderFindResults();
}
function renderFind() {
  $("findBox").innerHTML = `<form id="fFind" class="sq" role="search" novalidate>${SEARCH_ICON}<input type="search" id="fq" value="${esc(fnd.q)}" placeholder="Any film title" aria-label="Search every film" autocomplete="off" spellcheck="false" enterkeyhint="search"></form>
    <div id="findRes" aria-live="polite"></div>
    <p class="hint small tmdb-note">Search results come from TMDB. Anything you add appears for everyone, with full UK availability, after the next morning refresh. This product uses the TMDB API but is not endorsed or certified by TMDB.</p>`;
  renderFindResults();
}
function renderFindResults() {
  const box = $("findRes");
  if (!box) return;
  if (fnd.on === false) { box.innerHTML = `<p class="empty">Film search isn’t switched on yet.</p>`; return; }
  if (fnd.err) { box.innerHTML = `<p class="err">${esc(fnd.err)}</p>`; return; }
  if (fnd.busy && !fnd.res) { box.innerHTML = `<p class="hint fr-wait">Searching…</p>`; return; }
  if (!fnd.res) { box.innerHTML = fnd.q.length < 2 ? `<p class="hint">Type a title to search every film TMDB knows.</p>` : ""; return; }
  if (!fnd.res.length) { box.innerHTML = `<p class="empty">TMDB has nothing called “${esc(fnd.q)}”. Check the spelling, or try the original title.</p>`; return; }
  box.innerHTML = `<ul class="fres">${fnd.res.map(r => {
    const have = inPool(r), e = have ? eff(have.id) : EMPTY;
    const poster = r.tp ? `<img src="/api/img/w92${esc(r.tp)}" alt="" width="46" height="69" loading="lazy" decoding="async">` : `<span class="blank" aria-hidden="true">?</span>`;
    const state = have ? (e.s ? `<span class="badge">You rated it ${e.s}/10</span>` : e.w ? `<span class="badge">On your watchlist</span>` : `<span class="badge new">In the Dread List</span>`)
      : r.h ? "" : `<span class="badge">Not listed as horror</span>`;
    const btns = have ? `<button type="button" class="act" data-fa="open" data-id="${esc(have.id)}">Open</button>`
      : `<button type="button" class="act" data-fa="want" data-tm="${r.tm}">Want</button><button type="button" class="act" data-fa="seen" data-tm="${r.tm}">Seen it</button>`;
    return `<li class="fr">${poster}<div class="frm"><p class="frt"><b>${esc(r.t)}</b> <span class="yr">${esc(r.y || "")}</span></p>
      ${r.ot ? `<p class="hint">${esc(r.ot)}</p>` : ""}${r.d ? `<p class="frd">${esc(r.d)}</p>` : ""}${state ? `<p class="badges">${state}</p>` : ""}</div>
      <div class="frb">${btns}</div></li>`;
  }).join("")}</ul>${fnd.busy ? `<p class="hint">Searching…</p>` : ""}`;
}
/* Add a TMDB film to your list: fetch what TMDB knows, reuse the pool's copy if it turns out to be there already,
   otherwise add it here, then count the add on the server for the nightly rebuild. */
async function addFromTmdb(tm, how, btn) {
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = "Adding…";
  try {
    const {film} = await api("GET", "/api/find/" + encodeURIComponent(tm));
    let f = (film.imdb && FILMS.find(x => x.imdb === film.imdb && !x.foreign)) || BY.get(film.id);
    const fresh = !f;
    if (fresh) {
      f = Object.assign({}, film, {added: 1});
      delete f.h;
      FILMS.push(f); BY.set(f.id, f); FEAT.set(f.id, features(f)); scoreFilm(f); buildDirs();
    }
    if (fresh || f.added) api("POST", "/api/find/" + encodeURIComponent(tm), {}).catch(() => { /* counting is best effort */ });
    hideDlg($("findDlg"));
    if (how === "want") { if (!eff(f.id).w && !isDone(eff(f.id))) act(f.id, "want"); else refresh({keepBar: true}); }
    else if (!isDone(eff(f.id))) { ui.rating.add(f.id); refresh({keepBar: true}); }
    openFilm(f.id);
    if (fresh && how !== "want") toast(`Added ${f.t}. Rate it to keep it on your list.`);
  } catch (e) {
    btn.disabled = false; btn.textContent = label;
    toast(e.message || "That didn’t work.");
  }
}
function wireFind() {
  const d = $("findDlg");
  d.addEventListener("submit", e => {
    if (e.target.id !== "fFind") return;
    e.preventDefault();
    clearTimeout(fnd.timer);
    const i = $("fq");
    runFind(i.value);
    i.blur();
  });
  d.addEventListener("input", e => {
    if (e.target.id !== "fq") return;
    clearTimeout(fnd.timer);
    const v = e.target.value;
    fnd.timer = setTimeout(() => runFind(v), 450);
  });
  d.addEventListener("click", e => {
    const b = e.target.closest("[data-fa]");
    if (!b || b.disabled) return;
    if (b.dataset.fa === "open") { hideDlg(d); openFilm(b.dataset.id); return; }
    addFromTmdb(Number(b.dataset.tm), b.dataset.fa, b);
  });
  checkFind();
}
document.addEventListener("DOMContentLoaded", wireFind, {once: true});
