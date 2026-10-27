// End-to-end API tests against `wrangler dev` (local D1). Run: node tests/api.test.mjs [baseUrl]
// Each "device" keeps its own cookie jar; passkeys are software authenticators making real signatures.
import {SoftAuthenticator, b64url} from "./softauthn.mjs";
import {execFileSync} from "node:child_process";

const BASE = process.argv[2] || "http://localhost:8787";
const ORIGIN = BASE;
let passed = 0, failed = 0;
const ok = (cond, name, extra) => { if (cond) { passed++; console.log("  ✓ " + name); } else { failed++; console.log("  ✗ " + name + (extra ? " — " + JSON.stringify(extra).slice(0, 300) : "")); } };
const section = s => console.log("\n" + s);
const sql = cmd => {
  if (!process.env.WR) return null;
  return execFileSync(process.env.WR, ["d1", "execute", "dread", "--local", "--persist-to", process.env.D1STATE, "--command", cmd, "--json"], {cwd: process.env.REPO, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]});
};

class Device {
  constructor(name) { this.name = name; this.cookie = null; }
  async req(method, path, body, opts = {}) {
    const headers = Object.assign({}, opts.headers);
    if (body !== undefined && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
    if (method !== "GET" && !("Origin" in headers)) headers.Origin = ORIGIN;
    if (headers.Origin === null) delete headers.Origin;
    if (this.cookie) headers.Cookie = this.cookie;
    headers["User-Agent"] = opts.ua || "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0";
    const res = await fetch(BASE + path, {method, headers, body: body === undefined ? undefined : (typeof body === "string" ? body : JSON.stringify(body)), redirect: "manual"});
    const sc = res.headers.get("set-cookie");
    if (sc) { const m = /__Host-dread=([^;]*)/.exec(sc); if (m) this.cookie = m[1] ? "__Host-dread=" + m[1] : null; this.lastSetCookie = sc; }
    let data = null;
    const text = await res.text();
    try { data = JSON.parse(text); } catch (e) { data = text; }
    return {status: res.status, data, headers: res.headers};
  }
  get = (p, o) => this.req("GET", p, undefined, o);
  post = (p, b, o) => this.req("POST", p, b === undefined ? {} : b, o);
  patch = (p, b, o) => this.req("PATCH", p, b, o);
  put = (p, b, o) => this.req("PUT", p, b, o);
  del = (p, o) => this.req("DELETE", p, {}, o);
}

async function signUp(dev, auth, handle, tweak) {
  const o = await dev.post("/api/auth/register/options", {handle});
  if (o.status !== 200) return o;
  const cred = await auth.create(o.data.options, ORIGIN, tweak);
  return dev.post("/api/auth/register/verify", {flow: o.data.flow, credential: cred});
}
async function signIn(dev, auth, tweak) {
  const o = await dev.post("/api/auth/login/options", {});
  const cred = await auth.get(o.data.options, ORIGIN, tweak);
  return dev.post("/api/auth/login/verify", {flow: o.data.flow, credential: cred});
}
async function reauth(dev, auth) {
  const o = await dev.post("/api/auth/reauth/options", {});
  const cred = await auth.get(o.data.options, ORIGIN);
  return dev.post("/api/auth/reauth/verify", {flow: o.data.flow, credential: cred});
}
const iso = (offsetSec = 0) => new Date(Date.now() + offsetSec * 1000).toISOString();
const uniq = Math.random().toString(36).slice(2, 7);

(async () => {
  const don = new Device("don laptop"), donPhone = new Device("don phone"), pho = new Device("phoebe"), anon = new Device("anon");
  const donKey = new SoftAuthenticator(-7), phoKey = new SoftAuthenticator(-8), rsaKey = new SoftAuthenticator(-257);
  const H = {don: "don" + uniq, pho: "phoebe" + uniq, rsa: "rsa" + uniq};

  section("Handles");
  ok((await anon.post("/api/auth/register/options", {handle: "ab"})).status === 400, "too short is rejected");
  ok((await anon.post("/api/auth/register/options", {handle: "admin"})).data.error === "handle_reserved", "reserved names are rejected");
  ok((await anon.post("/api/auth/register/options", {handle: "bad name!"})).status === 400, "spaces and symbols are rejected");
  ok((await anon.post("/api/auth/register/options", {handle: "a--b"})).status === 400, "double dashes are rejected");

  section("Sign up (ES256)");
  const reg = await signUp(don, donKey, H.don.toUpperCase());
  ok(reg.status === 200 && reg.data.user.handle === H.don, "registers and lowercases the name", reg.data);
  ok(Array.isArray(reg.data.recoveryCodes) && reg.data.recoveryCodes.length === 10 && /^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/.test(reg.data.recoveryCodes[0]), "returns ten recovery codes");
  ok(/__Host-dread=[A-Za-z0-9_-]{43}; Path=\/; Secure; HttpOnly; SameSite=Strict; Max-Age=2592000/.test(don.lastSetCookie), "session cookie is __Host-, Secure, HttpOnly, SameSite=Strict");
  const me = await don.get("/api/me");
  ok(me.data.user && me.data.user.handle === H.don && me.data.user.passkeys === 1 && me.data.user.recoveryLeft === 10, "/api/me shows the account", me.data);
  ok((await anon.post("/api/auth/register/options", {handle: H.don})).data.error === "handle_taken", "taken names are rejected");

  section("Registration checks");
  for (const [name, tweak] of [["wrong origin", {origin: "https://evil.example"}], ["wrong RP ID", {rpId: "evil.example"}], ["wrong challenge", {challenge: b64url(new Uint8Array(32))}],
    ["no user verification", {flags: 0x01 | 0x40}], ["wrong ceremony type", {type: "webauthn.get"}]]) {
    const r = await signUp(anon, new SoftAuthenticator(-7), "x" + uniq + name.length, tweak);
    ok(r.status === 400 && r.data.error === "passkey_rejected", "rejects " + name, r.data);
  }
  const o1 = await anon.post("/api/auth/register/options", {handle: "replay" + uniq});
  const c1 = await new SoftAuthenticator(-7).create(o1.data.options, ORIGIN);
  ok((await anon.post("/api/auth/register/verify", {flow: o1.data.flow, credential: c1})).status === 200, "a fresh challenge works once");
  ok((await anon.post("/api/auth/register/verify", {flow: o1.data.flow, credential: c1})).data.error === "expired", "the same challenge can't be replayed");
  await anon.post("/api/auth/logout");

  section("Sync");
  const t0 = iso(-60);
  let r = await don.post("/api/state", {since: 0, films: {
    "lake-mungo-2008": {t: t0, s: 9, r: "loved", seen: 1, f: {t: "Lake Mungo", y: 2008, tg: ["found-footage"], jw: "@evil.example/x", imdb: "javascript:alert(1)", jid: "tm42679"}},
    "tm1001": {t: t0, w: 1, f: {t: "Some Film", y: 2020}},
    "tm1002": {t: t0, x: 1},
    "BAD ID": {t: t0, s: 5},
    "tm1003": {t: "not a date", s: 5},
    "tm1004": {t: iso(86400 * 30), s: 4}
  }, cfg: {svc: {nf: 1, pv: 1, evil: 1}, free: 1, hide: {spiders: 1}, theme: "dark", share: 1, en: 0, t: t0}});
  ok(r.status === 200 && r.data.rev >= 1, "push returns a revision", r.data);
  const films = r.data.films;
  ok(films["lake-mungo-2008"] && films["lake-mungo-2008"].s === 9 && films["lake-mungo-2008"].r === "loved", "rating stored with its tier");
  ok(films["lake-mungo-2008"].f && !films["lake-mungo-2008"].f.jw && !films["lake-mungo-2008"].f.imdb && films["lake-mungo-2008"].f.jid === "tm42679", "unsafe link fields in the film copy are dropped", films["lake-mungo-2008"].f);
  ok(films.tm1001 && films.tm1001.w === 1 && films.tm1002 && films.tm1002.x === 1, "want and pass stored");
  ok(!films["BAD ID"] && !films.tm1003, "bad ids and timestamps are dropped");
  ok(films.tm1004 && Date.parse(films.tm1004.t) <= Date.now() + 5000, "future timestamps are pulled back to now");
  ok(r.data.cfg && r.data.cfg.svc.nf === 1 && !r.data.cfg.svc.evil && r.data.cfg.hide.spiders === 1 && r.data.cfg.theme === "dark", "settings stored and cleaned", r.data.cfg);
  const rev1 = r.data.rev;
  r = await don.post("/api/state", {since: rev1, films: {"lake-mungo-2008": {t: iso(-3600), s: 2}}});
  ok(!r.data.films["lake-mungo-2008"], "an older change loses (last writer wins)");
  r = await don.get("/api/state?since=0");
  ok(r.data.films["lake-mungo-2008"].s === 9, "the newer rating stands");
  r = await donPhone.get("/api/state?since=0");
  ok(r.status === 401, "another device without a session can't read it");
  r = await don.post("/api/state", {since: rev1, films: {"tm1001": {t: iso(), s: 7, seen: 1}}});
  ok(r.data.films.tm1001 && r.data.films.tm1001.s === 7 && !r.data.films.tm1001.w, "rating a wanted film clears want", r.data.films.tm1001);
  ok(Object.keys(r.data.films).length === 1, "only changes since the given revision come back", Object.keys(r.data.films));

  section("Same-origin and input checks");
  ok((await don.post("/api/state", {since: 0}, {headers: {Origin: null}})).status === 403, "no Origin header is refused");
  ok((await don.post("/api/state", {since: 0}, {headers: {Origin: "https://evil.example"}})).status === 403, "a foreign Origin is refused");
  ok((await don.post("/api/state", "since=0", {headers: {"Content-Type": "application/x-www-form-urlencoded"}})).status === 415, "form posts are refused");
  ok((await don.post("/api/state", "{not json", {headers: {"Content-Type": "application/json"}})).status === 400, "broken JSON is refused");
  ok((await don.req("PUT", "/api/state", {})).status === 405, "wrong method is 405");
  ok((await don.get("/api/nope")).status === 404, "unknown endpoint is 404");
  const hdr = await don.get("/api/me");
  ok(hdr.headers.get("cache-control") === "no-store" && hdr.headers.get("x-content-type-options") === "nosniff" && /frame-ancestors 'none'/.test(hdr.headers.get("content-security-policy") || ""), "API responses carry no-store and security headers");

  section("Sign out, sign in");
  await don.post("/api/auth/logout");
  ok((await don.get("/api/me")).data.user === null, "signed out");
  r = await signIn(donPhone, donKey);
  ok(r.status === 200 && r.data.user.handle === H.don, "passkey sign-in on a second device (discoverable)", r.data);
  ok((await donPhone.get("/api/state?since=0")).data.films["lake-mungo-2008"].s === 9, "second device sees the list");
  for (const [name, tweak] of [["a corrupted signature", {corruptSig: true}], ["tampered authenticator data", {corruptAuthData: true}], ["another site's origin", {origin: "https://evil.example"}], ["no user verification", {flags: 0x01}]]) {
    r = await signIn(anon, donKey, tweak);
    ok(r.status === 400, "rejects " + name, r.data);
  }
  const lo = await anon.post("/api/auth/login/options", {});
  const la = await donKey.get(lo.data.options, ORIGIN);
  ok((await anon.post("/api/auth/login/verify", {flow: lo.data.flow, credential: la})).status === 200, "assertion works once");
  ok((await anon.post("/api/auth/login/verify", {flow: lo.data.flow, credential: la})).data.error === "expired", "and can't be replayed");
  await anon.post("/api/auth/logout");

  section("Signature counters");
  const ctrKey = new SoftAuthenticator(-7), ctrDev = new Device("ctr");
  const lo2 = await ctrDev.post("/api/auth/register/options", {handle: "ctr" + uniq});
  const cc = await ctrKey.create(lo2.data.options, ORIGIN, {useCounter: true});
  await ctrDev.post("/api/auth/register/verify", {flow: lo2.data.flow, credential: cc});
  ok((await signIn(ctrDev, ctrKey)).status === 200, "counter 1 accepted");
  ok((await signIn(ctrDev, ctrKey)).status === 200, "counter 2 accepted");
  ok((await signIn(ctrDev, ctrKey, {keepCounter: true})).status === 400, "a repeated counter is refused (possible clone)");

  section("Other key types");
  r = await signUp(pho, phoKey, H.pho);
  ok(r.status === 200, "Ed25519 passkey registers", r.data);
  await pho.post("/api/auth/logout");
  ok((await signIn(pho, phoKey)).status === 200, "Ed25519 passkey signs in");
  const rsaDev = new Device("rsa");
  ok((await signUp(rsaDev, rsaKey, H.rsa)).status === 200, "RSA passkey registers");
  await rsaDev.post("/api/auth/logout");
  ok((await signIn(rsaDev, rsaKey)).status === 200, "RSA passkey signs in");

  section("Recovery codes");
  const codes = reg.data.recoveryCodes;
  const rec = new Device("recovery");
  ok((await rec.post("/api/auth/recover", {handle: H.don, code: "AAAA-BBBB-CCCC-DDDD"})).data.error === "bad_code", "a wrong code fails");
  r = await rec.post("/api/auth/recover", {handle: H.don, code: codes[0].toLowerCase().replace(/-/g, " ")});
  ok(r.status === 200 && r.data.recoveryLeft === 9, "a code works, whatever the case or spacing", r.data);
  ok((await rec.get("/api/me")).data.session.method === "recovery", "session is marked as a recovery sign-in");
  ok((await new Device("x").post("/api/auth/recover", {handle: H.don, code: codes[0]})).data.error === "bad_code", "a used code doesn't work again");
  ok((await new Device("x").post("/api/auth/recover", {handle: H.pho, code: codes[1]})).data.error === "bad_code", "codes only work for their own account");
  r = await rec.post("/api/me/passkeys/options", {});
  ok(r.status === 200, "a fresh recovery session can add a passkey");
  const newKey = new SoftAuthenticator(-7);
  const nk = await newKey.create(r.data.options, ORIGIN);
  r = await rec.post("/api/me/passkeys/verify", {flow: r.data.flow, credential: nk, name: "New phone"});
  ok(r.status === 200, "new passkey added", r.data);
  r = await rec.get("/api/me/passkeys");
  ok(r.data.passkeys.length === 2 && r.data.passkeys.some(p => p.name === "New phone"), "both passkeys listed", r.data);

  section("Fresh sign-in needed for sensitive changes");
  if (process.env.WR) {
    sql(`UPDATE sessions SET authed_at = 0`);
    ok((await donPhone.post("/api/me/recovery", {})).data.error === "reauth", "new recovery codes need a recent sign-in");
    ok((await donPhone.post("/api/me/link", {})).data.error === "reauth", "linking a device needs a recent sign-in");
    ok((await donPhone.del("/api/me")).data.error === "reauth", "deleting the account needs a recent sign-in");
    r = await reauth(donPhone, donKey);
    ok(r.status === 200, "confirming with a passkey", r.data);
    r = await donPhone.post("/api/me/recovery", {});
    ok(r.status === 200 && r.data.recoveryCodes.length === 10, "then new recovery codes are issued");
    ok((await new Device("x").post("/api/auth/recover", {handle: H.don, code: codes[2]})).data.error === "bad_code", "and the old ones stop working");
  } else console.log("  (skipped: set WR, D1STATE and REPO to run database-backed checks)");

  section("Link a device");
  if (!(await donPhone.get("/api/me")).data.session.fresh) await reauth(donPhone, donKey);
  r = await donPhone.post("/api/me/link", {});
  ok(r.status === 200 && /^[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(r.data.code), "a link code is issued", r.data);
  const tv = new Device("tv");
  ok((await tv.post("/api/auth/link", {code: "0000-0000"})).status === 400, "a wrong link code fails");
  r = await tv.post("/api/auth/link", {code: r.data.code.toLowerCase()});
  ok(r.status === 200 && r.data.user.handle === H.don, "the right code signs the new device in", r.data);
  ok((await tv.get("/api/me")).data.session.method === "link", "marked as a linked sign-in");

  section("Sessions");
  r = await donPhone.get("/api/me/sessions");
  ok(r.status === 200 && r.data.sessions.some(s => s.current) && r.data.sessions.every(s => s.device), "sessions listed with device labels", r.data.sessions);
  const other = r.data.sessions.find(s => !s.current && s.method === "link");
  ok(other && (await donPhone.del("/api/me/sessions/" + other.id)).status === 200, "sign out one session");
  ok((await tv.get("/api/me")).data.user === null, "that device is signed out");

  section("Public profile");
  ok((await anon.get("/api/u/" + H.don)).status === 404, "private by default");
  r = await donPhone.patch("/api/me", {public: true});
  ok(r.data.public === true, "switched on");
  r = await anon.get("/api/u/" + H.don);
  ok(r.status === 200 && r.data.films["lake-mungo-2008"][0] === 9, "shows ratings", r.data);
  ok(!r.data.films.tm1002, "never shows passes");
  ok(!JSON.stringify(r.data).includes(t0.slice(0, 16)), "never shows dates");
  r = await donPhone.patch("/api/me", {handle: H.pho});
  ok(r.status === 409, "can't take someone else's name");

  section("Hints (opt-in, anonymous)");
  r = await anon.get("/api/hints");
  ok(r.status === 200 && r.data.loved.includes("lake-mungo-2008") && !JSON.stringify(r.data).includes(H.don), "shared taste appears without names", r.data);
  ok(r.data.pass.includes("tm1002"), "passes help too");

  section("Shared lists");
  r = await donPhone.post("/api/lists", {name: "Horror night"});
  ok(r.status === 200 && r.data.invite, "list created with an invite", r.data);
  const L = r.data;
  ok((await pho.get("/api/lists/" + L.id)).status === 404, "outsiders can't see it");
  ok((await pho.post("/api/lists/join", {list: L.id, invite: "x".repeat(22)})).data.error === "bad_invite", "a wrong invite fails");
  r = await pho.post("/api/lists/join", {list: L.id, invite: L.invite});
  ok(r.status === 200 && r.data.name === "Horror night", "joins with the invite", r.data);
  await pho.post("/api/state", {since: 0, films: {"tm2001": {t: iso(), s: 8, seen: 1, f: {t: "Film B", y: 2019}}}, cfg: {svc: {}, hide: {snakes: 1}, t: iso()}});
  ok((await pho.put(`/api/lists/${L.id}/items/tm3001`, {f: {t: "Film C", y: 2021, jw: "/uk/movie/film-c"}})).status === 200, "member adds a film");
  r = await donPhone.get("/api/lists/" + L.id);
  ok(r.data.members.length === 2 && r.data.items.length === 1 && r.data.items[0].addedBy === H.pho, "both members and the film are visible", r.data);
  const phoM = r.data.members.find(m => m.handle === H.pho);
  ok(phoM.films.tm2001 && phoM.films.tm2001[0] === 8 && phoM.hide.snakes === 1, "members' ratings and hidden flags come back for ranking", phoM);
  ok((await donPhone.patch(`/api/lists/${L.id}/items/tm3001`, {watched: true})).status === 200, "mark watched together");
  ok((await pho.patch("/api/lists/" + L.id, {name: "Mine now"})).data.error === "owner_only", "only the owner renames");
  r = await donPhone.post(`/api/lists/${L.id}/invite`, {});
  ok(r.data.invite && r.data.invite !== L.invite, "owner rotates the invite");
  ok((await new Device("late").post("/api/lists/join", {list: L.id, invite: L.invite})).status === 401, "joining needs an account");
  r = await pho.get("/api/lists");
  ok(r.data.lists.length === 1 && r.data.lists[0].members.length === 2, "lists overview");
  ok((await donPhone.del(`/api/lists/${L.id}/members/me`)).status === 200, "owner leaves");
  r = await pho.get("/api/lists/" + L.id);
  ok(r.data.list.owner === true, "ownership passes to the other member");
  ok((await pho.del(`/api/lists/${L.id}`)).status === 200, "new owner deletes the list");

  section("Rate limits");
  let limited = false;
  for (let i = 0; i < 12 && !limited; i++) limited = (await new Device("brute").post("/api/auth/recover", {handle: H.pho, code: "AAAABBBBCCCCDDDD"})).status === 429;
  ok(limited, "recovery attempts are rate limited");
  const rl = await new Device("brute").post("/api/auth/recover", {handle: H.pho, code: "AAAABBBBCCCCDDDD"});
  ok(rl.status === 429 && Number(rl.headers.get("retry-after")) > 0, "429 carries Retry-After");

  section("Export and delete");
  r = await donPhone.get("/api/me/export");
  ok(r.status === 200 && r.data.account.handle === H.don && r.data.films["lake-mungo-2008"] && r.data.passkeys.length === 2, "export has the account, films and passkeys");
  if (!(await donPhone.get("/api/me")).data.session.fresh) await reauth(donPhone, donKey);
  r = await donPhone.del("/api/me");
  ok(r.status === 200 && /Max-Age=0/.test(donPhone.lastSetCookie || ""), "account deleted and cookie cleared", r.data);
  ok((await signIn(new Device("ghost"), donKey)).data.error === "unknown_passkey", "its passkeys no longer work");
  ok((await anon.get("/api/u/" + H.don)).status === 404, "its profile is gone");
  if (process.env.WR) {
    const out = JSON.parse(sql(`SELECT (SELECT COUNT(*) FROM entries e WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = e.user_id)) AS orphans, (SELECT COUNT(*) FROM sessions s WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = s.user_id)) AS s2`));
    ok(out[0].results[0].orphans === 0 && out[0].results[0].s2 === 0, "no orphaned rows left behind", out[0].results);
  }

  section("Well-known files and headers");
  const sec = await fetch(BASE + "/.well-known/security.txt");
  ok(sec.status === 200 && /^Contact: /m.test(await sec.text()), "security.txt is served");
  const rob = await fetch(BASE + "/robots.txt");
  ok(rob.status === 200 && /Disallow: \/api\//.test(await rob.text()), "robots.txt keeps crawlers off the API and profiles");
  const h2 = (await anon.get("/api/health")).headers;
  ok(h2.get("cross-origin-embedder-policy") === "require-corp" && h2.get("strict-transport-security") && h2.get("x-permitted-cross-domain-policies") === "none", "isolation headers present");

  section("Session cap");
  if (process.env.WR) {
    const capKey = new SoftAuthenticator(-7), capDev = new Device("cap");
    await signUp(capDev, capKey, "cap" + uniq);
    // Sign-ins share the test's one IP with the rate limiter, so start from a clean slate for it.
    sql(`DELETE FROM rl`);
    let made = 1;
    for (let i = 0; i < 32; i++) if ((await signIn(new Device("cap" + i), capKey)).status === 200) made++;
    const n = JSON.parse(sql(`SELECT COUNT(*) AS n FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.handle = 'cap${uniq}'`))[0].results[0].n;
    ok(made > 30 && n === 30, "at most 30 signed-in browsers per account", {made, n});
  }

  section("Page");
  const page = await fetch(BASE + "/u/" + H.pho);
  ok(page.status === 200 && /Content-Security-Policy/i.test([...page.headers.keys()].join(" ")) && (await page.text()).includes("<title>"), "profile URLs serve the app with a CSP");

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
