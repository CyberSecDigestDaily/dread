/* Dread List Worker: serves the page (static assets) and the /api used for accounts, sync, shared lists, public
   profiles and adding films from TMDB. Data lives in D1 (EU jurisdiction). One optional secret, TMDB_KEY, switches on
   film search; nothing else needs a key. */

import {HttpError} from "./util.js";
import {withHeaders, json, errorResponse, checkOrigin, allowedOrigins} from "./http.js";
import {ensureSchema, cleanup} from "./db.js";
import * as auth from "./auth.js";
import {getState, postState} from "./sync.js";
import * as lists from "./lists.js";
import {patchMe, deleteMe, exportMe, publicProfile, hints} from "./account.js";
import {findStatus, findSearch, findFilm, findAdded, addedFeed, tmdbImage} from "./find.js";

/* [method, path pattern, handler(env, request, ctx, params, url)]. :name matches one path segment. */
const ROUTES = [
  ["GET", "/api/health", () => json({ok: true})],
  ["GET", "/api/me", (env, req, ctx) => auth.me(env, req, ctx)],
  ["PATCH", "/api/me", (env, req, ctx) => patchMe(env, req, ctx)],
  ["DELETE", "/api/me", (env, req, ctx) => deleteMe(env, req, ctx)],
  ["GET", "/api/me/export", (env, req, ctx) => exportMe(env, req, ctx)],
  ["GET", "/api/me/passkeys", (env, req, ctx) => auth.listPasskeys(env, req, ctx)],
  ["POST", "/api/me/passkeys/options", (env, req, ctx) => auth.addPasskeyOptions(env, req, ctx)],
  ["POST", "/api/me/passkeys/verify", (env, req, ctx) => auth.addPasskeyVerify(env, req, ctx)],
  ["PATCH", "/api/me/passkeys/:id", (env, req, ctx, p) => auth.renamePasskey(env, req, ctx, p.id)],
  ["DELETE", "/api/me/passkeys/:id", (env, req, ctx, p) => auth.deletePasskey(env, req, ctx, p.id)],
  ["POST", "/api/me/recovery", (env, req, ctx) => auth.regenerateRecovery(env, req, ctx)],
  ["POST", "/api/me/link", (env, req, ctx) => auth.createLink(env, req, ctx)],
  ["GET", "/api/me/sessions", (env, req, ctx) => auth.listSessions(env, req, ctx)],
  ["DELETE", "/api/me/sessions/:id", (env, req, ctx, p) => auth.revokeSession(env, req, ctx, p.id)],
  ["POST", "/api/me/sessions/revoke-others", (env, req, ctx) => auth.revokeOthers(env, req, ctx)],
  ["POST", "/api/auth/register/options", (env, req) => auth.registerOptions(env, req)],
  ["POST", "/api/auth/register/verify", (env, req) => auth.registerVerify(env, req)],
  ["POST", "/api/auth/login/options", (env, req) => auth.loginOptions(env, req)],
  ["POST", "/api/auth/login/verify", (env, req) => auth.loginVerify(env, req)],
  ["POST", "/api/auth/reauth/options", (env, req, ctx) => auth.reauthOptions(env, req, ctx)],
  ["POST", "/api/auth/reauth/verify", (env, req, ctx) => auth.reauthVerify(env, req, ctx)],
  ["POST", "/api/auth/recover", (env, req) => auth.recover(env, req)],
  ["POST", "/api/auth/link", (env, req) => auth.redeemLink(env, req)],
  ["POST", "/api/auth/logout", (env, req, ctx) => auth.logout(env, req, ctx)],
  ["GET", "/api/state", (env, req, ctx, p, url) => getState(env, req, ctx, url)],
  ["POST", "/api/state", (env, req, ctx) => postState(env, req, ctx)],
  ["GET", "/api/lists", (env, req, ctx) => lists.myLists(env, req, ctx)],
  ["POST", "/api/lists", (env, req, ctx) => lists.createList(env, req, ctx)],
  ["POST", "/api/lists/join", (env, req, ctx) => lists.joinList(env, req, ctx)],
  ["GET", "/api/lists/:id", (env, req, ctx, p) => lists.getList(env, req, ctx, p.id)],
  ["PATCH", "/api/lists/:id", (env, req, ctx, p) => lists.renameList(env, req, ctx, p.id)],
  ["DELETE", "/api/lists/:id", (env, req, ctx, p) => lists.deleteList(env, req, ctx, p.id)],
  ["POST", "/api/lists/:id/invite", (env, req, ctx, p) => lists.rotateInvite(env, req, ctx, p.id)],
  ["DELETE", "/api/lists/:id/members/:who", (env, req, ctx, p) => lists.removeMember(env, req, ctx, p.id, p.who)],
  ["PUT", "/api/lists/:id/items/:film", (env, req, ctx, p) => lists.putItem(env, req, ctx, p.id, p.film)],
  ["PATCH", "/api/lists/:id/items/:film", (env, req, ctx, p) => lists.patchItem(env, req, ctx, p.id, p.film)],
  ["DELETE", "/api/lists/:id/items/:film", (env, req, ctx, p) => lists.deleteItem(env, req, ctx, p.id, p.film)],
  ["GET", "/api/u/:handle", (env, req, ctx, p) => publicProfile(env, req, p.handle)],
  ["GET", "/api/hints", (env, req) => hints(env, req)],
  ["GET", "/api/find/status", env => findStatus(env)],
  ["GET", "/api/find", (env, req, ctx, p, url) => findSearch(env, req, url)],
  ["GET", "/api/find/:id", (env, req, ctx, p) => findFilm(env, req, p.id)],
  ["POST", "/api/find/:id", (env, req, ctx, p) => findAdded(env, req, p.id)],
  ["GET", "/api/added", (env, req) => addedFeed(env, req)],
  ["GET", "/api/img/:size/:file", (env, req, ctx, p) => tmdbImage(env, req, ctx, p.size, p.file)]
].map(([method, path, fn]) => {
  const names = [];
  const re = new RegExp("^" + path.replace(/:([a-z]+)/g, (m, n) => { names.push(n); return "([^/]{1,200})"; }) + "$");
  return {method, re, names, fn};
});

async function api(request, env, ctx, url) {
  let pathMatched = false;
  for (const r of ROUTES) {
    const m = r.re.exec(url.pathname);
    if (!m) continue;
    pathMatched = true;
    if (r.method !== request.method && !(r.method === "GET" && request.method === "HEAD")) continue;
    const params = {};
    try { r.names.forEach((n, i) => { params[n] = decodeURIComponent(m[i + 1]); }); }
    catch (e) { throw new HttpError(400, "bad_path", "Malformed address."); }
    checkOrigin(request, env);
    await ensureSchema(env);
    return r.fn(env, request, ctx, params, url);
  }
  if (pathMatched) throw new HttpError(405, "method_not_allowed", "Method not allowed.");
  throw new HttpError(404, "not_found", "No such endpoint.");
}

/* Plain-text files at well-known paths. security.txt (RFC 9116) says where to report a vulnerability. */
const SECURITY_TXT = `Contact: https://github.com/CyberSecDigestDaily/dread/security/advisories/new
Expires: 2027-10-27T00:00:00.000Z
Preferred-Languages: en
Canonical: https://dreadlist.co.uk/.well-known/security.txt
Policy: https://github.com/CyberSecDigestDaily/dread/security/policy
`;
const ROBOTS_TXT = `User-agent: *
Disallow: /api/
Disallow: /u/
`;
const text = (body, maxAge) => new Response(body, {headers: {"Content-Type": "text/plain; charset=utf-8", "Cache-Control": `public, max-age=${maxAge}`}});

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const canonical = new URL(allowedOrigins(env)[0] || url.origin);
    // HTTPS only on the real domain (HSTS takes over after the first visit).
    if (url.protocol === "http:" && url.hostname.endsWith(canonical.hostname) && canonical.protocol === "https:") {
      return withHeaders(Response.redirect(canonical.origin + url.pathname + url.search, 301), "api");
    }
    // One canonical address: www (and any other alias of the domain) redirects to it, so passkeys, the session cookie
    // and browser storage all live on a single origin.
    if (url.hostname !== canonical.hostname && url.hostname.endsWith("." + canonical.hostname)) {
      return withHeaders(Response.redirect(canonical.origin + url.pathname + url.search, 301), "api");
    }
    if (url.pathname === "/.well-known/security.txt") return withHeaders(text(SECURITY_TXT, 86400), "api");
    if (url.pathname === "/robots.txt") return withHeaders(text(ROBOTS_TXT, 86400), "api");
    if (url.pathname.startsWith("/api/")) {
      let res;
      try { res = await api(request, env, ctx, url); } catch (e) { res = errorResponse(e); }
      return withHeaders(res, "api");
    }
    // Profile pages are the app itself; the page reads the name from the path.
    if (/^\/u\/[A-Za-z0-9_-]{1,40}\/?$/.test(url.pathname)) {
      const res = await env.ASSETS.fetch(new Request(new URL("/", url), {method: "GET", headers: request.headers}));
      return withHeaders(res, "page");
    }
    const res = await env.ASSETS.fetch(request);
    return (res.headers.get("Content-Type") || "").startsWith("text/html") ? withHeaders(res, "page") : res;
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(cleanup(env));
  }
};
