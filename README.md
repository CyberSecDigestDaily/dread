# The Dread List

Live page: https://cybersecdigestdaily.github.io/dread/

A horror watch list: 55 films grouped by the films they're closest to, with where each one streams in the UK, the cheapest rental, IMDb and Rotten Tomatoes scores, a gore rating, and a "cheapest route" that stacks services in order of value.

## How it works

| Layer | What | When |
|---|---|---|
| List | `films.json`: titles, years, vibe, gore level, "start here" picks and the one-line pitch | Edited by hand |
| Refresh | `refresh.py` looks every film up on JustWatch UK (subscriptions, free services, paid channels, cheapest rent/buy, IMDb, Rotten Tomatoes) and writes `docs/data.json`. A film that can't be looked up keeps its last known data | GitHub Actions, daily around 06:23 UK, and on every change to the list, script or page |
| Page | `docs/index.html`, `docs/app.js`, `docs/style.css`, published to the `gh-pages` branch by the Action with self-hosted fonts | Always |
| Seen ticks and scores | Saved in the browser, and optionally synced across devices to a JSON file in a private repo through the GitHub API, using a fine-grained token entered once per device | When you tick or score a film |

## Common edits

- **Add or remove a film:** edit `films.json`. Give it an `id`, `t` (title), `y` (year), `v` (`ff`, `lim`, `cre`, `folk`, `claus` or `old`), `g` (`L`, `M`, `H`, or `U` for unrated), `w` (one-line pitch), and optionally `p: true` for a "start here" pick, `aka`, or `q` (a different JustWatch search term). Saving re-runs the refresh and republishes within a couple of minutes.
- **Force a refresh:** Actions → Dread list refresh → Run workflow.

## Privacy and security

- This repo holds no personal data. Ticks and scores live in the viewer's browser and, if sync is turned on, in a private repo.
- The token is kept in the browser's local storage on that device only and is sent nowhere except `api.github.com`.
- A Content Security Policy limits the page to its own files and `api.github.com`. No third-party scripts, fonts or trackers. The page is set to `noindex`.
