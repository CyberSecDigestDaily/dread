"use strict";
/* The welcome page for first-time visitors, the three-step getting-started guide, and share cards: a picture of a film
   with your score, made in the browser and handed to the phone's share sheet (Instagram, Messages, WhatsApp…).
   Uses globals from app.js and account.js. */

const KEY_WELCOMED = "dread.welcomed.v1", KEY_ONBOARDED = "dread.onboarded.v1";
const onboarded = () => !!store.get(KEY_ONBOARDED);

/* ---------- Welcome ---------- */
/* Shown at the bare address to someone who has never used the Dread List in this browser and isn't signed in. */
function firstVisit() {
  return !store.get(KEY_WELCOMED) && !acct.user && !Object.keys(state.films).length && location.pathname === "/";
}
function renderWelcome() {
  const picks = FILMS.filter(f => f.cur && posterOk(f) && !f.gone && avail(f).tonight).sort((a, b) => (b._q || 0) - (a._q || 0)).slice(0, 8);
  const app = isStandalone();
  $("welcome").innerHTML = `<div class="wel">
      <p class="wel-osd"><i class="rec" aria-hidden="true"></i>REC <span>${esc(new Date().toLocaleDateString("en-GB", {day: "2-digit", month: "short", year: "numeric"}).toUpperCase())}</span></p>
      <h1>Find tonight’s horror film.</h1>
      <p class="wel-lede">The Dread List learns your taste from what you rate, and shows you where every film streams in the UK tonight: on the services you pay for, on free TV, or to rent.</p>
      <div class="btns left"><button type="button" class="btn big" data-wel="start">Start browsing</button>${acct.server === true ? `<button type="button" class="btn ghost big" data-wel="signin">${app ? "Sign in" : "I have an account"}</button>` : ""}</div>
      <p class="hint">No ads, no tracking, no passwords. Free, and nothing to install.</p>
    </div>
    <ol class="wel-steps">
      <li><b>Rate what you’ve seen</b><span>Scores out of ten teach it your taste: folk horror over slashers, slow burns over jump scares. It shows you why it thinks you’ll like each film.</span></li>
      <li><b>Watch tonight</b><span>Your best unseen match on Netflix, Prime Video, NOW, Shudder or free TV, with a link straight to it. Plus what’s new and what’s leaving soon.</span></li>
      <li><b>Watch together</b><span>Shared lists rank films for everyone on them, so nobody gets stuck with a film they’ll hate.</span></li>
    </ol>
    ${picks.length ? `<section class="strip wel-peek"><h2>Streaming tonight</h2><p class="sub">A few hand-picked favourites, on UK services right now</p>
      <ol>${picks.map(f => `<li><button type="button" data-act="openid" data-id2="${esc(f.id)}" aria-haspopup="dialog">${posterHTML(f, "", 56, 84)}<span class="st">${esc(f.t)}<small>${esc(f.y || "")}</small></span><span class="when">${esc(svcName((avail(f).own[0] || avail(f).free[0] || [""])[0]))}</span></button></li>`).join("")}</ol></section>` : ""}
`;
}
function leaveWelcome(then) {
  store.set(KEY_WELCOMED, 1);
  go("#for");
  if (then) setTimeout(then, 60);
}

/* ---------- Getting started ---------- */
let obStep = 0;
function obStarters() {
  // Well-known films most people have seen, to seed the model with a few quick scores.
  return FILMS.filter(f => !f.gone && (f.iv || 0) > 150000 && passes(f, {basic: true})).sort((a, b) => (b.iv || 0) - (a.iv || 0)).slice(0, 14);
}
function startOnboarding() {
  obStep = 0;
  renderOnboarding();
  showDlg($("xDlg"));
}
function renderOnboarding() {
  const d = $("xDlg");
  d.dataset.kind = "onboard";
  $("x-h").textContent = ["Your services", "Rate a few you’ve seen", "How it works"][obStep];
  let body = "";
  if (obStep === 0) {
    body = `<p class="ob-n">Step 1 of 3</p><p>Which streaming services do you pay for? Films on these count as <b>watch tonight</b>, and they’re the first link on every film.</p>
      <div class="group">${OWNABLE.map(k => `<label class="sw"><span>${esc(SVC[k].n)}${k === "hbo" ? ` <small>comes with NOW Entertainment</small>` : ""}</span><input type="checkbox" class="tog" data-ob-svc="${k}"${cfg.svc[k] ? " checked" : ""}></label>`).join("")}</div>
      <div class="group"><label class="sw"><span>Free TV counts too<small>BBC iPlayer, Channel 4, ITVX, My5, Tubi and more</small></span><input type="checkbox" class="tog" data-ob-free${cfg.free ? " checked" : ""}></label></div>`;
  } else if (obStep === 1) {
    const n = FILMS.filter(f => eff(f.id).s).length;
    body = `<p class="ob-n">Step 2 of 3</p><p>Score anything you’ve seen out of ten. Five or six is plenty to get going; the more you rate, the sharper it gets. Skip the ones you haven’t seen.</p>
      <p class="hint">${n ? `${plural(n, "film")} rated so far.` : "Nothing rated yet."}</p>
      <div class="list ob-list">${obStarters().map(f => `<div class="ob-row" data-id="${esc(f.id)}">${posterHTML(f, "pst", 40, 60)}<div class="ob-m"><p><b>${esc(f.t)}</b> <span class="yr">${esc(f.y || "")}</span></p>${rateHTML(f, eff(f.id).s || 0, !!eff(f.id).s)}</div></div>`).join("")}</div>`;
  } else {
    body = `<p class="ob-n">Step 3 of 3</p>
      <ul class="ob-how">
        <li><b>For you</b> ranks every film by how well it fits your taste. The big number is the match.</li>
        <li><b>Want</b>, <b>Pass</b> and <b>Seen it</b> each teach it something. Tap any film for the full story, where to watch and why it’s ranked there.</li>
        <li><b>Watch tonight</b> is your best unseen match on the services you pay for, or free TV. <b>Another</b> rolls a new one.</li>
        <li><b>Together</b> makes a shared list with your partner or friends, ranked for all of you.</li>
        <li>Missing a film? Search for it and choose <b>Search every film</b> to add it.</li>
      </ul>
      ${/iPhone|iPad/.test(navigator.userAgent) && !isStandalone() ? `<p class="note">Tip: in Safari, tap Share, then <b>Add to Home Screen</b>, and the Dread List opens like an app.</p>` : ""}
      ${!acct.user && acct.server === true ? `<p class="hint">Your list is saved in this browser. Make an account (a passkey, no email or password) to keep it on every device.</p>` : ""}`;
  }
  $("xBox").innerHTML = body + `<div class="sheet-foot ob-foot">
      ${obStep > 0 ? `<button type="button" class="btn ghost" data-ob="back">Back</button>` : `<button type="button" class="btn ghost" data-ob="skip">Skip</button>`}
      <button type="button" class="btn" data-ob="next">${obStep < 2 ? "Next" : "Start"}</button>
      ${obStep === 2 && !acct.user && acct.server === true ? `<button type="button" class="linkish" data-ob="account">Make an account</button>` : ""}</div>`;
  $("xBox").scrollTop = 0;
}
function endOnboarding() {
  store.set(KEY_ONBOARDED, 1);
  hideDlg($("xDlg"));
  if (ui.view === "welcome") go("#for");
}
/* After signing up: a short guide for people new to the Dread List (not for anyone bringing a list with them). */
function maybeOnboard() {
  if (onboarded() || FILMS.filter(f => eff(f.id).s).length >= 5) return;
  setTimeout(startOnboarding, 120);
}

/* ---------- Share cards ---------- */
const filmURL = f => `${location.origin}/#film=${encodeURIComponent(f.id)}`;
function shareBtnHTML(f) {
  return `<button type="button" class="act quiet share" data-share="${esc(f.id)}" title="Share this film">Share</button>`;
}
const loadImg = src => new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = src; });
function wrapText(ctx, text, maxW, maxLines) {
  const words = String(text || "").split(/\s+/).filter(Boolean), lines = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? cur + " " + w : w;
    if (ctx.measureText(t).width <= maxW || !cur) cur = t;
    else { lines.push(cur); cur = w; if (lines.length === maxLines) break; }
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) {
    let last = lines[maxLines - 1];
    while (last.length > 1 && ctx.measureText(last + "…").width > maxW) last = last.slice(0, -1);
    lines[maxLines - 1] = last.replace(/[\s,;:.]+$/, "") + "…";
  }
  return lines;
}
/* A 1080×1350 card in the site's camcorder style: the poster, the title, your score (or match), the pitch. */
async function drawCard(f) {
  const W = 1080, H = 1350, c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d"), e = eff(f.id);
  try { await Promise.all(["400 120px VT323", "600 64px 'IBM Plex Sans'", "400 34px 'IBM Plex Sans'"].map(s => document.fonts.load(s))); } catch (err) { /* fall back to system fonts */ }
  const BG = "#12110C", INK = "#EFE6B8", MUTED = "#9E9671", HI = "#E9D66B", REC = "#FF4433";
  ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
  let poster = null;
  const src = posterSrc(f, true);
  if (src) { try { poster = await loadImg(src); } catch (err) { poster = null; } }
  if (poster) {
    // The poster, blurred by drawing it tiny and scaling it up, as a dim backdrop.
    const t = document.createElement("canvas"); t.width = 18; t.height = 24;
    t.getContext("2d").drawImage(poster, 0, 0, 18, 24);
    ctx.globalAlpha = 0.45; ctx.imageSmoothingEnabled = true; ctx.drawImage(t, -60, -60, W + 120, H + 120); ctx.globalAlpha = 1;
  }
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "rgba(18,17,12,.55)"); g.addColorStop(0.55, "rgba(18,17,12,.86)"); g.addColorStop(1, "rgba(18,17,12,.97)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "rgba(0,0,0,.18)";
  for (let y = 0; y < H; y += 6) ctx.fillRect(0, y, W, 2); // scanlines
  // Camcorder overlay
  ctx.fillStyle = REC; ctx.beginPath(); ctx.arc(92, 96, 17, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = INK; ctx.font = "400 60px VT323, monospace"; ctx.textBaseline = "middle";
  ctx.fillText("REC", 124, 98);
  ctx.textAlign = "right";
  ctx.fillText(new Date().toLocaleDateString("en-GB", {day: "2-digit", month: "short", year: "numeric"}).toUpperCase(), W - 72, 98);
  ctx.textAlign = "left";
  ctx.strokeStyle = "rgba(239,230,184,.5)"; ctx.lineWidth = 4;
  for (const [x, y, dx, dy] of [[48, 160, 1, 1], [W - 48, 160, -1, 1], [48, H - 48, 1, -1], [W - 48, H - 48, -1, -1]]) {
    ctx.beginPath(); ctx.moveTo(x, y + dy * 60); ctx.lineTo(x, y); ctx.lineTo(x + dx * 60, y); ctx.stroke();
  }
  // Poster
  const px = 96, py = 200, pw = 380, ph = 570;
  if (poster) {
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(poster, px, py, pw, ph);
    ctx.strokeStyle = "rgba(239,230,184,.35)"; ctx.lineWidth = 2; ctx.strokeRect(px, py, pw, ph);
  } else {
    ctx.fillStyle = "#0D0C08"; ctx.fillRect(px, py, pw, ph);
    ctx.fillStyle = MUTED; ctx.font = "400 160px VT323, monospace"; ctx.textAlign = "center"; ctx.fillText("?", px + pw / 2, py + ph / 2); ctx.textAlign = "left";
  }
  // Score or match
  const tx = px + pw + 56, tw = W - tx - 80;
  ctx.textBaseline = "alphabetic";
  let big, word, col = HI;
  if (e.s) { big = `${e.s}/10`; word = SCORE_WORD[e.s].toUpperCase(); col = e.s >= 9 ? HI : e.s >= 7 ? "#B9C97A" : e.s >= 5 ? "#E2A646" : REC; }
  else if (e.w) { big = `${f._m}%`; word = "ON MY WATCHLIST"; }
  else { big = `${f._m}%`; word = "MATCH FOR ME"; }
  ctx.fillStyle = col; ctx.font = "400 190px VT323, monospace";
  ctx.fillText(big, tx - 6, py + 150);
  ctx.fillStyle = INK; ctx.font = "400 54px VT323, monospace";
  ctx.fillText(word, tx, py + 214);
  // Facts beside the poster
  ctx.fillStyle = MUTED; ctx.font = "400 34px 'IBM Plex Sans', system-ui, sans-serif";
  const facts = [f.y, (f.dir || [])[0] ? "Dir. " + f.dir[0] : "", f.rn ? runtime(f.rn) : "", typeof f.im === "number" ? "IMDb " + f.im.toFixed(1) : ""].filter(Boolean);
  let fy = py + 300;
  for (const line of facts.slice(0, 4)) { for (const l of wrapText(ctx, String(line), tw, 2)) { ctx.fillText(l, tx, fy); fy += 48; } }
  // Title and pitch under the poster
  ctx.fillStyle = INK; ctx.font = "600 68px 'IBM Plex Sans', system-ui, sans-serif";
  let y = py + ph + 110;
  for (const l of wrapText(ctx, f.t, W - 2 * px, 2)) { ctx.fillText(l, px, y); y += 82; }
  const pitch = f.w || f.d || "";
  if (pitch) {
    ctx.fillStyle = "#CFC69B"; ctx.font = "400 36px 'IBM Plex Sans', system-ui, sans-serif";
    y += 6;
    for (const l of wrapText(ctx, pitch, W - 2 * px, 3)) { ctx.fillText(l, px, y); y += 50; }
  }
  // Footer
  ctx.fillStyle = REC; ctx.beginPath(); ctx.arc(px + 12, H - 108, 11, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = INK; ctx.font = "400 58px VT323, monospace"; ctx.textBaseline = "middle";
  ctx.fillText("dreadlist.co.uk", px + 40, H - 106);
  if (acct.user) { ctx.textAlign = "right"; ctx.fillStyle = MUTED; ctx.font = "400 44px VT323, monospace"; ctx.fillText("@" + acct.user.handle, W - px, H - 106); ctx.textAlign = "left"; }
  return new Promise(ok => c.toBlob(b => ok(b), "image/png"));
}
let card = {url: null, file: null, film: null};
async function openShare(id) {
  const f = BY.get(id);
  if (!f) return;
  const d = $("xDlg");
  d.dataset.kind = "share";
  $("x-h").textContent = "Share " + f.t;
  $("xBox").innerHTML = `<p class="hint">Making the picture…</p>`;
  showDlg(d);
  if (card.url) URL.revokeObjectURL(card.url);
  card = {url: null, file: null, film: f};
  try {
    const blob = await drawCard(f);
    if (card.film !== f) return;
    card.file = new File([blob], `${f.id}-dread-list.png`, {type: "image/png"});
    card.url = URL.createObjectURL(blob);
    const canFiles = !!(navigator.canShare && navigator.canShare({files: [card.file]}));
    $("xBox").innerHTML = `<img class="card-img" src="${card.url}" alt="A share card for ${esc(f.t)}" width="540" height="675">
      <div class="btns left card-btns">${canFiles ? `<button type="button" class="btn" data-card="share">Share picture</button>` : ""}
        <a class="btn${canFiles ? " ghost" : ""}" href="${card.url}" download="${esc(card.file.name)}">Save picture</a>
        <button type="button" class="btn ghost" data-card="link">${navigator.share ? "Share link" : "Copy link"}</button></div>
      <p class="hint card-hint">${canFiles ? "Share it to Instagram, Messages, WhatsApp or anywhere else." : "Save it, then post it anywhere."} The link opens ${esc(f.t)} on the Dread List. On a phone you can also press and hold the picture to save it.</p>`;
  } catch (err) {
    $("xBox").innerHTML = `<p class="err">Couldn’t make the picture on this device.</p><div class="btns left"><button type="button" class="btn ghost" data-card="link">Share link</button></div>`;
  }
}
function wireExtras() {
  document.addEventListener("click", async e => {
    const w = e.target.closest("[data-wel]");
    if (w) { if (w.dataset.wel === "start") leaveWelcome(startOnboarding); else leaveWelcome(() => openAuth("start")); return; }
    const s = e.target.closest("[data-share]");
    if (s) { openShare(s.dataset.share); return; }
    const o = e.target.closest("[data-act='onboard']");
    if (o) { hideDlg($("settings")); startOnboarding(); return; }
    const c = e.target.closest("[data-card]");
    if (c && card.film) {
      const f = card.film, text = `${f.t}${f.y ? ` (${f.y})` : ""} on the Dread List`;
      if (c.dataset.card === "share" && card.file) {
        try { await navigator.share({files: [card.file], title: f.t, text: `${text}: ${filmURL(f)}`}); } catch (err) { if (!err || err.name !== "AbortError") toast("Sharing didn’t work. Use Save picture instead."); }
      } else if (c.dataset.card === "link") {
        await shareLink({title: f.t, text, url: filmURL(f)});
      }
      return;
    }
    const b = e.target.closest("[data-ob]");
    if (!b) return;
    const a = b.dataset.ob;
    if (a === "next") { if (obStep < 2) { obStep++; renderOnboarding(); } else endOnboarding(); }
    else if (a === "back") { obStep = Math.max(0, obStep - 1); renderOnboarding(); }
    else if (a === "skip") endOnboarding();
    else if (a === "account") { endOnboarding(); openAuth("start"); }
  });
  document.addEventListener("change", e => {
    const t = e.target;
    if (t.dataset.obSvc) setCfg({svc: Object.assign({}, cfg.svc, {[t.dataset.obSvc]: t.checked ? 1 : 0})});
    else if (t.hasAttribute && t.hasAttribute("data-ob-free")) setCfg({free: t.checked ? 1 : 0});
  });
  // Ratings made in the guide update its "rated so far" line.
  $("xDlg").addEventListener("click", e => {
    if ($("xDlg").dataset.kind === "onboard" && obStep === 1 && e.target.closest("[data-act='rate'], [data-act='clear']")) setTimeout(renderOnboarding, 0);
  });
  $("xDlg").addEventListener("close", () => {
    if ($("xDlg").dataset.kind === "onboard") store.set(KEY_ONBOARDED, 1);
    if (card.url) { URL.revokeObjectURL(card.url); card = {url: null, file: null, film: null}; }
  });
}
document.addEventListener("DOMContentLoaded", wireExtras, {once: true});
