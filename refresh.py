#!/usr/bin/env python3
"""Build docs/data.json for the Dread List.

The pool is the curated picks and profile ratings in films.json, plus JustWatch UK's popular,
trending and newly added horror films (overall, on Don's services, on free services and on
Shudder), plus JustWatch's "similar titles" around every curated and rated film.

Every film gets UK streaming offers with deep links and leaving dates, the cheapest rental and
purchase, IMDb and Rotten Tomatoes scores, subgenre tags (curated, Wikidata and synopsis
keywords), an estimated gore level and a self-hosted poster thumbnail.

Python standard library only. Nothing here needs an API key. If JustWatch can't be reached the
existing data.json is kept, and a film that can't be looked up keeps its last known data.
"""
import concurrent.futures as cf
import datetime as dt
import json
import pathlib
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent
FILMS = ROOT / "films.json"
DATA = ROOT / "docs" / "data.json"
POSTERS = ROOT / "docs" / "p"
API = "https://apis.justwatch.com/graphql"
WIKIDATA = "https://query.wikidata.org/sparql"
UA = "Mozilla/5.0 (X11; Linux x86_64) dread-list/2.0 (+https://github.com/CyberSecDigestDaily/dread)"
TODAY = dt.date.today()
NEW_DAYS = 14

CONTENT = """content(country: GB, language: "en") { title originalReleaseYear fullPath shortDescription runtime
  ageCertification posterUrl productionCountries genres { shortName } credits(role: DIRECTOR) { name }
  externalIds { imdbId } scoring { imdbScore imdbVotes tomatoMeter tmdbPopularity } }
offers(country: GB, platform: WEB, filter: { bestOnly: true }) { monetizationType retailPriceValue currency
  standardWebURL availableToTime package { shortName clearName } }"""
FIELDS = "id objectType ... on MovieOrShow { " + CONTENT + " }"

# Discovery: (label, extra filter, sort, pages of 100)
MINE = ["nfx", "nfa", "amp", "dnp", "mxx", "aho", "cru", "ntv"]
FREE_PKGS = ["tbv", "al4", "bbc", "itv", "ptv", "plx", "yfr"]
SETS = [
    ("popular", {}, "POPULAR", 7),
    ("trending", {}, "TRENDING", 2),
    ("yours", {"packages": MINE}, "POPULAR", 5),
    ("free", {"packages": FREE_PKGS}, "POPULAR", 2),
    ("shudder", {"packages": ["shd", "asd"]}, "POPULAR", 2),
]

# Streaming services by JustWatch name. First match wins; None means ignore.
SERVICES = [
    (r"^netflix", "nf"), (r"^amazon prime video", "pv"), (r"^disney", "dp"), (r"^crunchyroll", "cr"),
    (r"^hbo max", "hbo"), (r"^now tv cinema", "nowc"), (r"^now( tv)?$", "nowe"), (r"^sky go", None),
    (r"^shudder", "sh"), (r"^paramount", "pp"), (r"^apple tv( plus|\+)?$", "atv"), (r"^mubi", "mubi"),
    (r"^bfi player", "bfi"),
    (r"^tubi", "tubi"), (r"^channel 4$", "c4"), (r"^bbc iplayer", "bbc"), (r"^itvx$", "itvx"),
    (r"^pluto", "pluto"), (r"^plex$", "plex"), (r"^youtube free", "ytf"), (r"^rakuten", "rakuten"),
    (r"^amazon mx player", "mx"), (r"^(5|my5|channel 5)$", "my5"), (r"^justwatch", None),
]
FREE_KEYS = {"tubi", "c4", "bbc", "itvx", "pluto", "plex", "ytf", "rakuten", "mx", "my5"}
STORES = [(r"^amazon", "Amazon"), (r"^apple", "Apple TV"), (r"^sky store", "Sky Store"), (r"^rakuten", "Rakuten"),
          (r"^google", "Google Play"), (r"^microsoft", "Microsoft"), (r"^youtube", "YouTube"), (r"^chili", "Chili")]

# Tag rules. Keys starting "f:" are content flags; "_splatter" only feeds the gore estimate.
WD_RULES = [
    (r"found footage|mockumentary|screenlife", "found-footage"), (r"body horror", "body-horror"),
    (r"monster|creature|kaiju|natural horror|giant animal", "creature"), (r"zombie|infection|epidemic|pandemic", "outbreak"),
    (r"supernatural|ghost|haunted house", "ghost"), (r"possession|exorcism", "possession"),
    (r"folk horror|folklore|paganism", "folk"), (r"lovecraft|cosmic horror", "cosmic"),
    (r"science fiction", "sci-fi"), (r"slasher", "slasher"), (r"splatter|exploitation|torture", "_splatter"),
    (r"psychological", "psychological"), (r"survival", "survival"), (r"comedy", "comedy"),
    (r"anthology", "anthology"), (r"vampire", "vampire"), (r"witch", "witch"), (r"\bcult\b", "cult"),
    (r"home invasion", "home-invasion"), (r"outer space|spacecraft|astronaut|space station", "space"),
    (r"period|historical", "period"), (r"occult|satanism|demon", "occult"), (r"christianity|catholic|religio", "religious"),
    (r"spider|arachnid", "f:spiders"), (r"snake|serpent", "f:snakes"),
]
TXT_RULES = [
    (r"found footage|documentar|camcorder|live ?stream|webcam|vlog|footage|film crew|camera crew|tv crew|news crew|youtuber|ghost hunt|mockumentary", "found-footage"),
    (r"time loop|\bloop|alternate (reality|dimension|version)|parallel (world|universe|dimension|reality)|another dimension|labyrinth|\bmaze|endless|impossible|liminal|backrooms|reality (itself|begins|starts|shifts)", "liminal"),
    (r"\bcave|tunnel|bunker|basement|cellar|trapped (in|inside)|confined|elevator|submarine|buried alive|locked (in|inside)|catacomb|\bmine\b|crawl ?space", "claustrophobic"),
    (r"remote|isolated|\bisland|arctic|antarctic|\bcabin\b|research station|outpost|lighthouse|snowed in|wilderness|middle of nowhere", "isolation"),
    (r"creature|monster|\bbeast|\balien|predator|\bshark|mutant|werewolf|kaiju|cryptid|bigfoot|\btroll", "creature"),
    (r"parasite|mutat|metamorph|\bflesh|body horror|transform(s|ed|ation)? (into|him|her|them)|\bfus(e|es|ing|ion)\b", "body-horror"),
    (r"shape[- ]?shift|imposter|impostor|who to trust|paranoi|not who (they|he|she)", "paranoia"),
    (r"zombie|\binfected|outbreak|\bvirus|epidemic|\bplague|pandemic|undead|contagion", "outbreak"),
    (r"haunt|\bghost|\bspirits?\b|poltergeist|s[eé]ance|apparition|spectre|specter|medium\b", "ghost"),
    (r"possess|\bdemon|exorcis|the devil|satan|antichrist", "possession"),
    (r"\bvillage|pagan|\bfolk|commune|harvest festival|midsummer", "folk"),
    (r"\bcult\b|cultists|\bsect\b", "cult"),
    (r"\bpriest|\bnun\b|\bnuns\b|church|vatican|convent|missionar|religious|\bfaith\b", "religious"),
    (r"\bwitch|coven", "witch"), (r"vampire|dracula|nosferatu", "vampire"),
    (r"lovecraft|cosmic|eldritch|ancient (evil|entity|being|god)", "cosmic"),
    (r"space station|spaceship|spacecraft|astronaut|cosmonaut|starship|in orbit|\bplanet\b|\bmars\b|outer space", "space"),
    (r"\bocean|at sea\b|\bship\b|\bboat|underwater|deep[- ]sea|trawler|\bsailors?\b|seabed|\bsubmarine", "sea"),
    (r"masked killer|serial killer|slasher|stalked by|psychopath|maniac|killing spree", "slasher"),
    (r"home invasion|break into (their|a|the) home|intruders?\b", "home-invasion"),
    (r"\bgrie(f|ving)|mourning|death of (her|his|their)", "grief"),
    (r"sanity|madness|psycholog|mental (health|illness)|hallucinat", "psychological"),
    (r"\bsurviv|stranded", "survival"), (r"anthology|segments|interwoven stories", "anthology"),
    (r"\bcurse|occult|\britual|satanic|summon", "occult"),
    (r"\b1[0-8]\d\d\b|\b19[0-8]\d\b|\b19[0-8]0s\b|\b(1[5-9])th[- ]century|victorian|medieval|middle ages|civil war|world war", "period"),
    (r"spider|arachnid|tarantula", "f:spiders"), (r"\bsnakes?\b|serpent|anaconda|\bpython\b", "f:snakes"),
]
GENRE_TAGS = {"scf": "sci-fi", "cmy": "comedy", "act": "action", "hst": "period", "wsn": "period", "war": "period", "ani": "animated"}
VIOLENT = re.compile(r"tortur|sadis|gruesome|\bgor(e|y)\b|mutilat|dismember|massacre|slaughter|butcher|bloodbath|brutal|cannibal|carnage|depraved|blood[- ]?soaked|savage|bloodthirsty|kill(s|ing)? (them|everyone)")
QUIET = {"ghost", "possession", "occult", "psychological", "mystery", "liminal", "grief", "religious", "witch"}
LOUD = {"slasher", "creature", "outbreak", "body-horror", "home-invasion", "survival"}


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def norm(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower().replace("&", "and"))


def chunks(seq, n):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


def gql(query, variables=None, tries=3):
    body = json.dumps({"query": query, "variables": variables or {}}).encode()
    for attempt in range(tries):
        try:
            req = urllib.request.Request(API, data=body, headers={
                "content-type": "application/json", "accept": "application/json", "user-agent": UA})
            with urllib.request.urlopen(req, timeout=90) as resp:
                payload = json.load(resp)
            if payload.get("errors") and not payload.get("data"):
                raise RuntimeError(json.dumps(payload["errors"])[:300])
            return payload.get("data") or {}
        except (urllib.error.URLError, TimeoutError, RuntimeError, json.JSONDecodeError, ConnectionError) as exc:
            log(f"  JustWatch attempt {attempt + 1} failed: {exc}")
            time.sleep(3 * (attempt + 1))
    return None


# ---------- JustWatch fetchers ----------

def discover(extra, sort, pages):
    nodes, after = [], None
    flt = {"genres": ["hrr"], "objectTypes": ["MOVIE"], **extra}
    q = ("query($after: String, $filter: TitleFilter) { popularTitles(country: GB, first: 100, after: $after, "
         f"sortBy: {sort}, filter: $filter) {{ pageInfo {{ endCursor hasNextPage }} edges {{ node {{ {FIELDS} }} }} }} }}")
    for _ in range(pages):
        data = gql(q, {"after": after, "filter": flt})
        if not data:
            break
        page = data["popularTitles"]
        nodes += [e["node"] for e in page["edges"] if e.get("node")]
        if not page["pageInfo"]["hasNextPage"]:
            break
        after = page["pageInfo"]["endCursor"]
        time.sleep(0.6)
    return nodes


def by_ids(ids):
    out = {}
    for batch in chunks(list(ids), 30):
        q = "query { " + " ".join(f't{i}: node(id: {json.dumps(j)}) {{ {FIELDS} }}' for i, j in enumerate(batch)) + " }"
        data = gql(q) or {}
        for i, j in enumerate(batch):
            node = data.get(f"t{i}")
            if node and node.get("content"):
                out[j] = node
        time.sleep(0.6)
    return out


def search(films):
    """Find JustWatch nodes for {t, y, q?} records by title search."""
    found = {}
    for batch in chunks(films, 10):
        parts = [f't{i}: popularTitles(country: GB, first: 8, filter: {{searchQuery: {json.dumps(f.get("q") or f["t"])}}}) '
                 f'{{ edges {{ node {{ {FIELDS} }} }} }}' for i, f in enumerate(batch)]
        data = gql("query { " + " ".join(parts) + " }") or {}
        for i, f in enumerate(batch):
            nodes = [e["node"] for e in ((data.get(f"t{i}") or {}).get("edges") or []) if e.get("node")]
            node = pick(f, nodes)
            if node:
                found[f["key"]] = node
            else:
                log(f"  No JustWatch match for {f['t']} ({f['y']})")
        time.sleep(0.8)
    return found


def pick(film, nodes):
    nodes = [n for n in nodes if n.get("content") and n.get("objectType", "MOVIE") == "MOVIE"]
    near = [n for n in nodes if abs((n["content"].get("originalReleaseYear") or 0) - film["y"]) <= 1]
    want = {norm(film["t"]), norm(film.get("q")), norm(film.get("aka"))} - {""}
    for n in near:
        if norm(n["content"]["title"]) in want:
            return n
    return near[0] if near else None


def similar(ids, full):
    """JustWatch similar titles. full=True also returns the neighbours' details (for pool expansion)."""
    inner = FIELDS if full else "id objectType"
    edges, extra = {}, {}
    for batch in chunks(list(ids), 8 if full else 30):
        q = "query { " + " ".join(
            f't{i}: node(id: {json.dumps(j)}) {{ ... on MovieOrShow {{ similarTitlesV2(country: GB, first: 14) '
            f'{{ edges {{ node {{ {inner} }} }} }} }} }}' for i, j in enumerate(batch)) + " }"
        data = gql(q) or {}
        for i, j in enumerate(batch):
            got = (((data.get(f"t{i}") or {}).get("similarTitlesV2") or {}).get("edges")) or []
            nodes = [e["node"] for e in got if e.get("node") and e["node"].get("objectType") == "MOVIE"]
            edges[j] = [n["id"] for n in nodes]
            if full:
                for n in nodes:
                    if n.get("content"):
                        extra[n["id"]] = n
        time.sleep(0.6)
    return edges, extra


def new_arrivals():
    """Films newly added to a streaming or free service in the last NEW_DAYS days: {jid: (date, node, package)}."""
    out = {}
    q = ("query($date: Date!, $after: String) { newTitles(country: GB, date: $date, first: 100, after: $after, "
         'filter: { objectTypes: [MOVIE], genres: ["hrr"], monetizationTypes: [FLATRATE, FREE, ADS] }) '
         "{ pageInfo { endCursor hasNextPage } edges { node { " + FIELDS + " } newOffer(platform: WEB) { package { clearName } } } } }")
    for back in range(NEW_DAYS):
        day = (TODAY - dt.timedelta(days=back)).isoformat()
        after = None
        for _ in range(3):
            data = gql(q, {"date": day, "after": after})
            if not data:
                break
            page = data["newTitles"]
            for e in page["edges"]:
                node, pkg = e.get("node"), ((e.get("newOffer") or {}).get("package") or {}).get("clearName", "")
                if node and node.get("content") and node["id"] not in out:
                    out[node["id"]] = (day, node, pkg)
            if not page["pageInfo"]["hasNextPage"]:
                break
            after = page["pageInfo"]["endCursor"]
        time.sleep(0.5)
    return out


# ---------- Wikidata ----------

def wikidata(imdb_ids):
    out = {}
    for batch in chunks(sorted(imdb_ids), 120):
        sparql = ('SELECT ?imdb (GROUP_CONCAT(DISTINCT ?gl; separator="|") AS ?g) (GROUP_CONCAT(DISTINCT ?sl; separator="|") AS ?s) WHERE { '
                  "VALUES ?imdb { " + " ".join(json.dumps(i) for i in batch) + " } ?film wdt:P345 ?imdb . "
                  'OPTIONAL { ?film wdt:P136 ?gn . ?gn rdfs:label ?gl FILTER(lang(?gl) = "en") } '
                  'OPTIONAL { ?film wdt:P921 ?sn . ?sn rdfs:label ?sl FILTER(lang(?sl) = "en") } } GROUP BY ?imdb')
        body = urllib.parse.urlencode({"query": sparql, "format": "json"}).encode()
        for attempt in range(2):
            try:
                req = urllib.request.Request(WIKIDATA, data=body, headers={
                    "user-agent": UA, "accept": "application/sparql-results+json",
                    "content-type": "application/x-www-form-urlencoded"})
                with urllib.request.urlopen(req, timeout=90) as resp:
                    rows = json.load(resp)["results"]["bindings"]
                for b in rows:
                    out[b["imdb"]["value"]] = (b.get("g", {}).get("value", "") + "|" + b.get("s", {}).get("value", "")).lower()
                break
            except Exception as exc:  # Wikidata is best-effort enrichment
                log(f"  Wikidata attempt {attempt + 1} failed: {exc}")
                time.sleep(4)
        time.sleep(1)
    return out


# ---------- Shaping ----------

def service_key(name):
    low = name.lower().strip()
    for pattern, key in SERVICES:
        if re.search(pattern, low):
            return key, True
    base = re.sub(r"\s+(amazon|apple tv) channel$", "", name.strip(), flags=re.I).strip()
    if base.isupper() and len(base) > 4:
        base = base.title()
    return "ch:" + base, False


TRACKING = re.compile(r"^(utm_\w+|at|ct|itscg|itsct|ref_?|tag|affiliate\w*|clickref|cmpid|irclickid|irgwc)$", re.I)


def clean_url(url):
    if not url or "?" not in url:
        return url or ""
    parts = urllib.parse.urlsplit(url)
    query = [(k, v) for k, v in urllib.parse.parse_qsl(parts.query, keep_blank_values=True) if not TRACKING.match(k)]
    return urllib.parse.urlunsplit(parts._replace(query=urllib.parse.urlencode(query)))


def store_name(name):
    low = name.lower()
    for pattern, label in STORES:
        if re.search(pattern, low):
            return label
    return name.strip()


def offers(node):
    streams, rent, buy, cinema = {}, None, None, False
    horizon = TODAY + dt.timedelta(days=365)
    for o in node.get("offers") or []:
        kind, pkg = o.get("monetizationType"), (o.get("package") or {}).get("clearName") or ""
        url = clean_url(o.get("standardWebURL"))
        if kind == "CINEMA":
            cinema = True
        elif kind in ("RENT", "BUY"):
            price = o.get("retailPriceValue")
            if not price or o.get("currency") not in (None, "GBP"):
                continue
            cur = rent if kind == "RENT" else buy
            if cur is None or price < cur[0]:
                val = [round(float(price), 2), store_name(pkg)] + ([url] if kind == "RENT" else [])
                if kind == "RENT":
                    rent = val
                else:
                    buy = val
        elif kind in ("FLATRATE", "FREE", "ADS"):
            key, known = service_key(pkg)
            if key is None:
                continue
            if kind != "FLATRATE" and key not in FREE_KEYS and key != "pv":
                key = "free:" + pkg.strip()
            leave = None
            if o.get("availableToTime"):
                try:
                    d = dt.date.fromisoformat(o["availableToTime"][:10])
                    leave = d.isoformat() if TODAY <= d <= horizon else None
                except ValueError:
                    leave = None
            prev = streams.get(key)
            if prev is None:
                streams[key] = [key, url, leave]
            else:
                if not prev[1] and url:
                    prev[1] = url
                if prev[2] and (leave is None or leave > prev[2]):
                    prev[2] = leave
    return list(streams.values()), rent, buy, cinema


def tags_for(node, wd_text, strong):
    c = node["content"]
    text = ((c.get("shortDescription") or "") + " " + (c.get("title") or "")).lower()
    tags, flags, splatter = set(), set(), False
    for pattern, tag in TXT_RULES:
        if re.search(pattern, text):
            (flags.add(tag[2:]) if tag.startswith("f:") else tags.add(tag))
    for pattern, tag in WD_RULES:
        if wd_text and re.search(pattern, wd_text):
            if tag == "_splatter":
                splatter = True
            elif tag.startswith("f:"):
                flags.add(tag[2:])
            else:
                tags.add(tag)
    for g in c.get("genres") or []:
        if g.get("shortName") in GENRE_TAGS:
            tags.add(GENRE_TAGS[g["shortName"]])
    return sorted(tags - set(strong)), sorted(flags), splatter, text


def gore_estimate(cert, tags, text, splatter):
    violent = bool(VIOLENT.search(text))
    if splatter and (cert == "18" or violent):
        return "X" if re.search(r"tortur|sadis|depraved|mutilat", text) or cert == "18" else "H"
    if splatter or ("slasher" in tags and cert == "18") or (cert == "18" and violent):
        return "H"
    if cert in ("U", "PG", "12", "12A"):
        return "L"
    if cert == "15" and not violent and (tags & QUIET) and not (tags & LOUD):
        return "L"
    return "M"


def keep_discovered(c, sets):
    """Quality bar for films that weren't curated or rated."""
    if any(g.get("shortName") == "fml" for g in c.get("genres") or []):
        return False
    if (c.get("runtime") or 90) < 62:
        return False
    s = c.get("scoring") or {}
    im, votes, rt, pop = s.get("imdbScore") or 0, s.get("imdbVotes") or 0, s.get("tomatoMeter"), s.get("tmdbPopularity") or 0
    year = c.get("originalReleaseYear") or 0
    if votes >= 4000 and im >= 5.4:
        return True
    if rt is not None and rt >= 75 and votes >= 800:
        return True
    if year >= TODAY.year - 1 and (im >= 6.0 or (rt or 0) >= 70 or votes >= 1500 or pop >= 12):
        return True
    if "trending" in sets and (im >= 5.6 or not votes):
        return True
    return False


def short(text, limit=300):
    text = re.sub(r"\s+", " ", (text or "")).strip()
    if len(text) <= limit:
        return text or None
    cut = text[:limit].rsplit(" ", 1)[0].rstrip(",;:")
    return cut + "…"


def record(node, *, base=None, wd=None, prev=None):
    c, s = node["content"], node["content"].get("scoring") or {}
    strong = list((base or {}).get("tg") or [])
    auto, flags, splatter, text = tags_for(node, (wd or {}).get(((c.get("externalIds") or {}).get("imdbId")) or "", ""), strong)
    streams, rent, buy, cinema = offers(node)
    cert = (c.get("ageCertification") or "").upper() or None
    g = (base or {}).get("g")
    est = 0
    if not g:
        g, est = gore_estimate(cert, set(strong) | set(auto), text, splatter), 1
    poster = (c.get("posterUrl") or "")
    rec = {
        "id": (base or {}).get("id") or node["id"], "jid": node["id"], "t": (base or {}).get("t") or c.get("title"),
        "y": c.get("originalReleaseYear") or (base or {}).get("y"), "jw": c.get("fullPath"),
        "d": short(c.get("shortDescription")), "rn": c.get("runtime"), "ce": cert,
        "co": (c.get("productionCountries") or [])[:3], "dir": [p["name"] for p in (c.get("credits") or [])][:2],
        "imdb": (c.get("externalIds") or {}).get("imdbId"),
        "im": round(float(s["imdbScore"]), 1) if s.get("imdbScore") else None, "iv": s.get("imdbVotes"),
        "rt": s.get("tomatoMeter"), "pop": round(float(s.get("tmdbPopularity") or 0), 1),
        "tg": strong, "ta": auto, "g": g, "ge": est,
        "fl": sorted(set((base or {}).get("fl") or []) | (set(flags) if not base or not base.get("cur") else set())),
        "o": streams, "rent": rent, "buy": buy, "cin": 1 if cinema else 0,
        "_poster": poster,
    }
    if base:
        for k in ("cur", "p", "w", "aka", "seed"):
            if base.get(k):
                rec[k] = base[k]
    if prev:
        for k in ("im", "rt", "jw", "d"):
            if rec.get(k) is None and prev.get(k) is not None:
                rec[k] = prev[k]
    return {k: v for k, v in rec.items() if v not in (None, [], "", 0) or k in ("o", "tg", "g")}


def fetch_posters(films):
    POSTERS.mkdir(parents=True, exist_ok=True)

    def get(f):
        path = POSTERS / f"{f['jid']}.webp"
        if path.exists() and path.stat().st_size > 500:
            return f["jid"], True
        src = f.get("_poster")
        if not src:
            return f["jid"], False
        url = "https://images.justwatch.com" + src.replace("{profile}", "s166").replace("{format}", "webp")
        try:
            req = urllib.request.Request(url, headers={"user-agent": UA})
            with urllib.request.urlopen(req, timeout=30) as resp:
                blob = resp.read()
            if len(blob) > 500:
                path.write_bytes(blob)
                return f["jid"], True
        except Exception:
            pass
        return f["jid"], False

    with cf.ThreadPoolExecutor(max_workers=8) as pool:
        return {jid for jid, ok in pool.map(get, films) if ok}


# ---------- Main ----------

def main():
    spec = json.loads(FILMS.read_text(encoding="utf-8"))
    curated = [dict(f, cur=1, key=f["id"]) for f in spec.get("films", [])]
    rated = [dict(f, seed=f["r"], key=f"seed:{norm(f['t'])}{f['y']}") for f in spec.get("rated", [])]
    try:
        old = json.loads(DATA.read_text(encoding="utf-8"))
        prev = {f["id"]: f for f in old.get("films", [])}
        prev_by_key = {f.get("_k"): f for f in old.get("films", []) if f.get("_k")}
    except (FileNotFoundError, json.JSONDecodeError, KeyError):
        old, prev, prev_by_key = {}, {}, {}

    # 1. Curated and rated films: by known JustWatch id where we have one, else by title search.
    anchors = curated + rated
    known = {}
    for f in anchors:
        p = prev.get(f["id"]) if f.get("cur") else prev_by_key.get(f["key"])
        if p and p.get("jid"):
            known[f["key"]] = p["jid"]
    log(f"Anchors: {len(anchors)} ({len(known)} with known JustWatch ids)")
    nodes = {}
    got = by_ids(set(known.values()))
    for key, jid in known.items():
        if jid in got:
            nodes[key] = got[jid]
    nodes.update(search([f for f in anchors if f["key"] not in nodes]))
    if not nodes and not old:
        log("JustWatch unreachable and no previous data; nothing to write.")
        return 1
    if not nodes:
        log("JustWatch unreachable; keeping the existing data.json.")
        return 0

    # 2. Discovery sets, new arrivals and neighbours of the anchors.
    pool, sets = {}, {}
    for label, extra, sort, pages in SETS:
        found = discover(extra, sort, pages)
        log(f"Discovery {label}: {len(found)}")
        for n in found:
            pool.setdefault(n["id"], n)
            sets.setdefault(n["id"], set()).add(label)
    arrivals = new_arrivals()
    log(f"New arrivals (last {NEW_DAYS} days): {len(arrivals)}")
    for jid, (_, n, _) in arrivals.items():
        pool.setdefault(jid, n)
        sets.setdefault(jid, set()).add("new")
    anchor_jids = {n["id"] for n in nodes.values()}
    near, extra = similar(sorted(anchor_jids), full=True)
    for jid, n in extra.items():
        if any(g.get("shortName") == "hrr" for g in n["content"].get("genres") or []):
            pool.setdefault(jid, n)
            sets.setdefault(jid, set()).add("similar")

    # 3. Quality bar for discovered films; anchors always stay.
    kept = {jid: n for jid, n in pool.items() if jid not in anchor_jids and keep_discovered(n["content"], sets.get(jid, set()))}
    log(f"Pool: {len(pool)} discovered, {len(kept)} kept after the quality bar")

    # 4. Similar-title edges for the kept pool (ids only).
    more, _ = similar(sorted(set(kept) - set(near)), full=False)
    near.update(more)

    # 5. Wikidata subgenres.
    imdb = {(n["content"].get("externalIds") or {}).get("imdbId") for n in list(kept.values()) + list(nodes.values())} - {None}
    wd = wikidata(imdb)
    log(f"Wikidata: {len(wd)} of {len(imdb)} matched")
    # JustWatch's horror filter lets some thrillers and dramas through: keep a discovered film only if JustWatch
    # or Wikidata actually calls it horror.
    def is_horror(n):
        if any(g.get("shortName") == "hrr" for g in n["content"].get("genres") or []):
            return True
        return "horror" in wd.get((n["content"].get("externalIds") or {}).get("imdbId") or "", "")
    dropped = [n["content"]["title"] for n in kept.values() if not is_horror(n)]
    kept = {jid: n for jid, n in kept.items() if is_horror(n)}
    log(f"Dropped {len(dropped)} non-horror: {', '.join(dropped[:12])}")

    # 6. Records.
    films, id_of = [], {}
    for f in anchors:
        n = nodes.get(f["key"])
        p = prev.get(f["id"]) if f.get("cur") else prev_by_key.get(f["key"])
        if n:
            r = record(n, base=f, wd=wd, prev=p)
        elif p:
            r = dict(p)  # keep last known
        else:
            r = {"id": f["id"] if f.get("cur") else f["key"], "t": f["t"], "y": f["y"], "g": f.get("g") or "M",
                 "tg": f.get("tg") or [], "o": [], **{k: f[k] for k in ("cur", "p", "w", "aka", "seed", "fl") if f.get(k)}}
        if not f.get("cur"):
            r["_k"] = f["key"]
        if not r.get("id") or r["id"] in id_of.values():
            continue
        films.append(r)
        if r.get("jid"):
            id_of[r["jid"]] = r["id"]
    for jid, n in sorted(kept.items(), key=lambda kv: -((kv[1]["content"].get("scoring") or {}).get("tmdbPopularity") or 0)):
        if jid in id_of:
            continue
        r = record(n, wd=wd, prev=prev.get(jid))
        films.append(r)
        id_of[jid] = r["id"]
    for f in films:
        jid = f.get("jid")
        f["sim"] = [id_of[j] for j in near.get(jid, []) if j in id_of and id_of[j] != f["id"]][:10]
        if jid in arrivals:
            day, _, pkg = arrivals[jid]
            key, _ = service_key(pkg)
            if key:
                f["nw"] = [day, key]
        if not f["sim"]:
            del f["sim"]

    # 7. Posters.
    have = fetch_posters([f for f in films if f.get("jid")])
    for f in films:
        f.pop("_poster", None)
        if f.get("jid") in have:
            f["px"] = 1
    log(f"Posters available: {len(have)}")

    checked = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    lines = ",\n".join(json.dumps(f, ensure_ascii=False, separators=(",", ":")) for f in films)
    DATA.write_text('{"v":2,"checked":"' + checked + '","source":"JustWatch UK, Wikidata","films":[\n' + lines + "\n]}\n", encoding="utf-8")
    log(f"Wrote {len(films)} films ({sum(1 for f in films if f.get('cur'))} curated, {sum(1 for f in films if f.get('seed'))} rated).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
