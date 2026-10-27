"use strict";
/* Dread List accounts: passkeys (no passwords, no email), one-time recovery codes, and short codes to sign in a new
   device. Signed in, your list syncs with the server film by film (newest change wins, as it always has between
   browsers); signed out, it lives in this browser. Uses globals from app.js: state, cfg, normState, store, KEY_STATE,
   SEED, BY, FILMS, refresh, applyTheme, fillSettings, toast, esc, $, nowISO, timeNow, go. */

const KEY_ACCT = "dread.acct.v1", KEY_SEEDED = "dread.seeded.v1", KEY_JOIN = "dread.join", KEY_NOTE = "dread.note";
const LEGACY_CREDS = "dread.sync.v2";
const acct = {user: null, session: null, rev: 0, dirty: new Set(), cfgDirty: false, timer: null, pushing: false, again: false,
  lastPull: 0, server: null, offline: false, status: {kind: null, text: ""}};

/* ---------- Server calls ---------- */
class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
async function api(method, path, body) {
  let res;
  try {
    res = await fetch(path, {method, credentials: "same-origin", cache: "no-store",
      headers: body !== undefined ? {"Content-Type": "application/json"} : {}, body: body !== undefined ? JSON.stringify(body) : undefined});
  } catch (e) {
    throw new ApiError(0, "offline", "Can’t reach the Dread List server. Check your connection.");
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
  if (!res.ok) throw new ApiError(res.status, (data && data.error) || "http_" + res.status, (data && data.message) || `The server returned an error (${res.status}).`);
  if (!data || typeof data !== "object") throw new ApiError(res.status, "no_server", "This copy of the page has no server behind it.");
  return data;
}

/* ---------- Passkeys in the browser ---------- */
const b64u = {
  enc(buf) {
    const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let s = "";
    for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  dec(str) {
    const t = String(str).replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(t + "=".repeat((4 - (t.length % 4)) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
};
const hasPasskeys = () => !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create);
function createOptions(o) {
  if (window.PublicKeyCredential && PublicKeyCredential.parseCreationOptionsFromJSON) {
    try { return PublicKeyCredential.parseCreationOptionsFromJSON(o); } catch (e) { /* fall back to by hand */ }
  }
  return Object.assign({}, o, {challenge: b64u.dec(o.challenge), user: Object.assign({}, o.user, {id: b64u.dec(o.user.id)}),
    excludeCredentials: (o.excludeCredentials || []).map(c => Object.assign({}, c, {id: b64u.dec(c.id)}))});
}
function requestOptions(o) {
  if (window.PublicKeyCredential && PublicKeyCredential.parseRequestOptionsFromJSON) {
    try { return PublicKeyCredential.parseRequestOptionsFromJSON(o); } catch (e) { /* fall back to by hand */ }
  }
  return Object.assign({}, o, {challenge: b64u.dec(o.challenge), allowCredentials: (o.allowCredentials || []).map(c => Object.assign({}, c, {id: b64u.dec(c.id)}))});
}
function credentialJSON(c) {
  if (typeof c.toJSON === "function") { try { return c.toJSON(); } catch (e) { /* fall back to by hand */ } }
  const r = c.response;
  const out = {id: c.id, rawId: b64u.enc(c.rawId), type: c.type, authenticatorAttachment: c.authenticatorAttachment || undefined,
    clientExtensionResults: c.getClientExtensionResults ? c.getClientExtensionResults() : {}, response: {clientDataJSON: b64u.enc(r.clientDataJSON)}};
  if (r.attestationObject) {
    out.response.attestationObject = b64u.enc(r.attestationObject);
    if (typeof r.getTransports === "function") out.response.transports = r.getTransports();
  }
  if (r.authenticatorData) {
    out.response.authenticatorData = b64u.enc(r.authenticatorData);
    out.response.signature = b64u.enc(r.signature);
    if (r.userHandle) out.response.userHandle = b64u.enc(r.userHandle);
  }
  return out;
}
function passkeyError(e) {
  const n = e && e.name;
  if (e instanceof ApiError) return e.message;
  if (n === "NotAllowedError") return "The passkey prompt was closed or timed out. Try again when you’re ready.";
  if (n === "InvalidStateError") return "This device already has a passkey for this account.";
  if (n === "SecurityError") return "Passkeys only work on https://dreadlist.co.uk.";
  if (n === "NotSupportedError") return "This browser can’t make a passkey. Try another browser, or sign in with a code.";
  if (n === "AbortError") return "Cancelled.";
  return (e && e.message) || "The passkey didn’t work.";
}
async function passkeyCreate(options) {
  if (!hasPasskeys()) throw new Error("This browser doesn’t support passkeys. Try another browser, or sign in with a code.");
  return credentialJSON(await navigator.credentials.create({publicKey: createOptions(options)}));
}
async function passkeyGet(options) {
  if (!hasPasskeys()) throw new Error("This browser doesn’t support passkeys. Sign in with a code instead.");
  return credentialJSON(await navigator.credentials.get({publicKey: requestOptions(options)}));
}
/* Sensitive changes need a recent sign-in: on "reauth", confirm with a passkey and try once more. */
async function withFresh(fn) {
  try { return await fn(); } catch (e) {
    if (!(e instanceof ApiError) || e.code !== "reauth") throw e;
    const o = await api("POST", "/api/auth/reauth/options", {});
    await api("POST", "/api/auth/reauth/verify", {flow: o.flow, credential: await passkeyGet(o.options)});
    if (acct.session) acct.session.fresh = true;
    return fn();
  }
}
function deviceName() {
  const s = navigator.userAgent;
  const os = /iPad/.test(s) ? "iPad" : /iPhone/.test(s) ? "iPhone" : /Android/.test(s) ? "Android" : /Mac OS X|Macintosh/.test(s) ? "Mac"
    : /Windows/.test(s) ? "Windows" : /CrOS/.test(s) ? "Chromebook" : /Linux/.test(s) ? "Linux" : "";
  const br = /Edg\//.test(s) ? "Edge" : /Firefox\/|FxiOS/.test(s) ? "Firefox" : /Chrome\/|CriOS/.test(s) ? "Chrome" : /Safari\//.test(s) ? "Safari" : "";
  return [br, os].filter(Boolean).join(" on ") || "Passkey";
}

/* ---------- Local copies ---------- */
function persistState() {
  if (acct.user) {
    store.set(KEY_ACCT, {uid: acct.user.id, user: {id: acct.user.id, handle: acct.user.handle}, rev: acct.rev, films: state.films, cfg: state.cfg,
      dirty: [...acct.dirty], cfgDirty: acct.cfgDirty});
  } else store.set(KEY_STATE, state);
}
function loadCache(c) {
  state = normState({films: c.films, cfg: c.cfg});
  acct.rev = Number(c.rev) || 0;
  acct.dirty = new Set(Array.isArray(c.dirty) ? c.dirty : []);
  acct.cfgDirty = !!c.cfgDirty;
}
function guestState() { return normState(store.get(KEY_STATE)); }
function counts3(st) {
  let rated = 0, want = 0, pass = 0, seed = 0;
  for (const e of Object.values(st.films)) {
    if (e.s || e.seen) rated++; else if (e.w) want++; else if (e.x) pass++;
    if (e.src === "profile" && e.s) seed++;
  }
  return {rated, want, pass, seed, any: rated + want + pass};
}
const plural = (n, one, many) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many || one + "s"}`;

/* ---------- Start-up ---------- */
async function initAccount() {
  let me = null;
  try { me = await api("GET", "/api/me"); acct.server = true; } catch (e) { acct.server = e.status === 0 ? "offline" : false; }
  const cache = store.get(KEY_ACCT);
  if (me && me.user) {
    acct.user = me.user; acct.session = me.session;
    if (cache && cache.uid === me.user.id) loadCache(cache);
    else { store.del(KEY_ACCT); state = normState({cfg: guestState().cfg}); acct.rev = 0; }
  } else if (acct.server === "offline" && cache && cache.user) {
    acct.user = cache.user; acct.offline = true; loadCache(cache);
  } else {
    if (cache && acct.server === true) store.del(KEY_ACCT); // signed out elsewhere: don't leave the account's copy here
    state = guestState();
  }
  cfg = state.cfg;
}

/* Runs once the film data is in: links in the address bar, the old single-user page's data, the header. */
async function afterBoot() {
  const h = location.hash;
  let m;
  if ((m = /^#link=([0-9A-Za-z-]{8,12})$/.exec(h))) {
    history.replaceState(null, "", location.pathname + "#for");
    if (!acct.user && acct.server === true) { authView = {mode: "link", code: m[1]}; setTimeout(() => openAuth(), 50); }
  } else if ((m = /^#join=([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{22})$/.exec(h))) {
    history.replaceState(null, "", location.pathname + "#together");
    try { sessionStorage.setItem(KEY_JOIN, JSON.stringify({list: m[1], invite: m[2]})); } catch (e) { /* storage blocked */ }
  } else if ((m = /^#pair=([A-Za-z0-9_-]+)$/.exec(h))) {
    // A pairing link from the old encrypted sync: keep it so this browser's list can be brought across.
    history.replaceState(null, "", location.pathname + "#for");
    try { const c = JSON.parse(new TextDecoder().decode(b64u.dec(m[1]))); if (c.t && c.k) store.set(LEGACY_CREDS, {token: c.t, key: c.k}); } catch (e) { /* bad link */ }
  }
  if (!acct.user) await legacyGuest();
  if (acct.user) await finishPendingJoin();
  renderAccountUI();
}

/* Browsers that used the original single-user page with its encrypted sync: give them that page's profile ratings and
   the latest synced copy, so nothing changes until they make an account and bring it all across. */
function legacyCreds() {
  for (const s of ["localStorage", "sessionStorage"]) {
    try { const c = JSON.parse(window[s].getItem(LEGACY_CREDS)); if (c && c.token && c.key) return c; } catch (e) { /* blocked */ }
  }
  return null;
}
function dropLegacyCreds() { for (const s of ["localStorage", "sessionStorage"]) { try { window[s].removeItem(LEGACY_CREDS); } catch (e) { /* blocked */ } } }
function seedEntries(target) {
  const ids = [];
  for (const [id, s] of SEED) {
    if (target.films[id]) continue;
    const f = BY.get(id);
    target.films[id] = {t: "2026-10-01T00:00:00.000Z", s, r: tierOf(s), seen: 1, src: "profile", f: snap(f)};
    ids.push(id);
  }
  return ids;
}
async function legacyGuest() {
  const c = legacyCreds();
  if (!c) return;
  let changed = false;
  if (!store.get(KEY_SEEDED)) { changed = seedEntries(state).length > 0; store.set(KEY_SEEDED, 1); }
  try {
    const remote = await Promise.race([legacyState({key: c.key, token: c.token}), new Promise((_, no) => setTimeout(() => no(new Error("timeout")), 6000))]);
    const merged = merge(state, remote);
    if (JSON.stringify(merged.films) !== JSON.stringify(state.films) || merged.cfg !== state.cfg) { state = merged; changed = true; }
  } catch (e) { /* offline or token gone: the local copy is still here */ }
  if (changed) { cfg = state.cfg; store.set(KEY_STATE, state); }
}

/* The old encrypted sync, read-only, for bringing a list across: AES-256-GCM under a PBKDF2-SHA256 key. */
const LEGACY_API = "https://api.github.com/repos/CyberSecDigestDaily/dread-sync/contents/";
async function legacyFile(path, token) {
  const res = await fetch(LEGACY_API + path, {cache: "no-store", headers: Object.assign({"Accept": "application/vnd.github+json"}, token ? {"Authorization": "Bearer " + token} : {})});
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub returned an error (${res.status}).`);
  const j = await res.json();
  return JSON.parse(new TextDecoder().decode(b64u.dec(String(j.content).replace(/\s/g, "").replace(/\+/g, "-").replace(/\//g, "_"))));
}
async function legacyState(opts) {
  const te = new TextEncoder(), td = new TextDecoder();
  const b64 = s => b64u.dec(String(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));
  const open = (key, box, aad) => crypto.subtle.decrypt({name: "AES-GCM", iv: b64(box.iv), additionalData: te.encode(aad)}, key, b64(box.ct)).then(b => td.decode(b));
  let key;
  if (opts.pass) {
    const v = await legacyFile("vault.json");
    if (!v) throw new Error("There’s no old sync to import from.");
    const base = await crypto.subtle.importKey("raw", te.encode(opts.pass.normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
    key = await crypto.subtle.deriveKey({name: "PBKDF2", hash: "SHA-256", salt: b64(v.salt), iterations: v.iter || 600000}, base, {name: "AES-GCM", length: 256}, false, ["decrypt"]);
    try { await open(key, v, "dread-vault-v1"); } catch (e) { throw new Error("That passphrase doesn’t unlock the old sync."); }
  } else {
    key = await crypto.subtle.importKey("raw", b64(opts.key), {name: "AES-GCM"}, false, ["decrypt"]);
  }
  const st = await legacyFile("state.json", opts.token);
  if (!st || !st.ct) return normState(null);
  return normState(JSON.parse(await open(key, st, "dread-state-v1")));
}

/* ---------- Signing in and out ---------- */
async function enterAccount(user, opts) {
  const guest = guestState(), o = opts || {};
  acct.user = {id: user.id, handle: user.handle};
  try { const me = await api("GET", "/api/me"); if (me.user) { acct.user = me.user; acct.session = me.session; } } catch (e) { /* keep going */ }
  const cache = store.get(KEY_ACCT);
  if (cache && cache.uid === user.id) loadCache(cache);
  else {
    // A new browser for this account: start empty, keeping this browser's settings until the account's own arrive.
    state = normState({cfg: Object.assign({}, guest.cfg, {t: ""})});
    acct.rev = 0; acct.dirty = new Set(); acct.cfgDirty = false;
  }
  if (o.created) { state.cfg = Object.assign({}, guest.cfg, {t: nowISO()}); acct.cfgDirty = true; }
  cfg = state.cfg;
  persistState();
  await pullNow(true);
  applyTheme();
  refresh({keepBar: true});
  renderAccountUI();
  return counts3(guest);
}
function leaveAccount(text) {
  clearTimeout(acct.timer);
  Object.assign(acct, {user: null, session: null, rev: 0, dirty: new Set(), cfgDirty: false, offline: false});
  store.del(KEY_ACCT);
  state = guestState(); cfg = state.cfg;
  applyTheme(); refresh(); renderAccountUI();
  if (text) toast(text);
}
async function signOut() {
  if (acct.dirty.size || acct.cfgDirty) { try { await pushNow(); } catch (e) { /* best effort */ } }
  try { await api("POST", "/api/auth/logout", {}); } catch (e) { /* the cookie is cleared server-side when reachable */ }
  leaveAccount("Signed out. Your list stays in your account.");
}
function importGuest() {
  const guest = guestState(), ids = [];
  for (const [id, e] of Object.entries(guest.films)) {
    const cur = state.films[id];
    if (!cur || String(e.t || "") > String(cur.t || "")) { state.films[id] = e; ids.push(id); }
  }
  saveLocal();
  queuePush(ids);
  store.del(KEY_STATE);
  dropLegacyCreds();
  refresh({keepBar: true});
  return ids.length;
}

/* ---------- Sync ---------- */
function setAcctStatus(kind, text) {
  acct.status = {kind, text};
  const dot = $("syncDot");
  if (dot) dot.className = "dot" + (kind ? " " + kind : "");
  const g = $("openSettings");
  if (g) g.title = text || "Settings";
  const line = document.querySelector("#acctBox .sync-status .st");
  if (line) line.textContent = text;
}
function queuePush(what) {
  if (!acct.user) return;
  if (what === "cfg") acct.cfgDirty = true;
  else if (Array.isArray(what)) what.forEach(id => acct.dirty.add(id));
  persistState();
  setAcctStatus("busy", "Saving…");
  clearTimeout(acct.timer);
  acct.timer = setTimeout(() => pushNow().catch(() => {}), 800);
}
function applyRemote(res) {
  let changed = false;
  for (const [id, e] of Object.entries(res.films || {})) {
    const cur = state.films[id];
    if (cur && String(cur.t || "") > String(e.t || "")) continue; // ours is newer and will be sent
    const n = normState({films: {[id]: e}}).films[id];
    if (!n) continue;
    if (!cur || JSON.stringify(cur) !== JSON.stringify(n)) { state.films[id] = n; changed = true; }
    if (cur && String(cur.t || "") === String(e.t || "")) acct.dirty.delete(id);
  }
  if (res.cfg && !acct.cfgDirty && String(res.cfg.t || "") > String((state.cfg && state.cfg.t) || "")) {
    state.cfg = cfg = normState({cfg: res.cfg}).cfg;
    changed = true;
  }
  if (typeof res.rev === "number") acct.rev = Math.max(acct.rev, res.rev);
  persistState();
  return changed;
}
async function pushNow() {
  if (!acct.user) return;
  if (acct.pushing) { acct.again = true; return; }
  acct.pushing = true;
  try {
    do {
      acct.again = false;
      const ids = [...acct.dirty].slice(0, 1000), films = {}, sent = {};
      for (const id of ids) { const e = state.films[id]; if (e) { films[id] = e; sent[id] = e; } else acct.dirty.delete(id); }
      const sentCfg = acct.cfgDirty ? state.cfg : null;
      if (!ids.length && !sentCfg) break;
      const res = await api("POST", "/api/state", Object.assign({since: acct.rev, films}, sentCfg ? {cfg: sentCfg} : {}));
      for (const id of ids) if (state.films[id] === sent[id]) acct.dirty.delete(id);
      if (sentCfg && state.cfg === sentCfg) acct.cfgDirty = false;
      if (applyRemote(res) && FILMS.length) { applyTheme(); refresh({keepBar: true}); }
    } while (acct.dirty.size || acct.cfgDirty || acct.again);
    acct.offline = false;
    setAcctStatus("on", `Saved at ${timeNow()}`);
  } catch (e) {
    if (e.status === 401) { leaveAccount("You were signed out on another device. Sign in again to keep syncing."); return; }
    setAcctStatus("err", e.status === 0 ? "Offline: changes will save when you’re back online." : e.message);
    throw e;
  } finally {
    acct.pushing = false;
    persistState();
  }
}
async function pullNow(force) {
  if (!acct.user || (!force && Date.now() - acct.lastPull < 30000)) return;
  acct.lastPull = Date.now();
  try {
    const res = await api("GET", "/api/state?since=" + acct.rev);
    if (applyRemote(res) && FILMS.length) { applyTheme(); refresh({keepBar: true}); }
    if (acct.dirty.size || acct.cfgDirty) await pushNow();
    acct.offline = false;
    setAcctStatus("on", `Synced at ${timeNow()}`);
  } catch (e) {
    if (e.status === 401) { leaveAccount("You were signed out. Sign in again to keep syncing."); return; }
    setAcctStatus("err", e.status === 0 ? "Offline: changes will save when you’re back online." : e.message);
  }
}
function startSync() {
  if (acct.user) pullNow(true);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") pullNow();
    else if (acct.user && (acct.dirty.size || acct.cfgDirty)) pushNow().catch(() => {});
  });
  window.addEventListener("online", () => { if (acct.user) pushNow().catch(() => {}); });
  setInterval(() => { if (document.visibilityState === "visible") pullNow(); }, 120000);
}

/* ---------- Header, banner ---------- */
function renderAccountUI() {
  const b = $("acctBtn");
  if (b) {
    b.hidden = acct.server === false && !acct.user;
    b.textContent = acct.user ? "@" + acct.user.handle : "Sign in";
    b.classList.toggle("on", !!acct.user);
    b.title = acct.user ? "Your account" : "Sign in or create an account";
  }
  if (!acct.user) setAcctStatus(null, acct.server === false ? "Saved in this browser" : "Saved in this browser only");
  else if (acct.offline) setAcctStatus("err", "Offline: changes will save when you’re back online.");
  renderNote();
  if ($("settings") && $("settings").open) renderAccountBox();
}
function pendingJoin() { try { return JSON.parse(sessionStorage.getItem(KEY_JOIN)); } catch (e) { return null; } }
function renderNote() {
  const n = $("syncNote");
  if (!n) return;
  let dismissed = false;
  try { dismissed = sessionStorage.getItem(KEY_NOTE) === "1"; } catch (e) { /* blocked */ }
  const join = pendingJoin();
  if (!acct.user && join && acct.server === true) {
    n.innerHTML = `<span>You’ve been invited to a shared list. Sign in or create an account to join it.</span><button type="button" class="btn" data-note="auth">Sign in to join</button>`;
    n.hidden = false; return;
  }
  if (acct.user) {
    const g = counts3(guestState());
    if (!g.any || dismissed) { n.hidden = true; return; }
    n.innerHTML = `<span>This browser also has ${plural(g.any, "film")} saved from before you signed in.</span><button type="button" class="btn" data-note="import">Add to my account</button><button type="button" class="act quiet" data-note="hide">Not now</button>`;
    n.hidden = false; return;
  }
  const c = counts3(state);
  if (acct.server !== true || dismissed || (!c.any && !legacyCreds())) { n.hidden = true; return; }
  n.innerHTML = legacyCreds()
    ? `<span>Sync has moved to accounts. Make one (a passkey, no email or password) and bring this browser’s list across: then every device stays in step.</span><button type="button" class="btn" data-note="auth">Set up my account</button><button type="button" class="act quiet" data-note="hide">Not now</button>`
    : `<span>Your list is saved in this browser only. Make an account (a passkey, no email or password) to keep it on every device.</span><button type="button" class="btn" data-note="auth">Create an account</button><button type="button" class="act quiet" data-note="hide">Not now</button>`;
  n.hidden = false;
}

/* ---------- The sign-in dialog ---------- */
let authView = {mode: "start"};
function openAuth(mode) {
  if (mode) authView = {mode};
  const d = $("authDlg");
  renderAuth();
  if (typeof d.showModal === "function") { if (!d.open) d.showModal(); } else d.setAttribute("open", "");
  setTimeout(() => { const f = d.querySelector("[autofocus], input:not([type=checkbox])"); if (f) f.focus(); }, 40);
}
function closeAuth() {
  const d = $("authDlg");
  if (typeof d.close === "function") d.close(); else d.removeAttribute("open");
}
function authErr(text) {
  const e = $("aErr");
  if (e) { e.textContent = text; e.hidden = !text; } else if (text) toast(text);
}
function authBusy(btn, on, label) {
  if (!btn) return;
  if (on) { btn.dataset.label = btn.textContent; btn.textContent = label; btn.disabled = true; authErr(""); }
  else { btn.disabled = false; if (btn.dataset.label) btn.textContent = btn.dataset.label; }
}
const codesText = codes => `Dread List recovery codes for @${acct.user ? acct.user.handle : ""}\nEach code signs you in once if you lose your passkeys. Keep them safe.\n\n${codes.join("\n")}\n`;
function renderAuth() {
  const box = $("authBox"), v = authView, h2 = $("auth-h");
  const pk = hasPasskeys();
  let html = "";
  if (v.mode === "start") {
    h2.textContent = "Your list, everywhere";
    html = `<p class="hint">An account keeps your ratings, watchlist and settings on every device, lets you make shared lists with friends, and gives you a public page if you want one.</p>
      ${pk ? "" : `<p class="err">This browser doesn’t support passkeys. Use a code below, or open the Dread List in a current browser.</p>`}
      <div class="authcols">
        <form id="fCreate" class="authcol" novalidate>
          <h3>New here?</h3>
          <label for="aHandle">Pick a name</label>
          <input id="aHandle" name="username" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" minlength="3" maxlength="20" placeholder="e.g. don" required value="${esc(v.handle || "")}">
          <p class="hint">3–20 letters, numbers, - or _. Only shown if you share your list.</p>
          <div class="btns left"><button type="submit" class="btn"${pk ? "" : " disabled"}>Create account with a passkey</button></div>
        </form>
        <div class="authcol">
          <h3>Been here before?</h3>
          <div class="btns left"><button type="button" class="btn ghost" data-auth="signin"${pk ? "" : " disabled"}>Sign in with a passkey</button></div>
          <p class="hint">Face ID, Touch ID, Windows Hello, a security key or your phone.</p>
          <p class="ways"><button type="button" class="linkish" data-auth="mode-link">Use a code from a signed-in device</button><br><button type="button" class="linkish" data-auth="mode-recover">Use a recovery code</button></p>
        </div>
      </div>
      <p class="hint small">The server keeps your name, your passkeys’ public keys and your list. No email, no password, no tracking. <a href="/privacy.html" target="_blank" rel="noopener">Privacy</a></p>`;
  } else if (v.mode === "recover") {
    h2.textContent = "Use a recovery code";
    html = `<form id="fRecover" class="authcol" novalidate>
        <p class="hint">Each of your ten recovery codes signs you in once. Then add a passkey on this device.</p>
        <label for="rHandle">Your name</label><input id="rHandle" name="username" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required>
        <label for="rCode">Recovery code</label><input id="rCode" type="text" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX" required>
        <div class="btns left"><button type="submit" class="btn">Sign in</button><button type="button" class="act quiet" data-auth="mode-start">Back</button></div>
      </form>`;
  } else if (v.mode === "link") {
    h2.textContent = "Sign in with a code";
    html = `<form id="fLink" class="authcol" novalidate>
        <p class="hint">On a device where you’re signed in, open Settings, then <b>Sign in another device</b>, and type the code it shows (or scan its QR code). Only use a code from your own device.</p>
        <label for="lCode">Code</label><input id="lCode" type="text" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX" required value="${esc(v.code || "")}">
        <div class="btns left"><button type="submit" class="btn">Sign in</button><button type="button" class="act quiet" data-auth="mode-start">Back</button></div>
      </form>`;
  } else if (v.mode === "codes") {
    h2.textContent = "Save your recovery codes";
    html = `<p class="hint">If you ever lose every device with your passkey, one of these gets you back in. Each works once. Put them in your password manager or print them: they won’t be shown again.</p>
      <ol class="codes">${v.codes.map(c => `<li><code>${esc(c)}</code></li>`).join("")}</ol>
      <div class="btns left"><button type="button" class="btn ghost" data-auth="copy-codes">Copy</button><button type="button" class="btn ghost" data-auth="dl-codes">Download</button></div>
      <label class="check"><input type="checkbox" id="aSaved"> I’ve saved them somewhere safe</label>
      <div class="btns"><button type="button" class="btn" data-auth="codes-done" disabled>Continue</button></div>`;
  } else if (v.mode === "import") {
    h2.textContent = "Bring this browser’s list?";
    const c = v.counts;
    const bits = [c.rated && plural(c.rated, "rating"), c.want && `${plural(c.want, "film")} on the watchlist`, c.pass && plural(c.pass, "pass", "passes")].filter(Boolean);
    html = `<p>This browser has ${bits.join(", ").replace(/, ([^,]*)$/, " and $1")}${c.seed ? `, including ${plural(c.seed, "profile rating")} from the original page` : ""}. Add ${c.any === 1 ? "it" : "them"} to <b>@${esc(acct.user.handle)}</b> so ${c.any === 1 ? "it follows" : "they follow"} you everywhere?</p>
      <div class="btns left"><button type="button" class="btn" data-auth="import">Add to my account</button><button type="button" class="btn ghost" data-auth="skip-import">Leave ${c.any === 1 ? "it" : "them"} in this browser</button></div>
      <p class="hint">Where both have the same film, the most recent change wins.</p>`;
  } else if (v.mode === "addkey") {
    h2.textContent = "Add a passkey on this device";
    html = `<p class="hint">You’re signed in as <b>@${esc(acct.user.handle)}</b>${v.left !== undefined ? `, with ${plural(v.left, "recovery code")} left` : ""}. Add a passkey here so next time it’s one tap.</p>
      <div class="btns left"><button type="button" class="btn" data-auth="addkey"${pk ? "" : " disabled"}>Add a passkey</button><button type="button" class="btn ghost" data-auth="addkey-skip">Not now</button></div>`;
  }
  box.innerHTML = html + `<p class="err" id="aErr" hidden></p>`;
}
/* What happens after any successful sign-in: recovery codes first (new accounts), then the import offer. */
async function afterSignIn(opts) {
  const o = opts || {};
  const guestCounts = counts3(guestState());
  if (o.codes) { authView = {mode: "codes", codes: o.codes, next: o}; renderAuth(); return; }
  if (o.addkey && hasPasskeys()) { authView = {mode: "addkey", left: o.left, next: Object.assign({}, o, {addkey: false})}; renderAuth(); return; }
  if (guestCounts.any && !o.importDone) { authView = {mode: "import", counts: guestCounts, next: o}; renderAuth(); return; }
  closeAuth();
  authView = {mode: "start"};
  await finishPendingJoin();
  toast(`Signed in as @${acct.user.handle}`);
}
async function finishPendingJoin() {
  const j = pendingJoin();
  if (!j || !acct.user) return;
  try { sessionStorage.removeItem(KEY_JOIN); } catch (e) { /* blocked */ }
  try {
    const r = await api("POST", "/api/lists/join", j);
    if (typeof invalidateLists === "function") invalidateLists();
    toast(r.already ? `You’re already on ${r.name}` : `You joined ${r.name}`);
    go("#together/" + r.id);
  } catch (e) { toast(e.message); }
}
function wireAuth() {
  const d = $("authDlg");
  $("closeAuth").addEventListener("click", closeAuth);
  $("acctBtn").addEventListener("click", () => { if (acct.user) openSettings(); else openAuth("start"); });
  $("syncNote").addEventListener("click", e => {
    const b = e.target.closest("[data-note]");
    if (!b) return;
    if (b.dataset.note === "auth") openAuth("start");
    else if (b.dataset.note === "import") { const k = importGuest(); toast(`Added ${plural(k, "film")} to your account`); renderNote(); }
    else { try { sessionStorage.setItem(KEY_NOTE, "1"); } catch (err) { /* blocked */ } renderNote(); }
  });
  d.addEventListener("input", e => {
    if (e.target.id === "aSaved") { const b = d.querySelector('[data-auth="codes-done"]'); if (b) b.disabled = !e.target.checked; }
  });
  d.addEventListener("change", e => {
    if (e.target.id === "aSaved") { const b = d.querySelector('[data-auth="codes-done"]'); if (b) b.disabled = !e.target.checked; }
  });
  d.addEventListener("submit", async e => {
    e.preventDefault();
    const f = e.target, btn = f.querySelector("button[type=submit]");
    if (f.id === "fCreate") {
      const handle = f.querySelector("#aHandle").value.trim();
      authView.handle = handle;
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,18}[A-Za-z0-9]$/.test(handle)) { authErr("Pick a name of 3–20 letters, numbers, dashes or underscores, starting and ending with a letter or number."); return; }
      authBusy(btn, true, "Waiting for your passkey…");
      try {
        const o = await api("POST", "/api/auth/register/options", {handle});
        const credential = await passkeyCreate(o.options);
        const r = await api("POST", "/api/auth/register/verify", {flow: o.flow, credential, name: deviceName()});
        await enterAccount(r.user, {created: true});
        await afterSignIn({codes: r.recoveryCodes});
      } catch (err) { authBusy(btn, false); authErr(passkeyError(err)); }
    } else if (f.id === "fRecover") {
      authBusy(btn, true, "Checking…");
      try {
        const r = await api("POST", "/api/auth/recover", {handle: f.querySelector("#rHandle").value, code: f.querySelector("#rCode").value});
        await enterAccount(r.user);
        await afterSignIn({addkey: true, left: r.recoveryLeft});
      } catch (err) { authBusy(btn, false); authErr(passkeyError(err)); }
    } else if (f.id === "fLink") {
      authBusy(btn, true, "Checking…");
      try {
        const r = await api("POST", "/api/auth/link", {code: f.querySelector("#lCode").value});
        await enterAccount(r.user);
        await afterSignIn({addkey: true});
      } catch (err) { authBusy(btn, false); authErr(passkeyError(err)); }
    }
  });
  d.addEventListener("click", async e => {
    const b = e.target.closest("[data-auth]");
    if (!b) return;
    const a = b.dataset.auth;
    if (a.startsWith("mode-")) { authView = {mode: a.slice(5)}; renderAuth(); const i = d.querySelector("input"); if (i) i.focus(); return; }
    if (a === "signin") {
      authBusy(b, true, "Waiting for your passkey…");
      try {
        const o = await api("POST", "/api/auth/login/options", {});
        const credential = await passkeyGet(o.options);
        const r = await api("POST", "/api/auth/login/verify", {flow: o.flow, credential});
        await enterAccount(r.user);
        await afterSignIn({});
      } catch (err) { authBusy(b, false); authErr(passkeyError(err)); }
    } else if (a === "copy-codes") {
      try { await navigator.clipboard.writeText(codesText(authView.codes)); b.textContent = "Copied"; } catch (err) { authErr("Couldn’t copy. Select the codes and copy them by hand."); }
    } else if (a === "dl-codes") {
      download(`dread-list-recovery-codes-${acct.user.handle}.txt`, codesText(authView.codes), "text/plain");
    } else if (a === "codes-done") {
      await afterSignIn(Object.assign({}, authView.next, {codes: null}));
    } else if (a === "import") {
      const n = importGuest();
      toast(`Added ${plural(n, "film")} to your account`);
      await afterSignIn(Object.assign({}, authView.next, {importDone: true}));
    } else if (a === "skip-import") {
      await afterSignIn(Object.assign({}, authView.next, {importDone: true}));
    } else if (a === "addkey") {
      authBusy(b, true, "Waiting for your passkey…");
      try { await addPasskey(); await afterSignIn(authView.next); } catch (err) { authBusy(b, false); authErr(passkeyError(err)); }
    } else if (a === "addkey-skip") {
      await afterSignIn(authView.next);
    }
  });
}
function download(name, text, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], {type}));
  a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
async function addPasskey() {
  await withFresh(async () => {
    const o = await api("POST", "/api/me/passkeys/options", {});
    const credential = await passkeyCreate(o.options);
    await api("POST", "/api/me/passkeys/verify", {flow: o.flow, credential, name: deviceName()});
  });
  if (acct.user) acct.user.passkeys = (acct.user.passkeys || 0) + 1;
  toast("Passkey added");
}

/* ---------- Account section in Settings ---------- */
const ago = ts => {
  if (!ts) return "never";
  const s = Math.max(0, Date.now() / 1000 - ts);
  return s < 90 ? "just now" : s < 5400 ? `${Math.round(s / 60)} minutes ago` : s < 129600 ? `${Math.round(s / 3600)} hours ago` : new Date(ts * 1000).toLocaleDateString("en-GB", {day: "numeric", month: "short", year: "numeric"});
};
function renderAccountBox() {
  const box = $("acctBox"), data = $("dataBox");
  if (!box) return;
  if (!acct.user) {
    box.innerHTML = acct.server === false
      ? `<p class="hint">Your list is saved in this browser. Accounts work on <a href="https://dreadlist.co.uk/">dreadlist.co.uk</a>.</p>`
      : `<p class="sync-status"><span class="dot" aria-hidden="true"></span><span class="st">Saved in this browser only.</span></p>
         <p class="hint">Make an account to keep your list on every device, share lists with friends and get a public page. Sign-in is a passkey: no email or password.</p>
         <div class="btns left"><button type="button" class="btn" data-acct="auth">Create an account or sign in</button></div>`;
    if (data) data.innerHTML = "";
    return;
  }
  const u = acct.user, st = acct.status;
  const wasOpen = [...box.querySelectorAll("details[open][data-sec]")].map(x => x.dataset.sec);
  box.innerHTML = `<p class="sync-status"><span class="dot${st.kind ? " " + st.kind : ""}" aria-hidden="true"></span><span>Signed in as <b>@${esc(u.handle)}</b>.</span> <span class="st">${esc(st.text || "")}</span></p>
    <div class="btns left"><button type="button" class="btn ghost" data-acct="sync">Sync now</button><button type="button" class="btn ghost" data-acct="signout">Sign out</button></div>
    <details class="acct-sec" data-sec="profile"><summary>Name and sharing</summary>
      <form id="fHandle" class="row" novalidate><label for="acHandle">Name</label><input id="acHandle" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" value="${esc(u.handle)}" maxlength="20"><button type="submit" class="btn ghost">Rename</button></form>
      <label class="check"><input type="checkbox" id="acPublic"${u.public ? " checked" : ""}> <span>Public page at <a href="/u/${esc(u.handle)}" data-acct="open-profile">dreadlist.co.uk/u/${esc(u.handle)}</a>: your ratings and watchlist, never passes or dates. Anyone with the link can see it.</span></label>
      ${u.public ? `<div class="btns left"><button type="button" class="btn ghost" data-acct="copy-profile">Copy link</button></div>` : ""}
      <label class="check"><input type="checkbox" id="acShare"${cfg.share === 1 ? " checked" : ""}> <span>Help grow the pool: the nightly rebuild gets the ids of films you loved, liked, wanted or passed (no name, scores or dates) and pulls in more like them for everyone.</span></label>
    </details>
    <details class="acct-sec" data-sec="keys"><summary>Passkeys and devices</summary>
      <ul class="klist" id="pkList"><li class="hint">Loading…</li></ul>
      <div class="btns left"><button type="button" class="btn ghost" data-acct="add-passkey">Add a passkey</button><button type="button" class="btn ghost" data-acct="link">Sign in another device</button></div>
      <div id="linkBox" class="pair" hidden></div>
      <h4>Signed in on</h4>
      <ul class="klist" id="sessList"><li class="hint">Loading…</li></ul>
      <div class="btns left"><button type="button" class="btn ghost" data-acct="revoke-others">Sign out everywhere else</button></div>
    </details>
    <details class="acct-sec" data-sec="codes"><summary>Recovery codes</summary>
      <p class="hint">${u.recoveryLeft !== undefined ? `${plural(u.recoveryLeft, "code")} left. ` : ""}Each signs you in once if you lose your passkeys. Making new ones cancels the old.</p>
      <div class="btns left"><button type="button" class="btn ghost" data-acct="new-codes">Make new codes</button></div>
      <div id="codesBox"></div>
    </details>
    <details class="acct-sec" data-sec="delete"><summary>Delete account</summary>
      <p class="hint">Deletes your account, list, passkeys and sessions from the server for good. Shared lists you own pass to another member. Export first if you want a copy.</p>
      <div class="btns left"><button type="button" class="btn ghost danger" data-acct="delete">Delete my account</button></div>
    </details>
    <p class="err" id="acErr" hidden></p>`;
  wasOpen.forEach(k => { const x = box.querySelector(`details[data-sec="${k}"]`); if (x) x.open = true; });
  if (wasOpen.includes("keys")) loadKeys();
  if (data) {
    data.innerHTML = `<div class="btns left"><a class="btn ghost" href="/api/me/export" download>Download everything in your account</a></div>
      <details class="acct-sec"><summary>Moving from the old encrypted sync?</summary>
        <form id="fLegacy" class="row" novalidate>
          <input type="text" name="username" autocomplete="username" value="Dread List sync" class="sr" tabindex="-1" readonly aria-hidden="true">
          <label for="lgPass">Old sync passphrase</label><input id="lgPass" name="password" type="password" autocomplete="current-password">
          <button type="submit" class="btn ghost">Bring it across</button>
        </form>
        <p class="hint">Reads the encrypted copy in dread-sync on GitHub, decrypts it here in your browser and adds it to your account.</p>
      </details>`;
  }
}
function acErr(text) {
  const e = $("acErr");
  if (e) { e.textContent = text; e.hidden = !text; } else if (text) toast(text);
}
async function loadKeys() {
  const pk = $("pkList"), ss = $("sessList");
  try {
    const [k, s] = await Promise.all([api("GET", "/api/me/passkeys"), api("GET", "/api/me/sessions")]);
    if (pk) pk.innerHTML = k.passkeys.map(p => `<li data-key="${esc(p.id)}"><span><b>${esc(p.name || "Passkey")}</b>${p.synced ? ` <span class="pill">synced</span>` : ""}<small>Added ${esc(ago(p.created))} · used ${esc(ago(p.lastUsed))}</small></span>
      <span class="kact"><button type="button" class="act quiet" data-acct="rename-key">Rename</button>${k.passkeys.length > 1 ? `<button type="button" class="act quiet" data-acct="del-key">Remove</button>` : ""}</span></li>`).join("");
    if (ss) ss.innerHTML = s.sessions.map(x => `<li data-sess="${esc(x.id)}"><span><b>${esc(x.device || "Browser")}</b>${x.current ? ` <span class="pill">this one</span>` : ""}<small>${x.method === "recovery" ? "Recovery code" : x.method === "link" ? "Device code" : "Passkey"} · active ${esc(ago(x.lastSeen))}</small></span>
      ${x.current ? "" : `<span class="kact"><button type="button" class="act quiet" data-acct="del-sess">Sign out</button></span>`}</li>`).join("");
    acct.user.passkeys = k.passkeys.length;
  } catch (e) { if (pk) pk.innerHTML = `<li class="err">${esc(e.message)}</li>`; }
}
async function showLinkCode() {
  const box = $("linkBox");
  try {
    const r = await withFresh(() => api("POST", "/api/me/link", {}));
    const url = `${location.origin}/#link=${r.code.replace(/-/g, "")}`;
    box.hidden = false;
    box.innerHTML = `<div id="lqr" class="qr"></div><div><p class="hint">On the other device, scan this, or go to dreadlist.co.uk, choose <b>Sign in</b>, then <b>Use a code from a signed-in device</b>, and enter:</p>
      <p class="bigcode"><code>${esc(r.code)}</code></p><p class="hint">It works once, for the next ten minutes. Only enter it on your own devices.</p></div>`;
    try { await loadScript("/vendor/qrcode.js"); $("lqr").innerHTML = qrSVG(url); } catch (e) { $("lqr").remove(); }
  } catch (e) { acErr(passkeyError(e)); }
}
function loadScript(src) {
  return new Promise((ok, fail) => {
    if (window.qrcode) { ok(); return; }
    const s = document.createElement("script");
    s.src = src; s.onload = ok; s.onerror = fail;
    document.head.append(s);
  });
}
function qrSVG(text) {
  const qr = window.qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount(), m = 4;
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + m} ${r + m}h1v1h-1z`;
  return `<svg viewBox="0 0 ${n + 2 * m} ${n + 2 * m}" width="200" height="200" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
function wireAccountBox() {
  const d = $("settings");
  d.addEventListener("toggle", e => { if (e.target.matches && e.target.matches('details[data-sec="keys"]') && e.target.open) loadKeys(); }, true);
  d.addEventListener("change", async e => {
    const t = e.target;
    if (t.id === "acPublic") {
      try { const r = await api("PATCH", "/api/me", {public: t.checked}); acct.user.public = r.public; renderAccountBox(); toast(r.public ? "Your page is public" : "Your page is private"); }
      catch (err) { t.checked = !t.checked; acErr(err.message); }
    } else if (t.id === "acShare") setCfg({share: t.checked ? 1 : 0});
  });
  d.addEventListener("submit", async e => {
    const f = e.target;
    if (f.id === "fHandle") {
      e.preventDefault();
      try {
        const r = await api("PATCH", "/api/me", {handle: f.querySelector("#acHandle").value});
        acct.user.handle = r.handle; persistState(); renderAccountUI(); renderAccountBox(); toast(`You’re now @${r.handle}`);
      } catch (err) { acErr(err.message); }
    } else if (f.id === "fLegacy") {
      e.preventDefault();
      const btn = f.querySelector("button[type=submit]");
      btn.disabled = true; btn.textContent = "Decrypting…";
      try {
        const remote = await legacyState({pass: f.querySelector("#lgPass").value});
        const ids = [];
        for (const [id, en] of Object.entries(remote.films)) { const cur = state.films[id]; if (!cur || String(en.t || "") > String(cur.t || "")) { state.films[id] = en; ids.push(id); } }
        const seeds = seedEntries(state);
        saveLocal(); queuePush(ids.concat(seeds)); refresh({keepBar: true});
        toast(`Brought across ${plural(ids.length + seeds.length, "film")}`);
        btn.textContent = "Done";
      } catch (err) { btn.disabled = false; btn.textContent = "Bring it across"; acErr(err.message); }
    }
  });
  d.addEventListener("click", async e => {
    const b = e.target.closest("[data-acct]");
    if (!b) return;
    const a = b.dataset.acct;
    acErr("");
    try {
      if (a === "auth") { d.close(); openAuth("start"); }
      else if (a === "sync") { b.textContent = "Syncing…"; await pullNow(true); b.textContent = "Sync now"; }
      else if (a === "signout") { d.close(); await signOut(); }
      else if (a === "open-profile") { e.preventDefault(); d.close(); go2profile(acct.user.handle); }
      else if (a === "copy-profile") { await navigator.clipboard.writeText(`${location.origin}/u/${acct.user.handle}`); b.textContent = "Copied"; }
      else if (a === "add-passkey") { await addPasskey(); loadKeys(); }
      else if (a === "link") await showLinkCode();
      else if (a === "rename-key") {
        const li = b.closest("[data-key]"), name = prompt("Name this passkey", li.querySelector("b").textContent);
        if (name !== null) { await api("PATCH", "/api/me/passkeys/" + encodeURIComponent(li.dataset.key), {name}); loadKeys(); }
      } else if (a === "del-key") {
        const li = b.closest("[data-key]");
        if (!confirm(`Remove the passkey “${li.querySelector("b").textContent}”? It won’t sign you in any more. Also delete it from that device’s password manager.`)) return;
        await withFresh(() => api("DELETE", "/api/me/passkeys/" + encodeURIComponent(li.dataset.key)));
        loadKeys(); toast("Passkey removed");
      } else if (a === "del-sess") {
        await api("DELETE", "/api/me/sessions/" + b.closest("[data-sess]").dataset.sess); loadKeys();
      } else if (a === "revoke-others") {
        const r = await api("POST", "/api/me/sessions/revoke-others", {}); loadKeys(); toast(`Signed out ${plural(r.signedOut, "other session")}`);
      } else if (a === "new-codes") {
        if (!confirm("Make ten new recovery codes? Your old ones stop working.")) return;
        const r = await withFresh(() => api("POST", "/api/me/recovery", {}));
        acct.user.recoveryLeft = r.recoveryCodes.length;
        $("codesBox").innerHTML = `<ol class="codes">${r.recoveryCodes.map(c => `<li><code>${esc(c)}</code></li>`).join("")}</ol>
          <div class="btns left"><button type="button" class="btn ghost" data-acct="copy-new">Copy</button><button type="button" class="btn ghost" data-acct="dl-new">Download</button></div>
          <p class="hint">Save these now: they won’t be shown again.</p>`;
        $("codesBox").dataset.codes = JSON.stringify(r.recoveryCodes);
      } else if (a === "copy-new") { await navigator.clipboard.writeText(codesText(JSON.parse($("codesBox").dataset.codes))); b.textContent = "Copied"; }
      else if (a === "dl-new") download(`dread-list-recovery-codes-${acct.user.handle}.txt`, codesText(JSON.parse($("codesBox").dataset.codes)), "text/plain");
      else if (a === "delete") {
        const typed = prompt(`This deletes @${acct.user.handle} and everything in it, for good. Type your name to confirm.`);
        if (typed === null) return;
        if (typed.trim().toLowerCase().replace(/^@/, "") !== acct.user.handle) { acErr("The name didn’t match, so nothing was deleted."); return; }
        await withFresh(() => api("DELETE", "/api/me"));
        d.close();
        leaveAccount("Your account and everything in it has been deleted.");
      }
    } catch (err) { acErr(passkeyError(err)); }
  });
}
function go2profile(handle) {
  history.pushState(null, "", "/u/" + handle);
  route();
}

document.addEventListener("DOMContentLoaded", () => { wireAuth(); wireAccountBox(); }, {once: true});
