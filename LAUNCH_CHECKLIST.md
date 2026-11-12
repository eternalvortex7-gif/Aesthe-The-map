# Launch checklist

Tick every box before telling the public. Items marked **(you)** cannot be done or verified by the build scripts.

## 1. Settings
- [ ] **(you)** API server deployed (`worker/README.md`); `curl https://<api>/health` answers `{"ok":true}`
- [ ] `config.js`: `apiBase` is your API address (https), `contact` is a monitored e-mail
- [ ] `worker/wrangler.toml`: `ALLOWED_ORIGINS` is your real site address (not `*`), `CONTACT` is set
- [ ] `privacy.html`: both `[add …]` placeholders filled in (contact e-mail, log retention)
- [ ] `node scripts/build.mjs && node scripts/preflight.mjs --strict` says **No blockers**

## 2. Automatic checks (all must pass)
- [ ] `node --test`
- [ ] `python3 tests/e2e/run.py`
- [ ] `node tests/live-smoke.mjs` (from a normal internet connection)
- [ ] `bash scripts/vendor.sh --check` says both files are OK

## 3. Hosting
- [ ] **(you)** Site served over HTTPS on its final address
- [ ] **(you)** Open the live site's developer tools, Console: no red errors and no "Content Security Policy" messages
- [ ] **(you)** `https://<site>/sw.js` and `/config.js` load; after a redeploy the page shows "A new version of aesthe is ready" with a **Reload** button
- [ ] **(you)** Response headers of the live page include `Content-Security-Policy`, `X-Content-Type-Options`, `Strict-Transport-Security`
      (browser dev tools, Network tab, click the page request). If they are missing your host ignored `_headers`: copy them into its settings

## 4. People and law
- [ ] **(you)** `privacy.html` read by someone who knows the rules in the countries you serve (for example GDPR in the EU)
- [ ] **(you)** Contact e-mail receives mail
- [ ] OpenStreetMap, OpenFreeMap and OpenMapTiles credits are visible on the map without tapping anything (the tests check this)
- [ ] **(you)** Weather is by Open-Meteo. Its free service is for **non-commercial** use only (no ads, subscriptions or paid features) and needs the credit that the app shows; a commercial site needs their paid plan, or your own Open-Meteo server (`WEATHER_URL` in `worker/wrangler.toml`): https://open-meteo.com/en/terms
- [ ] **(you)** Satellite view defaults to EOX Sentinel-2 cloudless: **non-commercial use only** (https://cloudless.eox.at/documentation/license.html), about 10 m per pixel (blurry when zoomed in). For sharper pictures add an Esri or MapTiler key (`esriKey` / `maptilerKey` in `config.js`, or `node scripts/setup.mjs --esri-key KEY`), restrict it to your site address, rebuild, and run `node tests/live-smoke.mjs` to confirm it answers. For a commercial site make sure the provider's terms allow it (MapTiler free plan: non-commercial), or set `satellite` to `null`
- [ ] Nominatim usage policy understood: https://operations.osmfoundation.org/policies/nominatim/

## 5. Real devices
- [ ] **(you)** `DEVICE_TEST_PLAN.md` completed on one iPhone and one Android phone

## 6. After launch
- [ ] Watch the API server's request and error counts for the first week (Cloudflare dashboard)
- [ ] If search often says "busy": move `NOMINATIM_URL` / `PHOTON_URL` to your own or a paid service
- [ ] Re-run `scripts/preflight.mjs` after every settings change
