// aesthe weather: a small card above the compass with the forecast for the place you opened, or for where you are.
// Data: Open-Meteo.com (CC BY 4.0), fetched with the position rounded to 2 decimals (about 1 km). Loaded after compass.js.
//  - A place is open: its weather.   - No place: your own location, but only after you have tapped "Use my location" once
//    (afterwards it is used without asking again only while the browser still allows location for this site).
(function () {
  'use strict';
  const slot = document.getElementById('wx-slot'); if (!slot) return;
  const TTL = 10 * 60 * 1000;
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // WMO weather codes -> [text, day icon, night icon]
  const WMO = c => c === 0 ? ['Clear', '☀️', '🌙'] : c === 1 ? ['Mostly clear', '🌤️', '🌙'] : c === 2 ? ['Partly cloudy', '⛅', '☁️'] : c === 3 ? ['Overcast', '☁️', '☁️']
    : c === 45 || c === 48 ? ['Fog', '🌫️', '🌫️'] : c >= 51 && c <= 57 ? ['Drizzle', '🌦️', '🌧️'] : c >= 61 && c <= 67 ? ['Rain', '🌧️', '🌧️']
    : c >= 71 && c <= 77 || c === 85 || c === 86 ? ['Snow', '🌨️', '🌨️'] : c >= 80 && c <= 82 ? ['Showers', '🌦️', '🌧️'] : c >= 95 ? ['Thunderstorm', '⛈️', '⛈️'] : ['Weather', '🌡️', '🌡️'];

  let unit = lsGet('aesthe_units'); if (unit !== 'c' && unit !== 'f') unit = /^en-US/i.test(navigator.language || '') ? 'f' : 'c';
  let open = lsGet('aesthe_wx_open'); open = open === null ? (matchMedia('(min-width:701px)').matches && innerHeight >= 600) : open === '1';
  let failAt = 0, touched = false, state = 'idle', data = null, label = '', curKey = '', tok = 0, abort = null, locating = false, msg = '';
  const CACHE = new Map(), perm = () => navigator.permissions && navigator.permissions.query ? navigator.permissions.query({ name: 'geolocation' }).then(p => p.state, () => 'prompt') : Promise.resolve('prompt');

  // ---- markup ----
  const card = document.createElement('section'); card.id = 'wx'; card.setAttribute('aria-label', 'Weather');
  const head = document.createElement('button'); head.type = 'button'; head.className = 'wx-h'; head.setAttribute('aria-expanded', 'false'); head.setAttribute('aria-controls', 'wx-pop');
  const pop = document.createElement('div'); pop.id = 'wx-pop'; pop.hidden = true;
  card.append(head, pop); slot.appendChild(card);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e };
  const T = c => Math.round(unit === 'f' ? c * 9 / 5 + 32 : c) + '°';
  const W = k => unit === 'f' ? Math.round(k * .621371) + ' mph' : Math.round(k) + ' km/h';

  function render() {
    head.replaceChildren();
    const fill = (icon, big, small) => { head.append(el('span', 'wx-i', icon), el('span', 'wx-t', big)); if (small) head.append(el('span', 'wx-p', small)) };
    pop.replaceChildren();
    if (state === 'ready' && data) {
      const c = data.current, d = data.daily, w = WMO(c.weather_code), icon = c.is_day ? w[1] : w[2];
      fill(icon, T(c.temperature_2m), label);
      head.title = w[0] + ', ' + T(c.temperature_2m) + ' in ' + label + '. Press for the forecast.';
      const top = el('div', 'wx-top'); top.append(el('div', 'wx-big', icon), el('div', 'wx-now', T(c.temperature_2m)));
      const side = el('div', 'wx-side'); side.append(el('b', '', label), el('span', '', w[0] + ' · feels ' + T(c.apparent_temperature)),
        el('span', '', 'Humidity ' + Math.round(c.relative_humidity_2m) + '% · Wind ' + W(c.wind_speed_10m)));
      top.append(side); pop.append(top);
      const hr = el('div', 'wx-hours'); hr.setAttribute('aria-label', 'Next hours');
      const h = data.hourly; for (let i = 0; i < Math.min(9, h.time.length); i++) {
        const hh = +h.time[i].slice(11, 13), it = el('div', 'wx-hr');
        it.append(el('span', '', i === 0 ? 'Now' : (hh % 12 || 12) + (hh < 12 ? ' am' : ' pm')), el('span', 'wx-hi', WMO(h.weather_code[i])[hh >= 6 && hh < 18 ? 1 : 2]), el('b', '', T(h.temperature_2m[i])));
        if (h.precipitation_probability && h.precipitation_probability[i] >= 30) it.append(el('em', '', h.precipitation_probability[i] + '%')); hr.append(it);
      }
      pop.append(hr);
      const dl = el('div', 'wx-days');
      d.time.forEach((t, i) => {
        const [y, m, dd] = t.split('-').map(Number), row = el('div', 'wx-d');
        const rain = d.precipitation_probability_max ? d.precipitation_probability_max[i] : null;
        row.append(el('span', 'wx-dn', i === 0 ? 'Today' : DAYS[new Date(y, m - 1, dd).getDay()]), el('span', 'wx-di', WMO(d.weather_code[i])[1]),
          el('span', 'wx-dr', rain != null && rain >= 20 ? '💧' + rain + '%' : ''), el('span', 'wx-dt', T(d.temperature_2m_max[i]) + ' / ' + T(d.temperature_2m_min[i])));
        dl.append(row);
      });
      pop.append(dl);
      const foot = el('div', 'wx-f'), a = el('a', '', 'Weather data by Open-Meteo.com'); a.href = 'https://open-meteo.com/'; a.target = '_blank'; a.rel = 'noopener';
      const u = el('button', 'wx-u', unit === 'c' ? 'Use °F' : 'Use °C'); u.type = 'button';
      u.onclick = e => { e.stopPropagation(); unit = unit === 'c' ? 'f' : 'c'; lsSet('aesthe_units', unit); render() };
      foot.append(a, u); pop.append(foot);
    } else if (state === 'loading') { fill('⏳', '…', label || 'Weather'); head.title = 'Loading the weather' }
    else if (state === 'ask') {
      fill('🌤️', 'Weather', 'near me'); head.title = 'Show the weather where you are. Your position is read once and sent, rounded to about 1 km, to Open-Meteo.';
      pop.append(el('p', 'wx-m', 'Open a place to see its weather, or show the weather where you are.'));
      const b = el('button', 'wx-go', locating ? 'Finding you…' : 'Use my location'); b.type = 'button'; b.disabled = locating; b.onclick = e => { e.stopPropagation(); useMe() }; pop.append(b);
      pop.append(el('p', 'wx-s', msg || 'Your position is sent, rounded to about 1 km, to Open-Meteo.'));
    } else {
      fill('⚠️', 'Weather', 'unavailable'); head.title = 'The weather could not be loaded. Press to try again.';
      pop.append(el('p', 'wx-m', msg || 'The weather could not be loaded.'));
      const b = el('button', 'wx-go', 'Try again'); b.type = 'button'; b.onclick = e => { e.stopPropagation(); curKey = ''; poll() }; pop.append(b);
    }
    const show = open && (state === 'ready' || ((state === 'ask' || state === 'error') && touched));     // the "use my location" box never opens by itself
    pop.hidden = !show; head.setAttribute('aria-expanded', show ? 'true' : 'false');
  }
  head.onclick = () => { touched = true; open = !open; lsSet('aesthe_wx_open', open ? '1' : '0'); render() };
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && open && !pop.hidden && card.contains(document.activeElement)) { open = false; render(); head.focus() } });

  // ---- fetching ----
  const r2 = v => (Math.round(v * 100) / 100).toFixed(2);
  async function load(t) {
    const la = r2(t.lat), lo = r2(t.lon), key = la + ',' + lo, my = ++tok;
    label = t.label; if (abort) abort.abort(); abort = new AbortController();
    const hit = CACHE.get(key);
    if (hit && Date.now() - hit.t < TTL) { data = hit.d; state = 'ready'; render(); return }
    state = 'loading'; render();
    try {
      const j = await jget(EP.weather(la, lo), abort.signal, 9000);
      if (my !== tok) return;
      if (!j || !j.current || !j.daily || !j.hourly || !Array.isArray(j.daily.time)) throw new Error('shape');
      if (CACHE.size > 30) CACHE.delete(CACHE.keys().next().value);
      CACHE.set(key, { t: Date.now(), d: j }); data = j; state = 'ready'; msg = '';
    } catch (e) {
      if (my !== tok || (e && e.name === 'AbortError')) return;
      state = 'error'; failAt = Date.now(); msg = navigator.onLine ? 'The weather service did not answer. Try again in a moment.' : 'You are offline.';   // not retried by itself at once: see poll()
    }
    render();
  }

  // ---- what to show the weather for ----
  function target() {
    if (typeof place !== 'undefined' && place && Number.isFinite(place.lat) && Number.isFinite(place.lon)) return { lat: place.lat, lon: place.lon, label: place.name || 'This place', k: 'p' };
    if (typeof me !== 'undefined' && me) return { lat: me.lat, lon: me.lng, label: 'Your location', k: 'm' };
    return null;
  }
  let askedAuto = false;
  function poll() {
    const t = target();
    if (!t) {
      if (curKey !== 'none') {
        curKey = 'none'; tok++; data = null;
        if (!askedAuto && lsGet('aesthe_wx_me') === '1') { askedAuto = true; perm().then(s => { if (s === 'granted') useMe(true); else { state = 'ask'; render() } }) }
        else { state = 'ask'; render() }
      }
      return;
    }
    const key = t.k + r2(t.lat) + ',' + r2(t.lon) + '|' + t.label;
    if (state === 'error' && key === curKey && Date.now() - failAt > 60000) curKey = '';     // after a failure, try again once a minute, not every half second
    if (key !== curKey) { curKey = key; load(t) }
  }
  function useMe(quiet) {
    if (locating || typeof locate !== 'function') return;
    locating = true; msg = ''; if (!quiet) { state = 'ask'; render() }
    locate(false).then(() => { lsSet('aesthe_wx_me', '1'); locating = false; curKey = ''; poll() },
      err => { locating = false; state = 'ask'; msg = err && err.code === 1 ? 'Location is blocked for this site. Allow it in your browser settings, then try again.' : 'Could not get your location.'; render() });
  }
  setInterval(poll, 500);
  render(); poll();

  self.aestheWeather = { state: () => state, label: () => label, unit: () => unit, open: () => open, refresh: () => { curKey = ''; poll() } };
})();
