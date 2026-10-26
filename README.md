# The Dread List

Live page: https://cybersecdigestdaily.github.io/dread/

A personal horror recommender for the UK. About 1,200 horror films, each with where it streams on your services tonight (with deep links), what's new this fortnight, what's leaving, the cheapest rental, IMDb and Rotten Tomatoes scores, its original language and a gore level. Every Want, Pass and 1–10 score retrains the ranking in the browser. Filter by any streaming service, by director, or to English-language films only; search finds films you've already seen too, and every film, rated or not, opens to its synopsis.

## How it works

| Layer | What | When |
|---|---|---|
| Hand-picked list | `films.json`: curated picks with tags, gore level, content flags and a one-line pitch, plus `rated`, the films already rated from what you've told Claude | By hand, and by the weekly curator task |
| Pool | `refresh.py` pulls JustWatch UK's popular, trending and newly added horror (overall, on your services, free and on Shudder) plus JustWatch's similar titles around every hand-picked, rated and (if you share a taste summary) liked or wanted film, keeps the ones above a quality bar, and writes `docs/data.json` with offers, deep links, leaving dates, prices, scores, Wikidata subgenres, the original language (Wikidata, with JustWatch's original title and the production countries as tie-breakers; `lg` is set only for films not in English), synopsis-keyword tags, an estimated gore level and poster thumbnails. Films stay for 120 days after they were last discovered, and films you've rated stay for good. No API keys | GitHub Actions, daily around 06:23 UK, and on every change to the list, script or page |
| Recommender | `docs/app.js`: each film is a bag of weighted features (tags, director, decade, region, subtitled or not, gore, flags, length). Your affinity for each feature is the shrunk mean of your signals: a score out of 10 runs from −2.5 (1, Hated) through −0.5 (5, Meh) and +1 (7, Liked) to +2.5 (10, Favourite); Want is +0.6 and Pass −1. Each rating also keeps its four-step tier (`r`: loved 9–10, liked 7–8, meh 5–6, disliked 1–4) for the taste summary and older readers. Score = feature fit + a boost from JustWatch's similar-titles graph + a small critics term. Every seventh slot is a wildcard to keep learning. A compact copy of each film you rate travels with the rating, so it keeps counting after the film leaves the pool | In the browser, instantly |
| Sync | End-to-end encrypted in the public repo `CyberSecDigestDaily/dread-sync`: `vault.json` is the sync token encrypted with a key derived from your passphrase (PBKDF2-SHA256, 600,000 rounds, AES-256-GCM), `state.json` is your ratings and settings encrypted with the same key. Any browser unlocks with the passphrase, or with a pairing link/QR from a synced browser. The token is scoped to dread-sync only | When you press a button, and when you come back to the tab |
| Curator | A Claude scheduled task every Sunday at 09:43 adds 6–10 researched picks to `films.json` | Weekly |

## Common edits

- **Add a film:** append to `films` in `films.json` with `id`, `t`, `y`, `g` (`L`, `M`, `H`, `X`, or `U`), `tg` (tags), optional `fl` (flags), `w` (pitch), `p: true` for a start-here pick, `aka`, `q` (a different JustWatch search term), or `lg` to override the detected language (`en`, or an ISO code such as `ko`).
- **Profile ratings:** `rated` in `films.json` takes `s` (1–10) plus the matching `r` tier. Discovered films with a wrong language go in `LANG_FIX` in `refresh.py`, keyed by IMDb id. The tag and flag vocabularies are listed in the file's `note`. Saving republishes within about five minutes.
- **Change which services count as yours:** Settings on the page (synced across devices).
- **Force a refresh:** Actions → Dread list refresh → Run workflow.

## Privacy and security

- This repo holds no personal data beyond the film ratings in `films.json` → `rated`, taken from conversations with Claude. Delete that block to remove them.
- Ratings, wants, passes and settings live in the viewer's browser and, if sync is on, encrypted in `dread-sync`. GitHub only ever stores ciphertext. The one opt-in exception is a taste summary (film ids you loved, liked, wanted or passed, no dates) that lets the nightly rebuild and the curator tailor new films; it's off by default.
- The sync token can only touch `dread-sync`, never this repo or the site's code. It lives in the browser's local storage (or session storage if you untick "Remember") and is only ever sent to `api.github.com`.
- A Content Security Policy limits the page to its own files and `api.github.com`. Posters, fonts and the QR encoder (`docs/vendor/qrcode.js`, MIT, Kazuhiko Arase) are self-hosted. No third-party scripts, fonts or trackers. The page is set to `noindex`.
