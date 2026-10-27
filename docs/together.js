"use strict";
/* Together: shared lists ranked for everyone on them, and public profiles at /u/<name>. Each member's taste model is
   learned the same way as yours (learnFrom in app.js) from the ratings, wants and passes they share with the list; a
   film's group score blends the average and the least-keen member, so picks suit everyone rather than one person.
   Invites are links (#join=<list>.<invite>); a Home Screen app has no address bar, so they can be pasted in too. */

const tg = {lists: null, listsLoading: false, detail: null, detailId: null, detailErr: null, loading: null, models: null,
  profile: null, profileName: null, profileErr: null, pf: "top", inviteOpen: false, loadedAt: 0};

function invalidateLists() { tg.lists = null; tg.detail = null; tg.detailId = null; tg.models = null; }
const rerender = () => { if (FILMS.length) refresh({keepBar: true}); };

async function loadLists() {
  if (!acct.user || tg.listsLoading) return;
  tg.listsLoading = true;
  try { tg.lists = (await api("GET", "/api/lists")).lists; tg.loadedAt = Date.now(); } catch (e) { tg.lists = tg.lists || []; tg.listsErr = e.message; }
  finally { tg.listsLoading = false; }
}
async function loadList(id) {
  tg.loading = id; tg.detailErr = null;
  try { tg.detail = await api("GET", "/api/lists/" + encodeURIComponent(id)); tg.detailId = id; tg.models = null; tg.loadedAt = Date.now(); }
  catch (e) { tg.detail = null; tg.detailId = id; tg.detailErr = e; }
  finally { tg.loading = null; }
}

/* ---------- Group scoring ---------- */
/* A film from someone else's list that isn't in today's pool joins it as a "gone" film, built from the copy they
   saved, so it can be shown, scored and added to your own list like any other. */
function filmFor(id, snapData) {
  let f = BY.get(id) || (ALIAS.has(id) ? BY.get(ALIAS.get(id)) : null);
  if (f) return f;
  if (!snapData || !snapData.t || !FILM_ID_RE.test(id)) return null;
  f = Object.assign({}, snapData, {id, foreign: 1});
  if (f.tm) { f.added = 1; f.o = Array.isArray(f.o) ? f.o : []; } else { f.gone = 1; f.o = []; }
  FILMS.push(f);
  BY.set(id, f);
  FEAT.set(id, features(f));
  scoreFilm(f);
  return f;
}
const FILM_ID_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;
function memberModels(detail) {
  if (tg.models && tg.models.detail === detail && tg.models.state === state) return tg.models.list;
  const list = detail.members.map(m => {
    if (m.you) return {handle: m.handle, you: true, get: id => eff(id), sigOf: id => sig(eff(id)), get model() { return M; }, get hide() { return cfg.hide || {}; }};
    const get = id => { const a = m.films[id]; return a ? {s: a[0] || 0, seen: a[1], w: a[2], x: a[3]} : EMPTY; };
    const items = [];
    for (const id of Object.keys(m.films)) {
      const s = sig(get(id));
      if (s == null) continue;
      const feats = FEAT.get(id) || (m.snaps && m.snaps[id] ? features(Object.assign({id}, m.snaps[id])) : null);
      if (feats) items.push([feats, s]);
    }
    return {handle: m.handle, you: false, get, sigOf: id => sig(get(id)), model: learnFrom(items), hide: m.hide || {}};
  });
  tg.models = {detail, state, list};
  return list;
}
function groupScore(f, mm) {
  const q = typeof f._q === "number" ? f._q : quality(f);
  const Ts = mm.map(m => m.you && typeof f._T === "number" ? f._T : fitOf(m.model, f).fit + neighbourBoost(m.sigOf, f).nb + q);
  const mean = Ts.reduce((a, b) => a + b, 0) / Ts.length, min = Math.min(...Ts);
  const J = 0.5 * mean + 0.5 * min;
  return {m: matchPct(J), J, per: Ts.map(matchPct)};
}
const doneBy = (m, id) => { const e = m.get(id); return !!(e.s || e.seen || e.x); };
const hiddenFor = (mm, f) => mm.some(m => (f.fl || []).some(x => m.hide[x]));

/* ---------- Rows ---------- */
function tgRowHTML(f, g, mm, kind) {
  const e = eff(f.id);
  const per = mm.map((m, i) => {
    const me = m.get(f.id);
    const v = me.s ? `${me.s}/10` : me.seen ? "seen" : me.x ? "passed" : `${g.per[i]}%`;
    return `<span class="mem${me.s ? " r" : ""}" title="${m.you ? "You" : "@" + esc(m.handle)}">${m.you ? "You" : "@" + esc(m.handle)} <b>${esc(v)}</b></span>`;
  }).join("");
  const flags = (f.fl || []).map(x => `<span class="f">${esc(FLAGS[x] || x)}</span>`).join("");
  let acts;
  if (kind === "item") acts = `<button type="button" class="act" data-tg="watched" title="Mark as watched together">Watched it</button><button type="button" class="act quiet" data-tg="remove">Remove</button>`;
  else if (kind === "pick") acts = `<button type="button" class="act" data-tg="add">Add to list</button>`;
  const left = kind === "done" && e.s ? `<div class="m sc ${scoreClass(e.s)}" title="Your rating"><b>${e.s}</b><small>/10</small></div>`
    : `<div class="m" title="Match for everyone on the list"><b class="${matchClass(g.m)}">${g.m}</b><small>%</small></div>`;
  return rowHTML(f, {left, acts, line: per + flags});
}

/* ---------- Views ---------- */
const JOIN_FORM = `<form id="fJoin" class="row joinform" novalidate><label for="jLink">Got an invite link? Paste it here</label>
  <input id="jLink" type="url" inputmode="url" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="https://dreadlist.co.uk/#join=…" required><button type="submit" class="btn ghost">Join</button></form>`;
function renderTogether() {
  const box = $("together");
  if (!acct.user) {
    const j = pendingJoin();
    box.innerHTML = `<div class="tg-intro"><h2>Watch together</h2>
      <p>Make a shared list with your partner or friends. The Dread List learns everyone’s taste and ranks the films you’ll all enjoy that nobody has seen yet, on the services you pay for.</p>
      ${acct.server === true ? `${j ? `<p class="note">You’ve got an invite waiting. Sign in or create an account and you’ll join it straight away.</p>` : ""}
        <div class="btns left"><button type="button" class="btn" data-tg="auth">${j ? "Sign in to join" : isStandalone() ? "Sign in" : "Sign in to start one"}</button></div>
        ${j ? "" : JOIN_FORM}` : `<p class="hint">Shared lists need an account on dreadlist.co.uk.</p>`}</div>`;
    return;
  }
  if (ui.listId) { renderListDetail(box); return; }
  if (tg.lists === null) {
    box.innerHTML = `<p class="boot">Loading your shared lists…</p>`;
    loadLists().then(() => { if (ui.view === "together" && !ui.listId) renderTogether(); });
    return;
  }
  box.innerHTML = `<div class="tg-intro"><h2>Watch together</h2>
      <p class="sub">Shared lists for watching with other people. Each ranks films by what everyone on it will like and nobody has seen.</p></div>
    ${tg.lists.length ? `<ul class="tg-lists">${tg.lists.map(l => `<li><a href="#together/${esc(l.id)}"><b>${esc(l.name)}</b><span>${l.members.map(m => "@" + esc(m)).join(", ")} · ${plural(l.items, "film")}${l.owner ? " · yours" : ""}</span></a></li>`).join("")}</ul>`
      : `<p class="empty">No shared lists yet. Make one and send the invite to whoever you watch with.</p>`}
    <div class="group">
      <form id="fNewList" class="row newlist" novalidate><label for="nlName">New shared list</label><input id="nlName" type="text" maxlength="60" placeholder="e.g. Friday frights" required><button type="submit" class="btn">Create</button></form>
      ${JOIN_FORM}
    </div>
    <div class="btns left"><button type="button" class="act quiet" data-tg="reload">Refresh</button></div>
    <p class="hint">Joining a list shares your ratings, watchlist and passes with the other people on it, so it can rank films for everyone. Leave any time.</p>`;
}

function inviteURL(d) { return `${location.origin}/#join=${d.list.id}.${d.list.invite}`; }
function renderListDetail(box) {
  const id = ui.listId;
  if (tg.detailId !== id || (!tg.detail && !tg.detailErr)) {
    if (tg.loading !== id) {
      box.innerHTML = `<p class="boot">Loading the list…</p>`;
      loadList(id).then(() => { if (ui.view === "together" && ui.listId === id) renderTogether(); });
    }
    return;
  }
  if (tg.detailErr) {
    box.innerHTML = `<p class="back"><a href="#together">← All shared lists</a></p><p class="empty">${esc(tg.detailErr.message)}</p>`;
    return;
  }
  const d = tg.detail, mm = memberModels(d);
  const onList = new Map(d.items.map(i => [i.id, i]));
  const items = d.items.filter(i => !i.watched).map(i => filmFor(i.id, i.f)).filter(Boolean)
    .map(f => [f, groupScore(f, mm)]).sort((x, y) => y[1].J - x[1].J);
  const watched = d.items.filter(i => i.watched).sort((x, y) => y.watched - x.watched).map(i => filmFor(i.id, i.f)).filter(Boolean);
  const cands = FILMS.filter(f => !f.gone && !onList.has(f.id) && passes(f, {basic: true}) && !hiddenFor(mm, f) && !mm.some(m => doneBy(m, f.id)))
    .map(f => [f, groupScore(f, mm)]).sort((x, y) => y[1].J - x[1].J);
  const tonight = cands.find(([f]) => avail(f).tonight);
  const picks = cands.slice(0, 20);
  const owner = d.list.owner, canShare = !!navigator.share;
  box.innerHTML = `<p class="back"><a href="#together">← All shared lists</a></p>
    <div class="tg-title"><h2>${esc(d.list.name)}</h2>${owner ? `<button type="button" class="act quiet" data-tg="rename">Rename</button>` : ""}<button type="button" class="act quiet" data-tg="reload">Refresh</button></div>
    <p class="members">${d.members.map(m => `<span>${m.you ? "You" : "@" + esc(m.handle)}${m.owner ? " <small>(owner)</small>" : ""}</span>`).join("")}
      <button type="button" class="act" data-tg="invite" aria-expanded="${tg.inviteOpen}">Invite someone</button></p>
    <div id="tgInvite" class="pair"${tg.inviteOpen ? "" : " hidden"}>${d.list.invite ? `<div id="tgQr" class="qr"></div><div>
      <p class="hint">Send this link to whoever you watch with. They’ll need an account (a passkey and ten seconds). If they use the Dread List as a Home Screen app, they can paste the link into Together there. Anyone with the link can join until you make a new one.</p>
      <p class="invite"><code>${esc(inviteURL(d))}</code></p>
      <div class="btns left">${canShare ? `<button type="button" class="btn" data-tg="share-invite">Share invite</button>` : ""}<button type="button" class="btn ghost" data-tg="copy-invite">Copy link</button>${owner ? `<button type="button" class="btn ghost" data-tg="rotate">New link</button><button type="button" class="btn ghost" data-tg="invite-off">Turn off invites</button>` : ""}</div></div>`
      : `<div><p class="hint">Invites are off for this list.</p>${owner ? `<div class="btns left"><button type="button" class="btn ghost" data-tg="rotate">Make an invite link</button></div>` : ""}</div>`}</div>
    ${d.members.length < 2 ? `<p class="hint tg-alone">You’re the only one here so far. Invite someone and the picks below start balancing both your tastes.</p>` : ""}
    ${tonight ? `<div class="tonight tg-tonight"><div class="lab"><h2><i class="rec" aria-hidden="true"></i>Watch tonight, ${d.members.length > 1 ? "all of you" : "you"}</h2><p class="sub">Best group match on your services</p></div>
      <div class="film-lite" data-id="${esc(tonight[0].id)}">
        <button type="button" class="tpst" data-act="open" tabindex="-1" aria-hidden="true">${posterHTML(tonight[0], "", 92, 138)}</button>
        <div class="tbody"><p class="tt"><span class="big">${tonight[1].m}%</span> <button type="button" data-act="open" aria-haspopup="dialog">${esc(tonight[0].t)}</button> <span class="yr">${esc(tonight[0].y || "")}</span></p>
        <div class="meta">${watchHTML(tonight[0], avail(tonight[0]))}${factsHTML(tonight[0])}</div><p class="tp">${esc(tonight[0].w || tonight[0].d || "")}</p>
        <div class="acts"><button type="button" class="act" data-tg="add">Add to list</button></div></div></div></div>` : ""}
    <div class="sect"><h2>On the list</h2><span>${items.length ? plural(items.length, "film") + ", best for the group first" : "Empty"}</span></div>
    <div class="list">${items.length ? items.map(([f, g]) => tgRowHTML(f, g, mm, "item")).join("") : `<p class="empty">Nothing on the list yet. Add films from the picks below, or from any film’s details.</p>`}</div>
    <div class="sect"><h2>Picks for ${d.members.length > 1 ? "all of you" : "you"}</h2><span>Nobody on the list has seen or passed these</span></div>
    <div class="list">${picks.length ? picks.map(([f, g]) => tgRowHTML(f, g, mm, "pick")).join("") : `<p class="empty">No picks match everyone’s filters.</p>`}</div>
    ${watched.length ? `<details class="tg-done"><summary>Watched together <span>${watched.length}</span></summary><div class="list">${watched.map(f => tgRowHTML(f, groupScore(f, mm), mm, "done")).join("")}</div></details>` : ""}
    <div class="btns left tg-foot"><button type="button" class="btn ghost" data-tg="leave">Leave this list</button>${owner ? `<button type="button" class="btn ghost danger" data-tg="delete">Delete this list</button>` : ""}</div>
    <p class="hint">Everyone on this list can see each other’s ratings, watchlists and passes. Group match blends the average with the least keen person, so picks suit everyone.</p>`;
  if (tg.inviteOpen && d.list.invite) drawInviteQR(d);
}
async function drawInviteQR(d) {
  const el = $("tgQr");
  if (!el) return;
  try { await loadScript("/vendor/qrcode.js"); el.innerHTML = qrSVG(inviteURL(d)); } catch (e) { el.remove(); }
}

/* Add to a shared list from any film's details. */
function listPickHTML(f) {
  if (!acct.user) return "";
  if (tg.lists === null) { if (!tg.listsLoading) loadLists().then(rerender); return ""; }
  if (!tg.lists.length) return "";
  return `<h4>Add to a shared list</h4><div class="tagrow">${tg.lists.map(l => `<button type="button" class="tag" data-tg="pick" data-list="${esc(l.id)}">${esc(l.name)}</button>`).join("")}</div>`;
}

/* ---------- Public profiles ---------- */
async function loadProfile(name) {
  tg.profileName = name; tg.profile = null; tg.profileErr = null;
  try { tg.profile = await api("GET", "/api/u/" + encodeURIComponent(name)); } catch (e) { tg.profileErr = e; }
  if (ui.view === "profile" && ui.profileName === name) refresh({keepScroll: false});
}
function theirBadge(f) {
  const p = tg.profile;
  if (ui.view !== "profile" || !p || !p.films[f.id]) return "";
  const [s, seen, w] = p.films[f.id];
  return s ? `<span class="badge theirs ${scoreClass(s)}" title="@${esc(p.handle)} rated it ${s}/10">@${esc(p.handle)} ${s}/10</span>`
    : w ? `<span class="badge theirs">On @${esc(p.handle)}’s watchlist</span>` : seen ? `<span class="badge theirs">@${esc(p.handle)} has seen it</span>` : "";
}
function renderProfile() {
  const box = $("profile"), name = ui.profileName;
  document.title = `@${name} · Dread List`;
  if (tg.profileName !== name) { box.innerHTML = `<p class="boot">Loading @${esc(name)}’s list…</p>`; loadProfile(name); return; }
  if (!tg.profile && !tg.profileErr) { box.innerHTML = `<p class="boot">Loading @${esc(name)}’s list…</p>`; return; }
  if (tg.profileErr) {
    box.innerHTML = `<div class="tg-intro"><h2>@${esc(name)}</h2><p class="empty">${tg.profileErr.status === 404 ? "There’s no public list with that name. It may be private, or the name may have changed." : esc(tg.profileErr.message)}</p>
      <p><a href="/#for" class="btn">Open your own Dread List</a></p></div>`;
    return;
  }
  const p = tg.profile, mine = acct.user && acct.user.handle === p.handle;
  const all = Object.entries(p.films).map(([id, v]) => [filmFor(id, p.snaps[id]), v]).filter(([f]) => f);
  const rated = all.filter(([, v]) => v[0]), wants = all.filter(([, v]) => !v[0] && v[2]);
  const avg = rated.length ? (rated.reduce((a, [, v]) => a + v[0], 0) / rated.length).toFixed(1) : "–";
  const both = rated.filter(([f]) => eff(f.id).s);
  const agree = both.length >= 3 ? Math.round(100 * both.reduce((a, [f, v]) => a + (1 - Math.abs(eff(f.id).s - v[0]) / 9), 0) / both.length) : null;
  const unseen = ([f]) => !isDone(eff(f.id)) && !eff(f.id).x;
  let list;
  if (tg.pf === "all") list = rated.slice().sort((a, b) => b[1][0] - a[1][0] || (b[0]._T || 0) - (a[0]._T || 0));
  else if (tg.pf === "want") list = wants.slice().sort((a, b) => (b[0]._T || 0) - (a[0]._T || 0));
  else list = rated.filter(([, v]) => v[0] >= 8).filter(unseen).sort((a, b) => b[1][0] - a[1][0] || (b[0]._T || 0) - (a[0]._T || 0));
  const seg = (v, l, n) => `<button type="button" data-tg="pf" data-v="${v}" aria-pressed="${tg.pf === v}">${l} <span>${n}</span></button>`;
  box.innerHTML = `<div class="tg-intro prof"><h2>@${esc(p.handle)}’s Dread List</h2>
      <p class="sub">${mine ? "This is your public page. Change it in Settings, under Account." : `Rating horror since ${esc(new Date(p.since + "-01T12:00:00Z").toLocaleDateString("en-GB", {month: "long", year: "numeric"}))}. Add anything here to your own list.`}</p>
      <div class="btns left"><button type="button" class="btn ghost" data-tg="share-profile">Share this list</button></div></div>
    <div class="stats"><div><b>${rated.length}</b><span>rated</span></div><div><b>${avg}</b><span>average score</span></div><div><b>${wants.length}</b><span>on the watchlist</span></div>
      ${agree !== null && !mine ? `<div><b>${agree}%</b><span>agreement with you, ${both.length} films</span></div>` : ""}</div>
    <div class="rated-head"><span class="seg" role="group" aria-label="Show">${seg("top", mine ? "Your 8+" : "Their 8+ you haven’t seen", mine ? rated.filter(([, v]) => v[0] >= 8).length : rated.filter(([, v]) => v[0] >= 8).filter(unseen).length)}${seg("all", "All ratings", rated.length)}${seg("want", "Watchlist", wants.length)}</span></div>
    <div class="list">${list.length ? list.map(([f]) => rowHTML(f)).join("") : `<p class="empty">${tg.pf === "top" ? "Nothing here you haven’t seen already." : "Nothing here yet."}</p>`}</div>`;
}

/* ---------- Events ---------- */
async function tgAction(b) {
  const a = b.dataset.tg, row = b.closest("[data-id]"), filmId = row && row.dataset.id, d = tg.detail;
  if (a === "auth") { openAuth("start"); return; }
  if (a === "pf") { tg.pf = b.dataset.v; refresh({keepScroll: true}); return; }
  if (a === "reload") { invalidateLists(); renderTogether(); return; }
  if (a === "share-profile") {
    const p = tg.profile;
    if (p) await shareLink({title: `@${p.handle}’s Dread List`, text: "Horror ratings and watchlist on the Dread List", url: `${location.origin}/u/${p.handle}`});
    return;
  }
  if (a === "pick") {
    const l = tg.lists.find(x => x.id === b.dataset.list), f = BY.get(filmId);
    await api("PUT", `/api/lists/${encodeURIComponent(l.id)}/items/${encodeURIComponent(filmId)}`, {f: snap(f)});
    l.items++;
    if (tg.detailId === l.id) tg.detail = null;
    toast(`Added ${f.t} to ${l.name}`);
    return;
  }
  if (!d) return;
  const base = `/api/lists/${encodeURIComponent(d.list.id)}`;
  if (a === "add") {
    const f = BY.get(filmId);
    await api("PUT", `${base}/items/${encodeURIComponent(filmId)}`, {f: snap(f)});
    const ex = d.items.find(i => i.id === filmId);
    if (ex) ex.watched = null; else d.items.unshift({id: filmId, addedBy: acct.user.handle, added: Date.now() / 1000, watched: null, f: snap(f)});
    toast(`Added ${f.t}`);
  } else if (a === "remove") {
    await api("DELETE", `${base}/items/${encodeURIComponent(filmId)}`);
    d.items = d.items.filter(i => i.id !== filmId);
  } else if (a === "watched") {
    await api("PATCH", `${base}/items/${encodeURIComponent(filmId)}`, {watched: true});
    const it = d.items.find(i => i.id === filmId);
    if (it) it.watched = Date.now() / 1000;
    const f = BY.get(filmId);
    if (f && !isDone(eff(f.id))) ui.rating.add(f.id);
    toast(`Watched together. Rate ${f ? f.t : "it"} under Watched together.`);
  } else if (a === "invite") {
    tg.inviteOpen = !tg.inviteOpen;
  } else if (a === "share-invite") {
    await shareLink({title: `Join ${d.list.name} on the Dread List`, text: `Join my shared horror list “${d.list.name}” on the Dread List`, url: inviteURL(d)});
    return;
  } else if (a === "copy-invite") {
    try { await navigator.clipboard.writeText(inviteURL(d)); b.textContent = "Copied"; } catch (e) { window.prompt("Copy this link", inviteURL(d)); }
    return;
  } else if (a === "rotate" || a === "invite-off") {
    if (a === "invite-off" && !confirm("Turn off invites? The current link stops working.")) return;
    const r = await api("POST", `${base}/invite`, a === "invite-off" ? {off: true} : {});
    d.list.invite = r.invite;
    tg.inviteOpen = true;
    toast(r.invite ? "New invite link made. The old one no longer works." : "Invites are off");
  } else if (a === "rename") {
    const name = prompt("Rename this list", d.list.name);
    if (!name) return;
    await api("PATCH", base, {name});
    d.list.name = name.trim().slice(0, 60);
    tg.lists = null;
  } else if (a === "leave") {
    if (!confirm(`Leave ${d.list.name}?${d.list.owner && d.members.length > 1 ? " Someone else will become its owner." : d.members.length < 2 ? " You’re the only member, so the list will be deleted." : ""}`)) return;
    await api("DELETE", `${base}/members/me`);
    invalidateLists(); go("#together"); toast(`You left ${d.list.name}`);
    return;
  } else if (a === "delete") {
    if (!confirm(`Delete ${d.list.name} for everyone on it?`)) return;
    await api("DELETE", base);
    invalidateLists(); go("#together"); toast(`Deleted ${d.list.name}`);
    return;
  }
  renderTogether();
}
function wireTogether() {
  document.addEventListener("click", async e => {
    const b = e.target.closest("[data-tg]");
    if (!b) return;
    if (b.disabled) return;
    b.disabled = true;
    try { await tgAction(b); } catch (err) { toast(err.message || "That didn’t work."); }
    finally { b.disabled = false; }
  });
  document.addEventListener("submit", async e => {
    if (e.target.id === "fNewList") {
      e.preventDefault();
      const input = e.target.querySelector("#nlName"), name = input.value.trim();
      if (!name) { input.focus(); return; }
      try {
        const r = await api("POST", "/api/lists", {name});
        invalidateLists(); tg.inviteOpen = true;
        go("#together/" + r.id);
      } catch (err) { toast(err.message); }
    } else if (e.target.id === "fJoin") {
      // Pasting an invite: join now if signed in, otherwise remember it and sign in first.
      e.preventDefault();
      const input = e.target.querySelector("#jLink"), inv = parseInvite(input.value);
      if (!inv) { toast("That doesn’t look like a Dread List invite link."); input.focus(); return; }
      if (acct.user) { if (await joinWith(inv)) input.value = ""; return; }
      savePendingJoin(inv.list, inv.invite);
      renderNote();
      renderTogether();
      openAuth("start");
    }
  });
  // Coming back to the app (switching from Messages, unlocking the phone): someone may have joined or added films.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !acct.user || Date.now() - tg.loadedAt < 30000) return;
    invalidateLists();
    if (ui.view === "together" && FILMS.length) renderTogether();
  });
}
document.addEventListener("DOMContentLoaded", wireTogether, {once: true});
