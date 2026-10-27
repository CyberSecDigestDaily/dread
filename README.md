# The Dread List

Live site: https://dreadlist.co.uk/

A horror recommender for the UK. About 1,200 horror films, each with where it streams on your services tonight (with deep links), what's new this fortnight, what's leaving, the cheapest rental, IMDb and Rotten Tomatoes scores, its original language and a gore level. Every Want, Pass and 1–10 score retrains the ranking in the browser. Filter by any streaming service, by director, or to English-language films only; search finds films you've already seen too, and every film, rated or not, opens to its synopsis.

Anyone can use it straight away: their list is kept in their browser. With an account (a passkey: no email, no password) the list follows them to every device, they can make **shared lists** that rank films for everyone on them, and they can switch on a **public page** at `dreadlist.co.uk/u/<name>`.

## How it works

| Layer | What | When |
|---|---|---|
| Hand-picked list | `films.json`: curated picks with tags, gore level, content flags and a one-line pitch, plus `rated`, the original single-user page's profile ratings (offered as an import to the browsers that used that page; they no longer apply to everyone) | By hand, and by the weekly curator task |
| Pool | `refresh.py` pulls JustWatch UK's popular, trending and newly added horror (overall, on the default services, free and on Shudder) plus JustWatch's similar titles around every hand-picked and profile-rated film and every film people chose to share (Settings → Help grow the pool, read from `/api/hints`), keeps the ones above a quality bar, and writes `docs/data.json` with offers, deep links, leaving dates, prices, scores, Wikidata subgenres, the original language, synopsis-keyword tags, an estimated gore level and poster thumbnails. Films stay for 120 days after they were last discovered. No API keys | GitHub Actions, daily around 06:23 UK, and on every change to the list, script, page or Worker |
| Recommender | `docs/app.js`: each film is a bag of weighted features (tags, director, decade, region, subtitled or not, gore, flags, length). Your affinity for each feature is the shrunk mean of your signals: a score out of 10 runs from −2.5 (1, Hated) through −0.5 (5, Meh) and +1 (7, Liked) to +2.5 (10, Favourite); Want is +0.6 and Pass −1. Score = feature fit + a boost from JustWatch's similar-titles graph + a small critics term. Every seventh slot is a wildcard. A compact copy of each film you rate travels with the rating, so it keeps counting after the film leaves the pool | In the browser, instantly |
| Accounts and sync | `worker/` (Cloudflare Worker) + D1 (EU jurisdiction). Passkeys only (WebAuthn, ES256/Ed25519/RS256, user verification required), ten one-time recovery codes, and ten-minute device codes (with a QR) to sign in a new device from a signed-in one. Lists sync film by film, newest change wins, with a per-account revision so devices fetch only what changed. `docs/account.js` is the browser side | On every change, when you come back to the tab, and every two minutes |
| Together | `docs/together.js` + `worker/lists.js`: shared lists with an invite link. Each member's taste model is learned the same way as yours from what they share with the list; a film's group score blends the average with the least keen member, and picks skip anything any member has seen, passed or hides | When you open a list |
| Profiles | `/u/<name>` serves the app, which reads `/api/u/<name>`: ratings and watchlist (never passes or dates), only if the owner switched it on. Visitors see their agreement with you and can add anything to their own list | On demand |
| Deploy | The workflow publishes the Worker, `wrangler.jsonc` and the page (with fonts and posters) to the `deploy` branch; Cloudflare Workers Builds deploys that branch. The custom domains (`dreadlist.co.uk`, and `www`, which the Worker redirects) are set on the Worker in the Cloudflare dashboard; `workers.dev` is off. No deploy tokens or secrets anywhere | After every refresh |
| Curator | A Claude scheduled task every Sunday at 09:43 adds 6–10 researched picks to `films.json` | Weekly |

## Common edits

- **Add a film:** append to `films` in `films.json` with `id`, `t`, `y`, `g` (`L`, `M`, `H`, `X`, or `U`), `tg` (tags), optional `fl` (flags), `w` (pitch), `p: true` for a start-here pick, `aka`, `q` (a different JustWatch search term), or `lg` to override the detected language (`en`, or an ISO code such as `ko`).
- **Profile ratings:** `rated` in `films.json` takes `s` (1–10) plus the matching `r` tier. Discovered films with a wrong language go in `LANG_FIX` in `refresh.py`, keyed by IMDb id. The tag and flag vocabularies are listed in the file's `note`. Saving republishes within about ten minutes.
- **Force a refresh and redeploy:** Actions → Dread list refresh → Run workflow.
- **Look at or fix data:** Cloudflare dashboard → D1 → `dread` → Console. Tables: `users`, `credentials`, `sessions`, `recovery_codes`, `entries`, `lists`, `list_members`, `list_items`, plus short-lived `challenges`, `link_codes` and `rl` (rate limits), tidied nightly by the Worker's cron trigger.
- **Schema changes:** append statements to `SCHEMA` in `worker/db.js` and bump `SCHEMA_VERSION`; the Worker applies them on first use.

## Running it locally

```sh
npx wrangler dev --var ORIGIN:http://localhost:8787 --var RP_ID:localhost   # local D1, passkeys work on localhost
node tests/api.test.mjs                 # 100+ API checks with software passkeys making real signatures
python tests/e2e.py http://localhost:8787 /tmp/shots   # Chromium with a virtual passkey: guest → sign-up → import → sync → shared list → profile
```

## Privacy and security

- **Accounts hold the minimum:** a chosen name, passkey public keys, the list and settings, sessions (a coarse "Firefox on Windows" label and timestamps), and hashed recovery codes. No email, real name, password or IP address. Everything lives in a D1 database restricted to the EU. People can download or delete everything from Settings. See `docs/privacy.html`.
- **Sign-in:** WebAuthn passkeys verified on Web Crypto (`worker/webauthn.js`): single-use five-minute challenges, origin and RP ID checks, user verification required, signature counters checked. Recovery and device codes are random, single-use and stored as SHA-256 hashes; device codes expire after ten minutes. Deleting the account, removing passkeys, making new recovery codes or issuing a device code needs a passkey sign-in within the last 15 minutes.
- **Sessions:** a 256-bit random token in a `__Host-` cookie (`Secure; HttpOnly; SameSite=Strict`); the database stores only its hash. 30 days sliding, 180 days at most. Any session can be signed out from Settings.
- **Requests:** state-changing calls must carry our own `Origin` and a JSON body (no CORS is offered), on top of the strict cookie. All input is reduced to known keys, types and sizes; film data that other people will see is re-validated, and links are only ever built on known hosts. D1 queries are parameterised. Sign-up, sign-in, recovery and device codes are rate limited against a keyed hash of the IP.
- **Headers:** a strict Content Security Policy (own files only, plus `api.github.com` for the one-off import from the old encrypted sync), HSTS, `frame-ancestors 'none'`, `nosniff`, `no-referrer`, COOP/COEP/CORP (cross-origin isolated) and a locked-down Permissions-Policy, on static files (`docs/_headers`) and Worker responses alike. HTTP and `www` redirect to `https://dreadlist.co.uk`.
- **Domain:** DNSSEC on; SPF `-all`, an empty DKIM key and DMARC `p=reject` so nobody can send mail as @dreadlist.co.uk; `/.well-known/security.txt` and `SECURITY.md` for reporting issues; `robots.txt` keeps crawlers off the API and profiles.
- **Sessions:** at most 30 signed-in browsers per account; the least recently used are signed out first.
- **Sharing is opt-in:** public pages and "Help grow the pool" are off by default; joining a shared list shares your ratings, watchlist and passes with its members only.
- **No third parties:** no analytics, ads, trackers, third-party scripts or fonts. Posters, fonts and the QR encoder (`docs/vendor/qrcode.js`, MIT, Kazuhiko Arase) are self-hosted. The Worker has no dependencies and no secrets.
- **The old encrypted sync** (`dread-sync`, PBKDF2-SHA256 + AES-256-GCM) is read-only now: browsers that used it bring their list into an account once (Settings → Your data). After that, the "Dread List sync" GitHub token can be revoked and `dread-sync` archived.
