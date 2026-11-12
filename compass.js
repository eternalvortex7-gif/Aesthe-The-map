// aesthe compass: a dial at the top right that turns with the map, leans with its tilt and shows the heading.
// Tap it to face north again; drag it (or use the arrow keys) to turn the map. Loaded after motion.js.
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const NAMES = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const norm = d => ((d % 360) + 360) % 360;
  const diff = (a, b) => ((b - a + 540) % 360) - 180;                    // shortest signed turn from a to b
  const name = b => NAMES[Math.round(norm(b) / 45) % 8];

  // ---- build the dial ----
  const root = document.createElement('div'); root.id = 'cmp';
  const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'cmp-d';
  const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', '-32 -32 64 64'); svg.setAttribute('aria-hidden', 'true');
  const mk = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); (parent || svg).appendChild(e); return e };
  // gold case (two shades of gold make the rim look turned), white dial
  const defs = mk('defs', {});
  const grad = (id, stops, x1, y1, x2, y2) => { const g = mk('linearGradient', { id, x1, y1, x2, y2 }, defs); stops.forEach(([o, c]) => mk('stop', { offset: o, 'stop-color': c }, g)) };
  grad('cmp-g1', [[0, '#fff3b8'], [.3, '#e8bf45'], [.62, '#a97c10'], [1, '#f6dc83']], 0, 0, 1, 1);
  grad('cmp-g2', [[0, '#8f670a'], [.4, '#e3b93e'], [1, '#fff0a8']], 0, 0, 1, 1);
  mk('circle', { r: 31.6, class: 'c-case', fill: 'url(#cmp-g1)' });
  mk('circle', { r: 28.4, class: 'c-rim', fill: 'url(#cmp-g2)' });
  mk('circle', { r: 26.6, class: 'c-face' });
  const dial = mk('g', { class: 'c-dial' });
  for (let i = 0; i < 24; i++) { const a = i * 15 * Math.PI / 180, big = i % 6 === 0, r1 = big ? 20.6 : 23; mk('line', { x1: Math.sin(a) * r1, y1: -Math.cos(a) * r1, x2: Math.sin(a) * 25.6, y2: -Math.cos(a) * 25.6, class: big ? 'c-tk c-big' : 'c-tk' }, dial) }
  const R = 15.2;
  const letters = [['N', 0, -R, 'c-n'], ['E', R, 0, 'c-l'], ['S', 0, R, 'c-l'], ['W', -R, 0, 'c-l']].map(([t, x, y, cls]) => {
    const e = mk('text', { x, y, class: cls, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, dial); e.textContent = t; e._p = [x, y]; return e });
  mk('path', { d: 'M0,-10.5 L3.4,0 L-3.4,0 Z', class: 'c-north' }, dial);        // needle: north half red,
  mk('path', { d: 'M0,10.5 L3.4,0 L-3.4,0 Z', class: 'c-south' }, dial);         // south half black
  mk('circle', { r: 1.7, class: 'c-pin' }, dial);
  mk('path', { d: 'M0,-32.4 L3.2,-27.4 L-3.2,-27.4 Z', class: 'c-mark' });        // fixed marker: the way you are looking
  btn.appendChild(svg);
  const read = document.createElement('div'); read.className = 'cmp-r'; read.setAttribute('aria-hidden', 'true');
  root.append(btn, read);
  // One column in the corner: weather card (weather.js), then the compass, then the map scale. They can never overlap.
  const dash = document.createElement('div'); dash.id = 'dash';
  const slot = document.createElement('div'); slot.id = 'wx-slot';
  dash.append(slot, root); document.body.appendChild(dash);
  const scale = document.querySelector('.maplibregl-ctrl-scale'); if (scale) dash.appendChild(scale);

  // ---- state shown on screen: the needle swings and settles like a real one (snaps when motion is off) ----
  let shown = 0, vel = 0, raf = 0, last = 0, lastLabel = '';
  const springy = () => !(self.aestheMotion && !self.aestheMotion.isOn()) && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  function draw() {
    const b = shown, p = Math.min(map.getPitch(), 70);
    dial.setAttribute('transform', 'rotate(' + (-b).toFixed(2) + ')');
    letters.forEach(t => t.setAttribute('transform', 'rotate(' + b.toFixed(2) + ' ' + t._p[0] + ' ' + t._p[1] + ')'));   // letters stay upright
    btn.style.transform = 'rotateX(' + (p * .8).toFixed(1) + 'deg)';
    const real = norm(map.getBearing()), label = name(real) + ' ' + Math.round(real) % 360 + '°';
    if (label !== lastLabel) {
      lastLabel = label; read.textContent = label;
      const north = Math.round(real) % 360 === 0;
      btn.setAttribute('aria-label', 'Compass. Facing ' + label + (north ? '' : '. Press to face north.') + ' Arrow keys turn the map.');
      root.classList.toggle('is-n', north && map.getPitch() < 1);
    }
  }
  function step(t) {
    raf = 0;
    const dt = Math.min(.05, (t - last) / 1000 || .016); last = t;
    const goal = norm(map.getBearing()), d = diff(norm(shown), goal);
    vel += (140 * d - 15 * vel) * dt; shown = norm(shown + vel * dt);
    draw();
    if (Math.abs(d) > .05 || Math.abs(vel) > .2) raf = requestAnimationFrame(step); else { shown = goal; vel = 0; draw() }
  }
  function sync() {
    if (springy()) { if (!raf) { last = performance.now(); raf = requestAnimationFrame(step) } }
    else { shown = norm(map.getBearing()); vel = 0; draw() }
  }
  map.on('rotate', sync); map.on('pitch', sync); map.on('move', sync);
  self.addEventListener('aesthe-motion', sync);
  shown = norm(map.getBearing()); draw();

  // ---- acting on the map ----
  const stopSway = () => { self.aestheMotion && self.aestheMotion.cancel && self.aestheMotion.cancel() };
  const faceNorth = () => { stopSway(); map.easeTo({ bearing: 0, pitch: 0, duration: 600 }) };
  let drag = null;
  btn.addEventListener('pointerdown', e => {
    const r = btn.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    drag = { cx, cy, a0: Math.atan2(e.clientY - cy, e.clientX - cx) * 180 / Math.PI, b0: map.getBearing(), moved: false, x: e.clientX, y: e.clientY };
    try { btn.setPointerCapture(e.pointerId) } catch (x) { /* fine */ }
  });
  btn.addEventListener('pointermove', e => {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
    if (!drag.moved) { drag.moved = true; stopSway(); map.stop() }
    const a = Math.atan2(e.clientY - drag.cy, e.clientX - drag.cx) * 180 / Math.PI;
    map.setBearing(drag.b0 - diff(drag.a0, a));                      // turn the dial by hand, the map follows
  });
  const end = () => { if (drag && !drag.moved) faceNorth(); drag = null };
  btn.addEventListener('pointerup', end); btn.addEventListener('pointercancel', () => { drag = null });
  btn.addEventListener('keydown', e => {
    const k = e.key; if (k !== 'ArrowLeft' && k !== 'ArrowRight') return;
    e.preventDefault(); stopSway(); map.easeTo({ bearing: map.getBearing() + (k === 'ArrowRight' ? 15 : -15), duration: 250 });
  });
  btn.addEventListener('keyup', e => { if (e.key === 'Enter' || e.key === ' ') faceNorth() });
  btn.addEventListener('click', e => e.preventDefault());              // pointer and keys are handled above
  btn.addEventListener('dblclick', e => e.preventDefault());

  self.aestheCompass = { shown: () => shown, label: () => lastLabel };
})();
