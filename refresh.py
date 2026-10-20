#!/usr/bin/env python3
"""Refresh UK availability, prices and ratings for every film in films.json.

Reads films.json (the curated list) and the current docs/data.json, looks each
film up on JustWatch UK, and writes docs/data.json. Python standard library only.

A film that can't be looked up keeps its last known availability, so a bad run
never empties the page.
"""
import datetime
import json
import pathlib
import re
import sys
import time
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent
FILMS = ROOT / "films.json"
DATA = ROOT / "docs" / "data.json"
API = "https://apis.justwatch.com/graphql"
BATCH = 12

FRAGMENT = (
    'fragment F on MovieOrShow { content(country: GB, language: "en") { title originalReleaseYear fullPath '
    "scoring { imdbScore tomatoMeter } } "
    'offers(country: GB, platform: WEB) { monetizationType retailPrice(language: "en") package { clearName } } }'
)

# Subscription services shown by name and used by the page's filters.
SUBS = [
    (r"prime video", "Prime Video"),
    (r"^shudder", "Shudder"),
    (r"^netflix", "Netflix"),
    (r"disney", "Disney+"),
    (r"^(now|sky go)", "NOW"),
    (r"hbo max|^max$", "HBO Max"),
    (r"paramount", "Paramount+"),
    (r"^apple tv( plus|\+)?$", "Apple TV+"),
    (r"^mubi", "MUBI"),
]
# Free (ad-supported or licence-fee) services. Checked first, whatever JustWatch calls the offer.
FREE = [
    (r"^tubi", "Tubi"),
    (r"^plex", "Plex"),
    (r"^pluto", "Pluto TV"),
    (r"channel 4|all 4", "Channel 4"),
    (r"bbc iplayer", "BBC iPlayer"),
    (r"^itv", "ITVX"),
    (r"^rakuten", "Rakuten TV"),
    (r"^youtube", "YouTube"),
]
# Paid add-on channels (mostly Prime Video channels), shown as extras.
CHANNELS = {
    "studiocanal presents": "Studiocanal Presents",
    "lionsgate+": "Lionsgate+",
    "sony pictures core": "Sony Pictures Core",
    "arrow": "Arrow",
    "arrow video": "Arrow",
    "icon film": "Icon Film",
    "amc+": "AMC+",
    "screambox": "Screambox",
}


def norm_title(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def match(patterns, name):
    low = name.lower()
    for pattern, label in patterns:
        if re.search(pattern, low):
            return label
    return None


def channel_name(name):
    base = re.sub(r"\s+(amazon channel|apple tv channel)$", "", name, flags=re.I).strip().lower()
    return CHANNELS.get(base)


def query(batch):
    parts = []
    for i, film in enumerate(batch):
        search = json.dumps(film.get("q") or film["t"])
        parts.append(
            f"t{i}: popularTitles(country: GB, first: 8, filter: {{searchQuery: {search}}}) "
            "{ edges { node { ...F } } }"
        )
    body = json.dumps({"query": "query { " + " ".join(parts) + " } " + FRAGMENT}).encode()
    req = urllib.request.Request(
        API,
        data=body,
        headers={
            "content-type": "application/json",
            "accept": "application/json",
            "user-agent": "Mozilla/5.0 (X11; Linux x86_64) dread-list-refresh/1.0",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        payload = json.load(resp)
    if payload.get("errors") and not payload.get("data"):
        raise RuntimeError(json.dumps(payload["errors"])[:300])
    return payload.get("data") or {}


def pick(film, nodes):
    nodes = [n for n in nodes if n and n.get("content")]
    near = [n for n in nodes if abs((n["content"].get("originalReleaseYear") or 0) - film["y"]) <= 1]
    wanted = norm_title(film["t"])
    for n in near:
        if norm_title(n["content"]["title"]) == wanted:
            return n
    return near[0] if near else None


def cheapest(offers, kind):
    best = None
    for offer in offers:
        if offer.get("monetizationType") != kind or not offer.get("retailPrice"):
            continue
        try:
            value = float(re.sub(r"[^0-9.]", "", offer["retailPrice"]))
        except ValueError:
            continue
        if value > 0 and (best is None or value < best):
            best = value
    return f"£{best:.2f}" if best is not None else None


def availability(node):
    subs, free, channels = [], [], []
    offers = node.get("offers") or []
    for offer in offers:
        name = (offer.get("package") or {}).get("clearName") or ""
        kind = offer.get("monetizationType")
        if kind not in ("FLATRATE", "FREE", "ADS"):
            continue
        label = match(FREE, name)
        if label:
            if label not in free:
                free.append(label)
            continue
        label = match(SUBS, name)
        if label:
            if label not in subs:
                subs.append(label)
            continue
        if kind == "FLATRATE":
            label = channel_name(name)
            if label and label not in channels:
                channels.append(label)
    content = node["content"]
    scoring = content.get("scoring") or {}
    return {
        "subs": subs,
        "free": free,
        "channels": channels,
        "rent": cheapest(offers, "RENT"),
        "buy": cheapest(offers, "BUY"),
        "imdb": scoring.get("imdbScore"),
        "rt": scoring.get("tomatoMeter"),
        "jw": content.get("fullPath"),
    }


def main():
    curated = json.loads(FILMS.read_text(encoding="utf-8"))["films"]
    try:
        old = {f["id"]: f for f in json.loads(DATA.read_text(encoding="utf-8"))["films"]}
    except (FileNotFoundError, KeyError, json.JSONDecodeError):
        old = {}

    found = {}
    for start in range(0, len(curated), BATCH):
        batch = curated[start:start + BATCH]
        try:
            data = query(batch)
        except (urllib.error.URLError, RuntimeError, TimeoutError, json.JSONDecodeError) as exc:
            print(f"Lookup failed for batch starting at {start}: {exc}", file=sys.stderr)
            continue
        for i, film in enumerate(batch):
            edges = ((data.get(f"t{i}") or {}).get("edges")) or []
            node = pick(film, [e.get("node") for e in edges])
            if node:
                found[film["id"]] = availability(node)
            else:
                print(f"No JustWatch match for {film['t']} ({film['y']})", file=sys.stderr)
        time.sleep(1.5)

    out = []
    for film in curated:
        prev = old.get(film["id"], {})
        live = found.get(film["id"])
        record = {
            "id": film["id"], "t": film["t"], "y": film["y"], "v": film["v"], "g": film["g"],
            "p": bool(film.get("p")), "w": film["w"], "aka": film.get("aka"),
        }
        if live:
            record.update({
                "imdb": live["imdb"] if live["imdb"] is not None else prev.get("imdb"),
                "rt": live["rt"] if live["rt"] is not None else prev.get("rt", film.get("rt")),
                "subs": live["subs"], "free": live["free"], "channels": live["channels"],
                "rent": live["rent"], "buy": live["buy"],
                "jw": live["jw"] or prev.get("jw"),
            })
        else:
            record.update({
                "imdb": prev.get("imdb"), "rt": prev.get("rt", film.get("rt")),
                "subs": prev.get("subs", []), "free": prev.get("free", []), "channels": prev.get("channels", []),
                "rent": prev.get("rent"), "buy": prev.get("buy"), "jw": prev.get("jw"),
            })
        if isinstance(record["imdb"], (int, float)):
            record["imdb"] = round(float(record["imdb"]), 1)
        out.append(record)

    if not found:
        print("No lookups succeeded; keeping the existing data.json.", file=sys.stderr)
        return 0

    checked = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    lines = ",\n".join("    " + json.dumps(r, ensure_ascii=False, separators=(",", ":")) for r in out)
    DATA.write_text(
        '{\n  "checked": "' + checked + '",\n  "source": "JustWatch UK",\n  "films": [\n' + lines + "\n  ]\n}\n",
        encoding="utf-8",
    )
    print(f"Updated {len(found)} of {len(curated)} films.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
