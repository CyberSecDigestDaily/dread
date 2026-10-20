# The Dread List

Live page: https://cybersecdigestdaily.github.io/dread/

A personal horror recommender for the UK. About 1,100 horror films, each with where it streams on your services tonight (with deep links), what's new this fortnight, what's leaving, the cheapest rental, IMDb and Rotten Tomatoes scores and a gore level. Every Want, Pass and rating retrains the ranking in the browser.

## How it works

| Layer | What | When |
|---|---|---|
| Hand-picked list | `films.json`: curated picks with tags, gore level, content flags and a one-line pitch, plus `rated`, the films already rated from what you've told Claude | By hand, and by the weekly curator task |
| Pool | `refresh.py` pulls JustWatch UK's popular, trending and newly added horror (overall, on your services, free and on Shudder) plus JustWatch's similar titles around every hand-picked and rated film, keeps the ones above a quality bar, and writes `docs/data.json` with offers, deep links, leaving dates, prices, scores, Wikidata subgenres, synopsis-keyword tags, an estimated gore level and poster thumbnails. No API keys | GitHub Actions, daily around 06:23 UK, and on every change to the list, script or page |
| Recommender | `docs/app.js`: each film is a bag of weighted features (tags, director, decade, country, gore, flags, length). Your affinity for each feature is the shrunk mean of your signals (Loved +2, Liked +1, Meh −0.5, Disliked −2, Want +0.6, Pass −1). Score = feature fit + a boost from JustWatch's similar-titles graph + a small critics term. Every seventh slot is a wildcard to keep learning | In the browser, instantly |
| Your ratings | Saved in the browser and optionally synced to `dread-list.json` in a private repo through the GitHub API (one tap if the Money Plan token is already in this browser) | When you press a button |

## Common edits

- **Add a film:** append to `films` in `films.json` with `id`, `t`, `y`, `g` (`L`, `M`, `H`, `X`, or `U`), `tg` (tags), optional `fl` (flags), `w` (pitch), `p: true` for a start-here pick, `aka`, or `q` (a different JustWatch search term). The tag and flag vocabularies are listed in the file's `note`. Saving republishes within about five minutes.
- **Change which services count as yours:** Settings on the page (synced across devices).
- **Force a refresh:** Actions → Dread list refresh → Run workflow.

## Privacy and security

- This repo holds no personal data beyond the film ratings in `films.json` → `rated`, taken from conversations with Claude. Delete that block to remove them.
- Ratings, wants, passes and settings live in the viewer's browser and, if sync is on, in a private repo. The token stays in local storage on that device and is only ever sent to `api.github.com`.
- A Content Security Policy limits the page to its own files and `api.github.com`. Posters and fonts are self-hosted. No third-party scripts, fonts or trackers. The page is set to `noindex`.
