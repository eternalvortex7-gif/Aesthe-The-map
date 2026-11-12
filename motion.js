// aesthe motion: gentle camera moves that make the map feel alive. Pure decoration; the "Motion" button switches it all off.
// Loaded after app.js and uses its globals (map, place, goTo, lsGet, lsSet, $).
(function () {
  'use strict';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const stored = lsGet('aesthe_motion');
  let on = stored === null ? !reduce.matches : stored === '1';       // people who ask their device for less motion get none by default
  const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const TILT = 45, MIN_ZOOM = 15.5;                                   // only tilt when zoomed in on a spot (not for a whole city)
  let tok = 0, autoTilt = false, orbitTimer = 0;

  // The centre that keeps `ll` at the same place on screen after the pitch / bearing change (so the pin never slides away).
  function centerKeeping(ll, pitch, bearing) {
    try {
      const px = map.project(ll), t = map.transform.clone();
      t.pitch = pitch; t.bearing = bearing;
      for (let i = 0; i < 5; i++) {                                   // moving the centre changes where the pin lands, so repeat until it settles
        const d = t.locationPoint(ll).sub(px);
        if (Math.abs(d.x) < .2 && Math.abs(d.y) < .2) break;
        t.center = t.pointLocation(t.centerPoint.add(d));
      }
      return t.center;
    } catch (e) { return map.getCenter(); }
  }
  function moveKeeping(ll, pitch, bearing, ms) {
    map.easeTo({ pitch, bearing, center: centerKeeping(ll, pitch, bearing), duration: ms, easing: ease });
  }
  const cancel = () => { tok++; clearTimeout(orbitTimer) };

  // A slow sway left and right around the chosen spot while nobody touches the map; stops after two sweeps or on any touch.
  function orbit(p, my, sweeps) {
    orbitTimer = setTimeout(() => {
      if (!on || my !== tok || place !== p || document.hidden || sweeps <= 0) return;
      const dir = sweeps % 2 ? -1 : 1, b = map.getBearing() + dir * 18;
      map.once('moveend', e => { if (!e.originalEvent) orbit(p, my, sweeps - 1) });
      moveKeeping([p.lon, p.lat], map.getPitch(), b, 9000);
    }, 1200);
  }

  function afterPick(p) {
    const my = ++tok; clearTimeout(orbitTimer);
    map.once('moveend', e => {
      if (e.originalEvent || !on || my !== tok || place !== p) return;
      if (map.getZoom() < MIN_ZOOM) return;
      const ll = [p.lon, p.lat];
      if (map.getPitch() < 5) {
        autoTilt = true;
        map.once('moveend', e2 => { if (!e2.originalEvent) orbit(p, my, 2) });
        moveKeeping(ll, TILT, map.getBearing(), 1400);
      } else orbit(p, my, 2);
    });
  }

  const _goTo = goTo;
  goTo = function (p) { _goTo.apply(this, arguments); if (on && p) afterPick(p) };   // eslint-disable-line no-global-assign

  // Touching the map always wins.
  map.on('movestart', e => { if (e.originalEvent) cancel() });
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancel() });
  // Closing the place sets the camera back level.
  setInterval(() => {
    if (autoTilt && !place) { autoTilt = false; cancel(); if (map.getPitch() > 0 || map.getBearing() !== 0) map.easeTo({ pitch: 0, bearing: 0, duration: 900, easing: ease }) }
  }, 400);

  function paint() {
    const b = $('tMotion'); if (!b) return;
    b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.title = 'Gentle camera movement, small 3D cars, buses, bikes, walkers, trains and barricades. Decoration only: not live traffic, train times or road closures.';
  }
  function set(v, remember = true) {
    on = v; if (remember) lsSet('aesthe_motion', v ? '1' : '0'); paint();
    if (!on) { cancel(); map.stop(); if (autoTilt) { autoTilt = false; map.easeTo({ pitch: 0, bearing: 0, duration: 400 }) } }
    self.dispatchEvent(new CustomEvent('aesthe-motion', { detail: on }));
  }
  const btn = $('tMotion'); if (btn) btn.onclick = () => set(!on);
  reduce.addEventListener && reduce.addEventListener('change', () => { if (lsGet('aesthe_motion') === null) set(!reduce.matches, false) });
  paint();

  self.aestheMotion = { isOn: () => on, set, cancel };
})();
