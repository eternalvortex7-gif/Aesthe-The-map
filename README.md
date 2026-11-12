# aesthe

A fast, private map: search places, explore what is nearby, get directions, and see photos of a place you mark.
Built on open data. No accounts, no ads, no analytics.

Plain HTML, CSS and JavaScript. There is no framework and no bundler. Node is only used for the build and tests.

## What is in this folder

| Path | What it is |
|---|---|
| `index.html`, `app.css`, `app.js` | The app |
| `config.js` | **Your settings.** API server address, contact e-mail, map style, optional Mapillary token |
| `vendor/` | The map library (MapLibre GL JS 4.7.1), served from your own site and checked against `CHECKSUMS.txt` |
| `sw.js`, `manifest.webmanifest`, `icons/` | Installable app and offline use |
| `privacy.html` | Privacy and credits page (**fill in the two `[add …]` placeholders**) |
| `worker/` | The API server (a small Cloudflare Worker): caching, rate limits, correct User-Agent. See `worker/README.md` |
| `scripts/` | `setup.mjs` (fills in your details), `build.mjs` (makes `dist/`), `preflight.mjs` (launch checks), `vendor.sh` (restore the map library) |
| `tests/` | Browser tests, server tests, build tests, and a live smoke test |
| `dist/` | **What you upload.** Created by `node scripts/build.mjs`. Never edit it by hand |

## Quick start (on your computer)

```bash
node scripts/build.mjs            # creates dist/
python3 -m http.server 8080 -d dist
# open http://localhost:8080
```

In this "direct" mode the browser talks to the free public services itself. That is fine for trying it out.
**Do not launch publicly this way**, see "Before you launch".

## Settings (`config.js`)

| Setting | Meaning |
|---|---|
| `apiBase` | Address of your API server, e.g. `https://api.example.com`. Empty = direct mode |
| `contact` | Your e-mail. Sent to Nominatim in direct mode so its operators can reach you |
| `style` | Map style URL. Default is OpenFreeMap "liberty" |
| `satellite` | Satellite view source: tile URL, attribution, real max zoom. Default is EOX Sentinel-2 cloudless (**non-commercial only**, about 10 m per pixel, real max zoom 14, so it is blurry when zoomed in close: that is the picture itself). `null` hides the button |
| `esriKey` / `maptilerKey` | **Sharp satellite pictures** down to street level. Paste one key (Esri wins if both) or run `node scripts/setup.mjs --esri-key KEY` / `--maptiler-key KEY`, then `node scripts/build.mjs` and `node tests/live-smoke.mjs` (checks the provider answers). The provider is used first; the free pictures are the fallback if it fails. Restrict the key to your site address in the provider's dashboard (keys in a web page are public). MapTiler's free plan is non-commercial; Esri's free tier has limits: read their terms before a commercial launch |
| `drivingSide` | `'left'` (default: India, UK, Japan, Australia…) or `'right'`. Which side the little 3D cars, buses, bikes and trains keep to. Decoration only, but it looks wrong if it does not match your country |
| `mapillaryToken` | Optional site-wide Mapillary client token. People can also add their own under About |

After you change `config.js`, run `node scripts/build.mjs` again. The security policy in `dist/_headers` is generated from it.

## Before you launch

0. Fill in your own details in one go: `node scripts/setup.mjs --site https://your-site --api https://your-api --email you@example.com --retention "14 days"` (sets `config.js`, `worker/wrangler.toml` and `privacy.html`; safe to re-run).
1. **Deploy your own API server** (`worker/README.md`) and put its address in `apiBase`. The free public Photon, Nominatim,
   Overpass and OSRM servers are donated and for light use only. Nominatim's rules are strict: at most 1 request per second
   in total, no autocomplete, a valid identifying User-Agent
   ([usage policy](https://operations.osmfoundation.org/policies/nominatim/)). OpenFreeMap has no limits and no guarantee of service.
2. Set `contact` in `config.js` and in `worker/wrangler.toml`; set `ALLOWED_ORIGINS` there to your real site address.
3. Fill in the two `[add …]` placeholders in `privacy.html` (contact e-mail, how long server logs are kept).
4. `node scripts/build.mjs && node scripts/preflight.mjs --strict` must report **No blockers**.
5. Go through `LAUNCH_CHECKLIST.md` and `DEVICE_TEST_PLAN.md`.

## Deploy the site

Upload the contents of `dist/` to any static host that serves over HTTPS. `dist/_headers` is understood by Cloudflare Pages and
Netlify. On another host, copy the headers in that file into your server settings. The same policy is also embedded as a
`<meta>` tag in `dist/index.html` as a fallback.

## Tests

```bash
node scripts/build.mjs                          # the browser tests run against dist/
node --test                                     # API server + build script tests
pip install playwright && playwright install chromium
python3 tests/e2e/run.py                        # real map library in a real browser; outside services are mocked
node tests/live-smoke.mjs                       # (optional) really calls the public services from your network
```

`python3 tests/e2e/run.py search` runs only the tests whose name contains "search".

## Data and credits

Map data © OpenStreetMap contributors (ODbL). Tiles and style by OpenFreeMap © OpenMapTiles. Map engine MapLibre GL JS (BSD-3-Clause).
Search by Photon and Nominatim, nearby places by Overpass, directions by OSRM. Photos from Wikimedia Commons, Wikipedia, Wikidata and
Mapillary; the author and licence are shown with every photo. The credits are visible on the map at all times and listed under About.
