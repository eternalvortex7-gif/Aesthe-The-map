// aesthe life: a few small 3D cars, buses, motorbikes, bicycles and walkers drifting along the real streets you are looking at,
// so the map never feels frozen. Pure decoration, NOT real traffic. It only runs when zoomed in on streets, with Motion on and the page visible.
// Every figure is built from a few boxes and drawn as extruded shapes (like the buildings), so it stands up when the map is tilted.
// Loaded after motion.js; uses its globals (map) and the Motion switch (aestheMotion).
(function () {
  'use strict';
  const SRC = 'life', LAYER = 'life-3d', CAR_Z = 14.5, WALK_Z = 16.3, DETAIL_Z = 16.3, FRAME_MS = 40;
  const SPEED = { motorway: 34, trunk: 30, primary: 26, secondary: 22, tertiary: 20, minor: 16, service: 11, path: 8, pedestrian: 8 };   // screen pixels per second
  const WEIGHT = { motorway: 3, trunk: 3, primary: 3, secondary: 3, tertiary: 2.5, minor: 2, service: 1, path: 1, pedestrian: 1.4 };
  const COLORS = ['#d64532', '#2f7de1', '#f2b632', '#35a96b', '#8a5cd6', '#f4f4f4', '#2b2f36', '#e8e1d4'];
  const BUS_COLORS = ['#c0392b', '#1f6fb2', '#e0a800', '#2e8b57'], RIDER = ['#2f3b52', '#7a2e2e', '#2e5e4e', '#555c66', '#8a6d2f'], HELMET = ['#f4f4f4', '#d64532', '#2f7de1', '#222'];
  const SHIRT = ['#e8503a', '#2f7de1', '#f2b632', '#35a96b', '#8a5cd6', '#ffffff', '#ef7bb0'];
  const GLASS = '#2d3d4d', TYRE = '#1b1b1b', LAMP = '#fff0b3', SKIN = '#c58c63';
  // Traffic keeps to the left (India, UK, Japan...) unless config.js says drivingSide:'right'.
  const LEFT = String(CFG.drivingSide || 'left').toLowerCase() !== 'right';
  const small = (navigator.hardwareConcurrency || 4) <= 4 || matchMedia('(max-width:700px)').matches;
  const MAX = small ? 36 : 70;
  let aid = 0, fixed = [], blocks = [], nextBlock = 0, srcId = null, ready = false, raf = 0, last = 0, agents = [], built = null, busy = false;

  const mpp = (lat, z) => 40075016.686 * Math.cos(lat * Math.PI / 180) / (512 * Math.pow(2, z));   // metres per screen pixel
  const motionOn = () => !!(self.aestheMotion && self.aestheMotion.isOn());
  const walkers = () => map.getZoom() >= WALK_Z;
  const active = () => ready && motionOn() && !document.hidden && map.getZoom() >= CAR_Z;

  // ---- one little picture: the blinking amber glow of a road block (everything else is built from boxes, see below) ----
  function sprite(draw, w, h) {
    const c = document.createElement('canvas'); c.width = w * 2; c.height = h * 2;
    const x = c.getContext('2d'); x.scale(2, 2);
    draw(x);
    return x.getImageData(0, 0, w * 2, h * 2);
  }
  function addSprites() {
    map.hasImage('amber') || map.addImage('amber', sprite(x => {
      const g = x.createRadialGradient(6, 6, 0, 6, 6, 6); g.addColorStop(0, '#fff3b0'); g.addColorStop(.35, '#ffb400'); g.addColorStop(1, 'rgba(255,180,0,0)');
      x.fillStyle = g; x.fillRect(0, 0, 12, 12);
    }, 12, 12), { pixelRatio: 2 });
  }

  // ---- 3D figures ----
  // A figure is a list of boxes [u0, u1, v0, v1, base, top, colour]: u = metres forward of its middle, v = metres to its right,
  // base and top = metres above the ground. Boxes only touch or stack (never share a flat face), so nothing flickers.
  // Real sizes are used when zoomed in close; further out a figure is enlarged (all three ways together) so it stays visible, like a toy.
  const TYPES = {
    car: { L: 4.3, W: 1.8, hcap: 4, px: 1, speed: 1, cap: 30, min: 3, parts: (c, d) => {
      const p = [[-2.15, 2.15, -.9, .9, .15, 1.0, c.a], [-1.2, 1.1, -.78, .78, 1.0, 1.45, GLASS], [-1.2, 1.1, -.78, .78, 1.45, 1.6, c.a]];
      if (d) p.push([1.05, 1.65, .8, 1.0, 0, .55, TYRE], [1.05, 1.65, -1.0, -.8, 0, .55, TYRE], [-1.65, -1.05, .8, 1.0, 0, .55, TYRE], [-1.65, -1.05, -1.0, -.8, 0, .55, TYRE],
        [2.1, 2.2, .45, .8, .55, .8, LAMP], [2.1, 2.2, -.8, -.45, .55, .8, LAMP]);
      return p } },
    bus: { L: 11, W: 2.5, hcap: 4, px: 2.2, speed: .8, cap: 22, min: 3, parts: (c, d) => {
      const p = [[-5.5, 5.5, -1.25, 1.25, .2, 1.3, c.a], [-5.4, 5.4, -1.25, 1.25, 1.3, 2.5, GLASS], [-5.5, 5.5, -1.25, 1.25, 2.5, 3.1, c.a]];
      if (d) p.push([3.3, 4.3, 1.1, 1.3, 0, .5, TYRE], [3.3, 4.3, -1.3, -1.1, 0, .5, TYRE], [-4.3, -3.3, 1.1, 1.3, 0, .5, TYRE], [-4.3, -3.3, -1.3, -1.1, 0, .5, TYRE],
        [5.45, 5.6, .6, 1.0, .5, .8, LAMP], [5.45, 5.6, -1.0, -.6, .5, .8, LAMP]);
      return p } },
    bike: { L: 1.9, W: .65, hcap: 4, px: .5, speed: 1.1, cap: 26, min: 3, parts: c => [[-.8, .8, -.17, .17, .3, .85, c.a], [-.5, .05, -.2, .2, .85, 1.45, c.b], [-.22, .12, -.15, .15, 1.45, 1.75, c.h],
      [.45, .95, -.07, .07, 0, .7, TYRE], [-.95, -.45, -.07, .07, 0, .7, TYRE]] },
    cycle: { L: 1.8, W: .55, hcap: 4, px: .45, speed: .5, cap: 6, min: 1.2, parts: c => [[-.7, .7, -.04, .04, .4, .65, c.a], [-.4, 0, -.17, .17, .85, 1.4, c.b], [-.2, .12, -.13, .13, 1.4, 1.7, c.h],
      [.45, .9, -.03, .03, 0, .7, TYRE], [-.9, -.45, -.03, .03, 0, .7, TYRE]] },
    walker: { L: .5, W: .45, hcap: 3, px: .35, speed: 1, cap: 2.2, min: .8, parts: c => [[-.15, .15, -.22, .22, 0, 1.45, c.a], [-.12, .12, -.12, .12, 1.45, 1.75, SKIN]] }
  };
  // how big to draw a figure: k = enlargement of its footprint, hk = of its height (a little less, so tall figures do not become towers)
  const carPx = z => Math.max(8, Math.min(14, 8 + (z - 14.5) * 2.4));        // how long a car should look on screen, in pixels
  function scaleOf(T, z, m) { const k = Math.max(1, T.px * carPx(z) * m / T.L); return { k, hk: Math.min(k, T.hcap) } }
  function pickType(cls) {
    const r = Math.random();
    if (cls === 'motorway') return r < .09 ? 'bus' : 'car';
    if (cls === 'service') return r < .3 ? 'bike' : r < .36 ? 'cycle' : 'car';
    if (cls === 'minor') return r < .02 ? 'bus' : r < .3 ? 'bike' : r < .38 ? 'cycle' : 'car';
    return r < .09 ? 'bus' : r < .33 ? 'bike' : r < .36 ? 'cycle' : 'car';
  }
  const choose = a => a[Math.random() * a.length | 0];
  function colours(type) {
    if (type === 'bus') return { a: choose(BUS_COLORS) };
    if (type === 'bike' || type === 'cycle') return { a: choose(COLORS), b: choose(RIDER), h: choose(HELMET) };
    if (type === 'walker') return { a: choose(SHIRT) };
    return { a: choose(COLORS) };
  }
  // Boxes as extruded polygons. F places a figure on the map: its middle, and the direction it faces (degrees clockwise from north).
  const placeAt = (lng, lat, brDeg) => { const r = brDeg * Math.PI / 180; return { lng, lat, s: Math.sin(r), c: Math.cos(r), kx: 111320 * Math.cos(lat * Math.PI / 180) } };
  const corner = (F, u, v) => [F.lng + (F.s * u + F.c * v) / F.kx, F.lat + (F.c * u - F.s * v) / 110540];
  // k enlarges the footprint, hk the heights (also multiplied by `grow`, 0..1, so a figure rises out of the road instead of popping up); voff shifts it sideways (metres, to the right)
  function pushBox(out, F, k, hk, voff, part, extra) {
    const b = part[4] * hk, h = part[5] * hk; if (h - b < .005) return;
    const u0 = part[0] * k, u1 = part[1] * k, v0 = part[2] * k + voff, v1 = part[3] * k + voff;
    const props = { k: '3', c: part[6], b: +b.toFixed(3), h: +h.toFixed(3) }; if (extra) for (const x in extra) props[x] = extra[x];
    out.push({ type: 'Feature', properties: props,
      geometry: { type: 'Polygon', coordinates: [[corner(F, u0, v0), corner(F, u1, v0), corner(F, u1, v1), corner(F, u0, v1), corner(F, u0, v0)]] } });
  }

  // ---- roads in view, read from the map tiles already loaded (no extra network) ----
  function toLine(coords, cls) {
    if (!coords || coords.length < 2) return null;
    const kx = 111320 * Math.cos(coords[0][1] * Math.PI / 180), ky = 110540, cum = [0];
    for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + Math.hypot((coords[i][0] - coords[i - 1][0]) * kx, (coords[i][1] - coords[i - 1][1]) * ky));
    const len = cum[cum.length - 1];
    return len >= 30 ? { c: coords, cum, len, cls, kx, ky, w: WEIGHT[cls] || 1, walk: cls === 'path' || cls === 'pedestrian' } : null;
  }
  // Only the stretch of a street that is on (or near) the screen: long roads are cut to the visible part.
  function clip(part, b) {
    const runs = [], step = Math.max(1e-6, (b.getEast() - b.getWest()) / 10);
    let run = [];
    const add = pt => { if (b.contains(pt)) run.push(pt); else { if (run.length > 1) runs.push(run); run = [] } };
    for (let i = 0; i < part.length - 1; i++) {
      const a = part[i], c = part[i + 1], dx = c[0] - a[0], dy = c[1] - a[1];
      const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / step));
      if (n > 4000) { add(a); continue; }
      for (let k = 0; k < n; k++) add([a[0] + dx * k / n, a[1] + dy * k / n]);
    }
    add(part[part.length - 1]);
    if (run.length > 1) runs.push(run);
    return runs;
  }
  function gather(b) {
    const out = [], seen = new Set(), cons = [];
    fixed = [];
    let feats = [];
    try { feats = map.querySourceFeatures(srcId, { sourceLayer: 'transportation' }) } catch (e) { return out }
    for (const f of feats) {
      const p = f.properties || {}, cls = p.class;
      if (/_construction$/.test(cls || '') && f.geometry) {                    // a road the map says is under construction: closed, so barricades at its ends
        const g0 = f.geometry, ps = g0.type === 'LineString' ? [g0.coordinates] : g0.type === 'MultiLineString' ? g0.coordinates : [];
        for (const c of ps) if (c.length > 1) cons.push({ c, kind: 'cons', tun: p.brunnel === 'tunnel' ? 'T' : 'G' });
        continue;
      }
      if (!(cls in SPEED) || p.brunnel === 'tunnel' || p.service === 'driveway' && !walkers()) continue;
      const g = f.geometry; if (!g) continue;
      const parts = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
      for (const part of parts) {
        for (const run of clip(part, b)) {
          const first = run[0], lastP = run[run.length - 1];
          const key = cls + first[0].toFixed(5) + first[1].toFixed(5) + lastP[0].toFixed(5) + lastP[1].toFixed(5);
          if (seen.has(key)) continue; seen.add(key);
          const l = toLine(run, cls); if (l && (!l.walk || walkers())) out.push(l);
          if (out.length > 600) break;
        }
      }
    }
    for (const w of stitch(cons)) {                                             // both ends of each stretch (joined across map tiles first)
      const c = w.c, len = toLine(c, 'minor');
      if (!len) continue;
      [[0, 1], [c.length - 1, c.length - 2]].forEach(([i, j]) => {
        if (!b.contains(c[i])) return;
        const kx = 111320 * Math.cos(c[i][1] * Math.PI / 180);
        fixed.push({ lng: c[i][0], lat: c[i][1], br: Math.atan2((c[j][0] - c[i][0]) * kx, (c[j][1] - c[i][1]) * 110540) * 180 / Math.PI, o: 1, real: true });
      });
    }
    return out;
  }
  // The map tiles cut every track at tile edges. Join the pieces back into whole tracks (only at plain end-to-end joins).
  // Two ends are "the same point" when they are within about 10 cm; matching is by tolerance, not by rounding, because tile edges
  // sit on exact binary fractions of a degree where rounding would split matching points.
  const EPS = 1e-6;
  function stitch(items) {
    const cell = v => Math.floor(v / EPS), grid = new Map(), ends = [];
    items.forEach((it, i) => [0, 1].forEach(e => {
      const pt = e ? it.c[it.c.length - 1] : it.c[0], rec = { i, e, pt, cx: cell(pt[0]), cy: cell(pt[1]) };
      ends.push(rec); const k = rec.cx + ',' + rec.cy; (grid.get(k) || grid.set(k, []).get(k)).push(rec);
    }));
    const near = (pt, it) => {                                              // every end of the same kind (and tunnel/ground) at this point
      const cx = cell(pt[0]), cy = cell(pt[1]), out = [];
      for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++)
        for (const r of grid.get(x + ',' + y) || []) {
          const o = items[r.i];
          if (o.kind === it.kind && o.tun === it.tun && Math.abs(r.pt[0] - pt[0]) < EPS && Math.abs(r.pt[1] - pt[1]) < EPS) out.push(r);
        }
      return out;
    };
    const used = new Set(), out = [];
    const extend = (chain, it, fwd) => {
      for (let guard = 0; guard < 500; guard++) {
        const tailPt = fwd ? chain[chain.length - 1] : chain[0], here = near(tailPt, it);
        if (here.length !== 2) return;                                      // a junction (or a dead end): stop
        const other = here.find(r => !used.has(r.i)); if (!other) return;
        used.add(other.i);
        const c = items[other.i].c, seg = fwd ? (other.e === 0 ? c : c.slice().reverse()) : (other.e === 1 ? c : c.slice().reverse());
        if (fwd) chain.push(...seg.slice(1)); else chain.unshift(...seg.slice(0, -1));
        if (chain.length > 6000) return;
      }
    };
    items.forEach((it, i) => {
      if (used.has(i)) return; used.add(i);
      const chain = it.c.slice(); extend(chain, it, true); extend(chain, it, false);
      out.push({ c: chain, kind: it.kind, tun: it.tun });
    });
    return out;
  }
  function pointAt(l, d) {
    const cum = l.cum; let i = 1;
    while (i < cum.length - 1 && cum[i] < d) i++;
    const f = (d - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1), a = l.c[i - 1], b = l.c[i];
    return { lng: a[0] + (b[0] - a[0]) * f, lat: a[1] + (b[1] - a[1]) * f, br: Math.atan2((b[0] - a[0]) * l.kx, (b[1] - a[1]) * l.ky) * 180 / Math.PI };
  }

  // ---- keep the cast up to date: keep whoever is still in view, add new ones where there is room ----
  function rebuild(again) {
    if (!active()) return;
    const b = map.getBounds(), c = map.getCenter(), z = map.getZoom(), m = mpp(c.lat, z);
    const padLng = (b.getEast() - b.getWest()) * .25, padLat = (b.getNorth() - b.getSouth()) * .25;
    const pb = new maplibregl.LngLatBounds([b.getWest() - padLng, b.getSouth() - padLat], [b.getEast() + padLng, b.getNorth() + padLat]);
    const lines = gather(pb);
    const cars = lines.filter(l => !l.walk), feet = lines.filter(l => l.walk);
    const want = (ls, per, cap) => Math.min(cap, Math.floor(ls.reduce((s, l) => s + l.len, 0) / (m * per)));
    agents = agents.filter(a => pb.contains([a.lng || c.lng, a.lat || c.lat]) && (!a.l.walk || walkers()));
    const fill = (ls, n, walk) => {
      const have = agents.filter(a => a.l.walk === walk).length;
      if (!ls.length || n <= have) return;
      const total = ls.reduce((s, l) => s + l.len * l.w, 0);
      for (let k = have; k < n; k++) {
        let r = Math.random() * total, l = ls[0];
        for (const x of ls) { r -= x.len * x.w; if (r <= 0) { l = x; break } }
        const type = walk ? 'walker' : pickType(l.cls), id = ++aid;
        agents.push({ l, d: Math.random() * l.len, dir: walk || Math.random() < .5 ? 1 : -1, id, ex: { g: id }, cv: SPEED[l.cls] * .6, sp: SPEED[l.cls] * (.8 + Math.random() * .4), age: 0, hd: 0,
          type, col: colours(type), shape: {}, k: 1, hk: 1, len: TYPES[type].L, wd: TYPES[type].W, lng: 0, lat: 0, walk });
      }
    };
    fill(cars, want(cars, 260, MAX), false);
    fill(feet, want(feet, 200, Math.round(MAX / 3)), true);
    if (!lines.length) setTimeout(check, 1300);                     // nothing yet: try again once the tiles have arrived
    built = { b: pb, z, t: Date.now(), empty: !lines.length };
    if (!again) settleSoon();       // tiles may still be loading: an empty answer is only trusted for a moment
  }

  // ---- road blocks: a barricade with cones and a blinking light. Cars queue up in front of it and drive on when it is gone. ----
  // Real ones (`fixed`) come from the map: roads that OpenStreetMap marks as under construction. Staged ones are decoration and
  // only appear now and then, never while you are navigating.
  const GAP = m => Math.max(5, 7 * m);
  const navigating = () => { try { return !!navOn } catch (e) { return false } };
  function trySpawnBlock(m, ms) {
    if (!active() || map.getZoom() < 15.5 || navigating() || blocks.filter(x => !x.gone).length >= 2) return false;
    const view = map.getBounds(), cands = agents.filter(a => !a.walk && a.lng && a.l.len >= 150 && view.contains([a.lng, a.lat]) && a.age > 1);
    if (!cands.length) return false;
    const a = cands[Math.random() * cands.length | 0], dist = Math.max(45, 70 * m);
    const at = a.d + a.dir * dist; if (at < 25 || at > a.l.len - 25) return false;
    const p = pointAt(a.l, at);
    if (blocks.some(x => Math.hypot((x.lng - p.lng) * 111320, (x.lat - p.lat) * 110540) < 120)) return false;
    blocks.push({ lng: p.lng, lat: p.lat, br: p.br, o: 0, until: Date.now() + (ms || 25000 + Math.random() * 20000), real: false });
    return true;
  }
  function tickBlocks(now, dt, m, view) {
    if (!nextBlock) nextBlock = now + 7000 + Math.random() * 6000;
    if (now >= nextBlock) { nextBlock = now + 35000 + Math.random() * 35000; trySpawnBlock(m) }
    for (const B of blocks) {
      const on = now < B.until && view.contains([B.lng, B.lat]) && !navigating();
      B.o += ((on ? 1 : 0) - B.o) * Math.min(1, dt * 3);
      if (!on && B.o < .03) B.gone = true;
    }
    blocks = blocks.filter(x => !x.gone);
  }
  // Vehicles heading for a barricade slow down, stop a few metres short and line up behind each other (each as long as it is drawn).
  function queueUp(m) {
    const gap = GAP(m), brk = Math.max(20, 28 * m), range = Math.max(150, 120 * m);
    for (const B of blocks) {
      if (B.o < .5) continue;
      const kx = 111320 * Math.cos(B.lat * Math.PI / 180), near = [];
      for (const a of agents) {
        if (a.walk || !a.lng) continue;
        const dx = (B.lng - a.lng) * kx, dy = (B.lat - a.lat) * 110540, hx = Math.sin(a.hd), hy = Math.cos(a.hd);
        const along = dx * hx + dy * hy, side = Math.abs(dx * hy - dy * hx);
        if (along > 0 && along < range + a.len && side < 7 + a.wd) near.push({ a, along });
      }
      near.sort((x, y) => x.along - y.along);
      let lim = gap;                                                          // how close the nose of the next vehicle may come to the barricade
      for (const { a, along } of near) {
        const half = a.len / 2, free = along - half - lim;
        a.mv = free <= 0 ? 0 : Math.min(a.mv * Math.min(1, free / brk), free);
        lim = along - a.mv + half + Math.max(1.5, .25 * a.len);               // the tail of this one, plus a gap
      }
    }
  }
  // A barricade of boxes across the road (u along the road, v across it), four cones and a blinking light.
  // The invisible 'k:b' points beside the drawn shapes say where each part is (for the amber glow and for tests).
  const BAR = [['#e03131', 0], ['#ffffff', 1]];
  const CONES = [[5.4, 0], [-5.4, 0], [-6, 2.6], [-6, -2.6]];
  function blockFeatures(B, m, ts, out) {
    const o = +B.o.toFixed(2); if (o <= .02) return;
    const wb = Math.max(8, 12 * m), kb = wb / 8, hkb = Math.min(kb, 3) * o, kc = Math.max(1, 3 * m / .6), hkc = Math.min(kc, 3) * o;
    const F = placeAt(B.lng, B.lat, B.br), mark = (t, c, extra) => out.push({ type: 'Feature', properties: Object.assign({ k: 'b', t, o }, extra), geometry: { type: 'Point', coordinates: c } });
    mark('barrier', [B.lng, B.lat], { r: B.br });
    for (let i = 0; i < 6; i++) pushBox(out, F, kb, hkb, 0, [-.25, .25, -4 + i * 8 / 6, -4 + (i + 1) * 8 / 6, .7, 1.1, BAR[i % 2][0]]);     // the striped bar
    pushBox(out, F, kb, hkb, 0, [-.2, .2, -3.6, -3.2, 0, .7, '#444']); pushBox(out, F, kb, hkb, 0, [-.2, .2, 3.2, 3.6, 0, .7, '#444']);      // legs
    pushBox(out, F, kb, hkb, 0, [-.15, .15, -.15, .15, 1.1, 1.5, Math.floor(ts / 450) % 2 ? '#ffb400' : '#7a5a00']);                          // lamp on top
    CONES.forEach(([v, u]) => {
      const c = corner(F, u * kb, v * kb), F2 = placeAt(c[0], c[1], B.br);
      mark('cone', c);
      pushBox(out, F2, kc, hkc, 0, [-.3, .3, -.3, .3, 0, .4, '#f97316']); pushBox(out, F2, kc, hkc, 0, [-.3, .3, -.3, .3, .4, .55, '#ffffff']);
      pushBox(out, F2, kc, hkc, 0, [-.3, .3, -.3, .3, .55, .75, '#f97316']);
    });
    mark('amber', [B.lng, B.lat], { s: +(Math.max(6 / m, 20) / 12 * 1.4).toFixed(3), a: +(o * (Math.floor(ts / 450) % 2 ? 1 : .25)).toFixed(2) });
  }

  function frame(t) {
    raf = requestAnimationFrame(frame);
    if (t - last < FRAME_MS) return;
    const dt = Math.min(.12, (t - last) / 1000); last = t;
    if (!active()) { stop(); return }
    const view = map.getBounds(), z = map.getZoom(), feats = [], cLat = map.getCenter().lat, m0 = Math.max(.1, mpp(cLat, z)), detail = z >= DETAIL_Z;
    tickBlocks(Date.now(), dt, m0, view);
    for (const a of agents) {                                                   // how big everyone is drawn, and how far they want to move this frame
      const m = Math.max(.1, mpp(a.lat || cLat, z)), T = TYPES[a.type], sc = scaleOf(T, z, m);
      a.k = sc.k; a.hk = sc.hk; a.len = T.L * sc.k; a.wd = T.W * sc.k;
      const v = Math.min(T.cap, Math.max(T.min, a.sp * m * T.speed));
      a.cv += (v - a.cv) * Math.min(1, dt * 2.2); a.mv = a.cv * dt;            // gentle pull-away after a stop
    }
    if (blocks.length) queueUp(m0);
    for (const a of agents) {
      const l = a.l, m = Math.max(.1, mpp(a.lat || cLat, z));
      if (dt > 0) a.cv = Math.min(a.cv, a.mv / dt);                           // what we really did this frame, so a stopped car pulls away gently
      a.d += a.dir * a.mv; a.age += dt;
      if (a.d > l.len) a.d -= l.len; else if (a.d < 0) a.d += l.len;
      const p = pointAt(l, a.d), heading = p.br + (a.dir < 0 ? 180 : 0); a.lng = p.lng; a.lat = p.lat; a.hd = heading * Math.PI / 180;
      if (!view.contains([p.lng, p.lat])) continue;
      const fade = 14 * m, o = Math.min(1, a.d / fade, (l.len - a.d) / fade, a.age / .7);
      if (o <= .02) continue;
      feats.push({ type: 'Feature', properties: { k: 'c', id: a.id, t: a.type, o: +o.toFixed(2) }, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } });
      const F = placeAt(p.lng, p.lat, heading), voff = a.walk ? 0 : (LEFT ? -.5 : .5) * a.wd;     // vehicles keep to their own side of the street
      const parts = a.shape[detail] || (a.shape[detail] = TYPES[a.type].parts(a.col, detail));
      for (const part of parts) pushBox(feats, F, a.k, a.hk * o, voff, part, a.ex);
    }
    const ts = Date.now();
    for (const B of fixed) if (view.contains([B.lng, B.lat])) blockFeatures(B, m0, ts, feats);
    for (const B of blocks) blockFeatures(B, m0, ts, feats);
    const s = map.getSource(SRC); if (s) s.setData({ type: 'FeatureCollection', features: feats });
  }
  function start() { if (!raf) { last = 0; raf = requestAnimationFrame(frame) } }
  function stop() {
    if (raf) cancelAnimationFrame(raf); raf = 0; agents = []; built = null; blocks = []; fixed = []; nextBlock = 0;
    const s = map.getSource(SRC); if (s) s.setData({ type: 'FeatureCollection', features: [] });
  }

  // ---- when to run ----
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
  function init() {
    const st = map.getStyle(), l = st && st.layers.find(x => x['source-layer'] === 'transportation');
    if (!l) return;                                             // a map style without streets: nothing to animate
    srcId = l.source; addSprites();
    map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, tolerance: 0, buffer: 64 });   // no simplifying: the shapes are small
    const firstLabel = st.layers.find(x => x.type === 'symbol');   // under the labels, over the roads
    map.addLayer({ id: LAYER, type: 'fill-extrusion', source: SRC, filter: ['==', ['get', 'k'], '3'], paint: {
      'fill-extrusion-color': ['get', 'c'], 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-base': ['get', 'b'], 'fill-extrusion-opacity': 1 } }, firstLabel && firstLabel.id);
    map.addLayer({ id: 'life-b', type: 'symbol', source: SRC, filter: ['==', ['get', 't'], 'amber'], layout: {
      'icon-image': 'amber', 'icon-size': ['get', 's'], 'icon-rotation-alignment': 'map', 'icon-pitch-alignment': 'map',
      'icon-allow-overlap': true, 'icon-ignore-placement': true }, paint: { 'icon-opacity': ['get', 'a'] } }, firstLabel && firstLabel.id);
    ready = true;
    // Tiles arrive one by one; a read made while some were missing would otherwise stick, so read again once new tiles have settled.
    let tileT = 0;
    map.on('sourcedata', e => { if (e.sourceId === srcId && e.tile && built) { clearTimeout(tileT); tileT = setTimeout(() => { if (active() && built) rebuild(true) }, 500) } });
    map.on('idle', check); map.on('zoomend', check); map.on('moveend', check);
    document.addEventListener('visibilitychange', check);
    self.addEventListener('aesthe-motion', check);
    check();
  }
  if (map.isStyleLoaded()) init(); else map.once('load', init);

  // helpers shared with trains.js
  const kit = { mpp, clip, pointAt, stitch, placeAt, pushBox, pickType, srcId: () => srcId, ready: () => ready, motionOn };
  self.aestheLife = { kit, blocks: () => blocks.length, fixed: () => fixed.length, forceBlock: ms => trySpawnBlock(Math.max(.1, mpp(map.getCenter().lat, map.getZoom())), ms),
    agents: () => agents, count: () => agents.length, running: () => !!raf, refresh: check, walkers: () => agents.filter(a => a.walk).length,
    // for tests: turn one vehicle on the road into another kind, and say which one (its id)
    forceType: type => { const a = agents.find(x => !x.walk && x.type !== type && x.age > 1); if (!a || !TYPES[type]) return 0; a.type = type; a.col = colours(type); a.shape = {}; return a.id },
    types: () => agents.reduce((o, a) => (o[a.type] = (o[a.type] || 0) + 1, o), {}) };
})();
