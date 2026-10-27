// A stand-in for TMDB's API and image server, for the tests. Run: node tests/tmdb-mock.mjs [port]
// Then start wrangler dev with --var TMDB_KEY:eyJtest --var TMDB_API:http://localhost:<port>/3 --var TMDB_IMG:http://localhost:<port>/t/p/
import {createServer} from "node:http";

const PORT = Number(process.argv[2] || 8790);
const FILMS = {
  501: {id: 501, title: "Starfish", original_title: "Starfish", release_date: "2018-03-10", original_language: "en", runtime: 99,
    overview: "Grieving the death of her best friend, Aubrey retreats to her friend's apartment, only to find the world outside has ended and a mysterious signal is broadcasting.",
    poster_path: "/abcdefStarfish.jpg", genres: [{id: 27, name: "Horror"}, {id: 878, name: "Science Fiction"}],
    production_countries: [{iso_3166_1: "US"}], external_ids: {imdb_id: "tt5700182"},
    credits: {crew: [{job: "Director", name: "A.T. White"}, {job: "Writer", name: "Someone"}]},
    release_dates: {results: [{iso_3166_1: "GB", release_dates: [{certification: "15"}]}]},
    keywords: {keywords: [{name: "grief"}, {name: "monster"}]},
    "watch/providers": {results: {GB: {flatrate: [{provider_name: "Arrow Video Amazon Channel"}, {provider_name: "Shudder"}], ads: [{provider_name: "Tubi TV"}]}}}},
  777: {id: 777, title: "Obscure Midnight Tape", original_title: "Cinta de Medianoche", release_date: "2024-10-31", original_language: "es", runtime: 84,
    overview: "A cursed VHS tape found in an abandoned video shop starts recording the people who watch it. Gruesome and brutal.",
    poster_path: "/zzzzzzMidnight.jpg", genres: [{id: 27, name: "Horror"}], production_countries: [{iso_3166_1: "ES"}],
    external_ids: {imdb_id: "tt99999901"}, credits: {crew: [{job: "Director", name: "Ana Prueba"}]},
    release_dates: {results: [{iso_3166_1: "GB", release_dates: [{certification: "18"}]}]}, keywords: {keywords: [{name: "found footage"}]},
    "watch/providers": {results: {GB: {flatrate: [{provider_name: "Netflix"}]}}}},
  888: {id: 888, title: "Paddington", original_title: "Paddington", release_date: "2014-11-28", original_language: "en", runtime: 95,
    overview: "A young bear travels to London.", poster_path: "/pppppppBear.jpg", genres: [{id: 10751, name: "Family"}],
    production_countries: [{iso_3166_1: "GB"}], external_ids: {imdb_id: "tt1109624"}, credits: {crew: [{job: "Director", name: "Paul King"}]},
    release_dates: {results: [{iso_3166_1: "GB", release_dates: [{certification: "PG"}]}]}, keywords: {keywords: []}, "watch/providers": {results: {}}}
};
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
let calls = 0;
createServer((req, res) => {
  calls++;
  const url = new URL(req.url, "http://x");
  const send = (code, body, type = "application/json") => { res.writeHead(code, {"Content-Type": type}); res.end(type === "application/json" ? JSON.stringify(body) : body); };
  if (url.pathname === "/calls") return send(200, {calls});
  if (url.pathname.startsWith("/t/p/")) {
    if (!/^\/t\/p\/w(92|154|185|342|500)\/[A-Za-z0-9_-]+\.jpg$/.test(url.pathname)) return send(404, {});
    return send(200, PNG, "image/jpeg");
  }
  const auth = req.headers.authorization || "";
  if (auth !== "Bearer eyJtest" && url.searchParams.get("api_key") !== "v3test") return send(401, {status_message: "Invalid API key"});
  if (url.pathname === "/3/search/movie") {
    const q = (url.searchParams.get("query") || "").toLowerCase();
    const results = Object.values(FILMS).filter(f => f.title.toLowerCase().includes(q) || f.original_title.toLowerCase().includes(q))
      .map(f => ({id: f.id, title: f.title, original_title: f.original_title, release_date: f.release_date, original_language: f.original_language,
        overview: f.overview, poster_path: f.poster_path, genre_ids: f.genres.map(g => g.id)}));
    return send(200, {page: 1, results});
  }
  const m = /^\/3\/movie\/(\d+)$/.exec(url.pathname);
  if (m) return FILMS[m[1]] ? send(200, FILMS[m[1]]) : send(404, {status_message: "not found"});
  send(404, {});
}).listen(PORT, () => console.log("TMDB mock on " + PORT));
