// aesthe trains: little 3D metro trains on the metro tracks and trains on the railways, running along the real track lines.
// Every car is a few boxes drawn as extruded shapes (like the buildings). Decoration, NOT a timetable or live positions.
// Loaded after life.js (shares its helpers); switched off with the Motion button.
(function () {
  'use strict';
  const K = self.aestheLife && self.aestheLife.kit; if (!K) return;
  const { mpp, clip, pointAt, stitch, placeAt, pushBox } = K;
  const SRC = 'trains', LAYER = 'trains-3d', LAYER_UG = 'trains-3d-ug', MIN_Z = 11.5, FRAME_MS = 40;
  const small = (navigator.hardwareConcurrency || 4) <= 4 || matchMedia('(max-width:700px)').matches;
  const MAX = { metro: small ? 3 : 5, train: small ? 4 : 6 };
  const REAL = { metro: [11, 17], train: [18, 34] };            // metres per second (about 40-60 and 65-120 km/h)
  const CAR_M = { metro: 20, train: 24 }, CAR_W = { metro: 2.9, train: 3.0 };                       // car length and width in metres
  const LEFT = String(CFG.drivingSide || 'left').toLowerCase() !== 'right';
  const SKIP_SERVICE = /^(yard|siding|spur|crossover)$/;
  let dbg = null, ready = false, raf = 0, last = 0, trains = [], built = null, busy = false, gid = 0, longest = 0;

  const active = () => ready && K.motionOn() && !document.hidden && map.getZoom() >= MIN_Z;

  // ---- the cars: boxes [u0, u1, v0, v1, base, top, colour] (u forward from the middle of the car, v to its right, metres) ----
  // A car is a stack of full-size bands (skirt, body, windows, roof). The leading car gets a dark cab window and lamps at its front,
  // the last metro car red lamps at its back. Real size when zoomed in; further out every car is enlarged so it stays visible.
  const WIN = '#31475b', CAB = '#101820', LIGHT = '#fff6c9', RED = '#e03131';
  function carriage(L, W, bands, o) {
    const hl = L / 2, hw = W / 2, p = bands.map(([b, h, c]) => [-hl, hl, -hw, hw, b, h, c]);
    if (o && o.front) p.push([hl - 1.5, hl + .06, -hw + .3, hw - .3, o.front[0], o.front[1], CAB], [hl - .05, hl + .1, -hw + .5, -hw + .9, .65, .95, LIGHT], [hl - .05, hl + .1, hw - .9, hw - .5, .65, .95, LIGHT]);
    if (o && o.rear) p.push([-hl - .1, -hl + .05, -hw + .5, -hw + .9, .65, .95, RED], [-hl - .1, -hl + .05, hw - .9, hw - .5, .65, .95, RED]);
    return p;
  }
  const METRO = [[.55, 1.35, '#17a2b8'], [1.35, 1.85, '#e8eef3'], [1.85, 2.8, WIN], [2.8, 3.4, '#cfd8df']];
  const SHAPES = {
    mhead: carriage(20, 2.9, METRO, { front: [1.9, 2.75] }), mmid: carriage(20, 2.9, METRO), mtail: carriage(20, 2.9, METRO, { rear: true }),
    tloco: carriage(24, 3.0, [[.5, 1.1, '#4a4a4a'], [1.1, 1.5, '#f4c430'], [1.5, 3.4, '#c0392b'], [3.4, 3.7, '#3a3a3a']], { front: [2.1, 3.1] }),
    tcoach: carriage(24, 3.0, [[.5, .9, '#444444'], [.9, 1.8, '#2f5fa6'], [1.8, 2.8, '#dbe8f5'], [2.8, 3.6, '#2f5fa6']]),
    twag0: carriage(24, 3.0, [[.5, .8, '#333333'], [.8, 3.0, '#8a5a3c'], [3.0, 3.15, '#5c3b27']]),
    twag1: carriage(24, 3.0, [[.5, .8, '#333333'], [.8, 3.0, '#6b7280'], [3.0, 3.15, '#4b5563']]),
    twag2: carriage(24, 3.0, [[.5, .8, '#333333'], [.8, 3.0, '#3f7d5a'], [3.0, 3.15, '#2c5a40']])
  };

  // ---- tracks in view ----
  const kindOf = p => {
    const sub = p.subclass || '';
    if (/^(subway|light_rail|monorail)$/.test(sub)) return 'metro';
    if (/^(rail|narrow_gauge|preserved)$/.test(sub) && !SKIP_SERVICE.test(p.service || '')) return 'train';
    return null;
  };
  function gather(pb) {
    let feats = []; const raw = [];
    try { feats = map.querySourceFeatures(K.srcId(), { sourceLayer: 'transportation' }) } catch (e) { return [] }
    const seen = new Set();
    for (const f of feats) {
      const p = f.properties || {}, kind = kindOf(p), g = f.geometry;
      if (!kind || !g) continue;
      const parts = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
      for (const c of parts) {
        if (c.length < 2) continue;
        const id = kind + c[0].join(',') + c[c.length - 1].join(',') + c.length;
        if (seen.has(id)) continue; seen.add(id);
        raw.push({ c, kind, tun: p.brunnel === 'tunnel' ? 'T' : 'G' });
      }
    }
    const lines = []; longest = 0;
    const joined = stitch(raw); dbg = { raw: raw.length, joined: joined.map(w => w.kind + w.c.length) };
    for (const w of joined) {
      for (const run of clip(w.c, pb)) {
        const kx = 111320 * Math.cos(run[0][1] * Math.PI / 180), ky = 110540, cum = [0];
        for (let i = 1; i < run.length; i++) cum.push(cum[i - 1] + Math.hypot((run[i][0] - run[i - 1][0]) * kx, (run[i][1] - run[i - 1][1]) * ky));
        const len = cum[cum.length - 1];
        if (len >= 80) { lines.push({ c: run, cum, len, kx, ky, kind: w.kind, tun: w.tun === 'T' }); longest = Math.max(longest, len) }
        if (lines.length > 150) return lines;
      }
    }
    if (dbg) dbg.lens = lines.map(l => l.kind[0] + Math.round(l.len));
    return lines;
  }

  // ---- the trains ----
  const pick = a => a[Math.random() * a.length | 0];
  function newTrain(l) {
    const metro = l.kind === 'metro', freight = !metro && Math.random() < .3;
    const n = metro ? 4 + (Math.random() * 3 | 0) : 1 + (freight ? 6 + (Math.random() * 4 | 0) : 5 + (Math.random() * 3 | 0));
    const cars = [];
    for (let j = 0; j < n; j++) cars.push(metro ? (j === 0 ? 'mhead' : j === n - 1 ? 'mtail' : 'mmid')
      : j === 0 ? 'tloco' : freight ? 'twag' + (Math.random() * 3 | 0) : 'tcoach');
    const r = REAL[l.kind];
    return { id: ++gid, l, kind: l.kind, cars, real: r[0] + Math.random() * (r[1] - r[0]), dir: Math.random() < .5 ? 1 : -1, h: 0, lat: 0, lng: 0, age: 0, started: false };
  }
  function rebuild(again) {
    if (!active()) return;
    const b = map.getBounds(), c = map.getCenter(), m = mpp(c.lat, map.getZoom());
    const padLng = (b.getEast() - b.getWest()) * .25, padLat = (b.getNorth() - b.getSouth()) * .25;
    const pb = new maplibregl.LngLatBounds([b.getWest() - padLng, b.getSouth() - padLat], [b.getEast() + padLng, b.getNorth() + padLat]);
    const lines = gather(pb);
    trains = trains.filter(t => t.lat === 0 || pb.contains([t.lng, t.lat]));
    for (const kind of ['metro', 'train']) {
      const ls = lines.filter(l => l.kind === kind), total = ls.reduce((s, l) => s + l.len, 0);
      const want = Math.min(MAX[kind], Math.max(ls.length ? 1 : 0, Math.floor(total / (m * 420))));
      const have = trains.filter(t => t.kind === kind).length;
      for (let k = have; k < want; k++) {
        let r = Math.random() * total, l = ls[0];
        for (const x of ls) { r -= x.len; if (r <= 0) { l = x; break } }
        const t = newTrain(l), len = (t.cars.length) * 24;
        t.h = Math.random() * (l.len + len);                              // start somewhere along the track
        trains.push(t);
      }
    }
    if (!lines.length) setTimeout(check, 1300);
    built = { b: pb, z: map.getZoom(), t: Date.now(), empty: !lines.length };
    if (!again) settleSoon();
  }

  function frame(tm) {
    raf = requestAnimationFrame(frame);
    if (tm - last < FRAME_MS) return;
    const dt = Math.min(.12, (tm - last) / 1000); last = tm;
    if (!active()) { stop(); return }
    const view = map.getBounds(), z = map.getZoom(), feats = [], centerLat = map.getCenter().lat;
    for (const t of trains) {                                                  // 1. how big, and how far along the track
      const l = t.l, m = Math.max(.05, mpp(t.lat || centerLat, z)), carM = CAR_M[t.kind];
      t.m = m; t.spacing = Math.max(carM + 1.5, 17 * m); t.span = t.spacing * t.cars.length;
      t.k = t.spacing / (carM + 1.5);                                          // how much bigger than real the cars are drawn (1 when zoomed in)
      t.h += Math.min(3000, Math.max(t.real, 12 * m)) * dt; t.age += dt;
      if (t.h > l.len + t.span) { t.h = 0; t.dir = Math.random() < .5 ? 1 : -1; t.ex = null }          // gone off the far end: come round again
    }
    // 2. a train never drives into the one ahead of it on the same track and way: it slows to the other's pace, a little behind its tail
    for (const t of trains) { const hp = t.h >= 0 && t.h <= t.l.len ? pointAt(t.l, t.dir > 0 ? t.h : t.l.len - t.h) : null; t.hp = hp && { x: hp.lng * t.l.kx, y: hp.lat * t.l.ky, br: (hp.br + (t.dir < 0 ? 180 : 0)) * Math.PI / 180 } }
    for (const f of trains) {
      if (!f.hp) continue;
      for (const L of trains) {
        if (L === f || !L.hp || Math.abs(L.l.kx - f.l.kx) > 500) continue;
        const dx = L.hp.x - f.hp.x, dy = L.hp.y - f.hp.y, hx = Math.sin(f.hp.br), hy = Math.cos(f.hp.br);
        const ahead = dx * hx + dy * hy, side = Math.abs(dx * hy - dy * hx), same = Math.cos(L.hp.br - f.hp.br) > .85;
        const need = L.span + 2 * f.k;                                         // the leader's whole length plus a gap
        if (same && side < 6 * f.k && ahead > 0 && ahead < need) f.h -= need - ahead;
      }
    }
    for (const t of trains) {                                                  // 3. draw
      const l = t.l, m = t.m, k = t.k, hk = Math.min(k, 4), fade = 12 * m;
      t.cars.forEach((img, j) => {
        const along = t.h - j * t.spacing; if (along < 0 || along > l.len) return;
        const p = pointAt(l, t.dir > 0 ? along : l.len - along);
        if (j === 0) { t.lng = p.lng; t.lat = p.lat }
        if (!view.contains([p.lng, p.lat])) return;
        const o = Math.min(1, along / fade, (l.len - along) / fade, t.age / .8);
        if (o <= .02) return;
        const heading = p.br + (t.dir < 0 ? 180 : 0);
        feats.push({ type: 'Feature', properties: { img, g: t.id, r: heading, o: +o.toFixed(2), s: +k.toFixed(3) }, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } });
        const F = placeAt(p.lng, p.lat, heading), ex = t.ex || (t.ex = { g: t.id, ug: l.tun ? 1 : 0 });
        const side = (LEFT ? -1 : 1) * .6 * (CAR_W[t.kind] * k);                  // two ways = two tracks, each on its own side
        for (const part of SHAPES[img]) pushBox(feats, F, k, hk * o, side, part, ex);      // grows out of the track at the ends; in a tunnel it is drawn faint
      });
    }
    const s = map.getSource(SRC); if (s) s.setData({ type: 'FeatureCollection', features: feats });
  }
  function start() { if (!raf) { last = 0; raf = requestAnimationFrame(frame) } }
  function stop() {
    if (raf) cancelAnimationFrame(raf); raf = 0; trains = []; built = null;
    const s = map.getSource(SRC); if (s) s.setData({ type: 'FeatureCollection', features: [] });
  }
  function covered() {
    if (!built || Math.abs(map.getZoom() - built.z) > .8) return false;
    if (built.empty && Date.now() - built.t > 1200) return false;
    const b = map.getBounds(); return built.b.contains(b.getSouthWest()) && built.b.contains(b.getNorthEast());
  }
  function check() {
    if (busy) return; busy = true;
    try { if (!active()) { if (raf) stop(); return } if (!covered()) rebuild(); start() } finally { busy = false }
  }
  // Right after a zoom the map may still show the old zoom level's tiles (and while we animate it never goes "idle"),
  // so a moment after every fresh read we read once more, keeping whoever is already running.
  let settleT = 0;
  function settleSoon() { clearTimeout(settleT); settleT = setTimeout(() => { if (active() && built) rebuild(true) }, 1500) }
  let tries = 0;
  function init() {
    if (!K.ready()) { if (++tries < 60) setTimeout(init, 200); return }      // life.js sets itself up when the map style is ready
    map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, tolerance: 0, buffer: 64 });
    const before = map.getLayer('life-3d') ? 'life-3d' : (map.getStyle().layers.find(x => x.type === 'symbol') || {}).id;
    const paint = o => ({ 'fill-extrusion-color': ['get', 'c'], 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-base': ['get', 'b'], 'fill-extrusion-opacity': o });
    map.addLayer({ id: LAYER, type: 'fill-extrusion', source: SRC, filter: ['all', ['==', ['get', 'k'], '3'], ['==', ['get', 'ug'], 0]], paint: paint(1) }, before);
    map.addLayer({ id: LAYER_UG, type: 'fill-extrusion', source: SRC, filter: ['all', ['==', ['get', 'k'], '3'], ['==', ['get', 'ug'], 1]], paint: paint(.35) }, before);
    ready = true;
    // Tiles arrive one by one after a move; a read made while some were still missing would stick (the view counts as "covered"),
    // so once new tiles of the road source have settled we read again, keeping the trains already running.
    let tileT = 0;
    map.on('sourcedata', e => { if (e.sourceId === K.srcId() && e.tile && built) { clearTimeout(tileT); tileT = setTimeout(() => { if (active() && built) rebuild(true) }, 500) } });
    map.on('idle', check); map.on('zoomend', check); map.on('moveend', check);
    document.addEventListener('visibilitychange', check);
    self.addEventListener('aesthe-motion', check);
    check();
  }
  init();

  self.aestheTrains = { info: () => dbg, count: () => trains.length, running: () => !!raf, refresh: check, longest: () => longest,
    kinds: () => trains.map(t => t.kind), cars: () => trains.reduce((s, t) => s + t.cars.length, 0) };
})();
