// aesthe satellite view: aerial pictures under the map's own labels and roads (a "hybrid" view).
// Where the pictures come from is set in config.js (CFG.satellite):
//   - the free default (tiles: ...): about 10 m per pixel. Fine for cities and coasts, soft when zoomed in close;
//   - optionally a sharp provider (sharp: { tiles: [...] } or sharp: { url: <TileJSON address> }), made from your own key in config.js.
//     It is used first, and the free pictures are the fallback if it cannot be reached.
// Nothing is requested until the person turns Satellite on. Turning it off puts every layer back exactly as it was.
// Loaded after app.js (uses map, CFG, $, lsGet, lsSet, toast).
(function () {
  'use strict';
  const S = CFG.satellite, chip = $('tSat');
  const https = u => typeof u === 'string' && /^https:\/\//.test(u);
  const baseOK = !!(S && Array.isArray(S.tiles) && S.tiles.length && https(S.tiles[0]));
  const sharpTiles = !!(S && S.sharp && Array.isArray(S.sharp.tiles) && S.sharp.tiles.length && https(S.sharp.tiles[0]));   // tile addresses given directly (Esri)
  const sharpOK = !!(S && S.sharp && (sharpTiles || https(S.sharp.url)));                                                 // or the address of a TileJSON file (MapTiler)
  const zoomOr = (z, d) => Number.isFinite(+z) && +z > 0 ? Math.min(24, +z) : d;
  if (!baseOK && !sharpOK) { if (chip) chip.remove(); return; }   // no source set: no button
  const SRC = 'sat', LAYER = 'sat-l', OWN = /^(sat-|life|trains|poly|route|mline|acc|trail|names|bord)/;
  let on = lsGet('aesthe_sat') === '1', applied = false, snap = null, errs = 0, tilesOK = false, hinted = false;
  let tok = 0, cur = null, sharpFailed = false, tjCache = null;     // cur: the pictures in use { kind: 'sharp' | 'base', tiles, tileSize, maxzoom, scheme, attribution }

  const vector = l => !OWN.test(l.id);
  const layers = () => (map.getStyle() && map.getStyle().layers) || [];

  // The credit text comes from the provider (config or its TileJSON): keep only plain text and https links.
  function cleanCredit(html) {
    if (typeof html !== 'string' || !html) return '';
    const doc = new DOMParser().parseFromString(html.slice(0, 2000), 'text/html'), out = document.createElement('span');   // an inert document: nothing in it runs or loads
    const walk = (from, into) => from.childNodes.forEach(n => {
      if (n.nodeType === 3) into.append(n.textContent);
      else if (n.nodeName === 'A') {
        const a = document.createElement('a'), href = n.getAttribute('href') || '';
        if (https(href)) { a.href = href; a.target = '_blank'; a.rel = 'noopener' }
        a.textContent = n.textContent; into.append(a);
      } else if (n.nodeType === 1 && !/^(SCRIPT|STYLE)$/.test(n.nodeName)) walk(n, into);       // any other tag: keep only its text
    });
    walk(doc.body, out);
    return out.innerHTML;
  }

  // Labels: white with a dark outline so they read on photographs. Called again after the colour theme changes.
  function labelColours() {
    for (const l of layers()) if (vector(l) && l.type === 'symbol' && l.layout && l.layout['text-field']) {
      map.setPaintProperty(l.id, 'text-color', '#ffffff'); map.setPaintProperty(l.id, 'text-halo-color', 'rgba(0,0,0,.8)'); map.setPaintProperty(l.id, 'text-halo-width', 1.6);
    }
  }

  // ---- which pictures ----
  const baseSpec = () => ({ kind: 'base', tiles: S.tiles, tileSize: S.tileSize === 512 ? 512 : 256, maxzoom: zoomOr(S.maxzoom, 14), scheme: 'xyz', attribution: cleanCredit(S.attribution) });
  // The sharp provider describes itself in a TileJSON file: its tile addresses, how deep it goes and its credit.
  async function readSharp() {
    if (tjCache) return tjCache;
    if (sharpTiles) {                                                       // nothing to fetch first: the config already says where the tiles are
      const sh = S.sharp;
      tjCache = { kind: 'sharp', tiles: sh.tiles.filter(https).slice(0, 4), tileSize: sh.tileSize === 512 ? 512 : 256, maxzoom: zoomOr(sh.maxzoom, 18), scheme: sh.scheme === 'tms' ? 'tms' : 'xyz', attribution: cleanCredit(sh.attribution) };
      return tjCache;
    }
    const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 9000);
    try {
      const r = await fetch(S.sharp.url, { signal: ctl.signal }); if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json(), tiles = Array.isArray(j.tiles) ? j.tiles.filter(https).slice(0, 4) : [];
      if (!tiles.length) throw new Error('no tile addresses');
      tjCache = { kind: 'sharp', tiles, tileSize: +j.tileSize === 512 ? 512 : 256, maxzoom: zoomOr(j.maxzoom, 18),
        scheme: j.scheme === 'tms' ? 'tms' : 'xyz', attribution: cleanCredit(S.sharp.attribution || j.attribution) };
      return tjCache;
    } finally { clearTimeout(tm) }
  }
  function mountPictures(spec) {
    if (map.getLayer(LAYER)) map.removeLayer(LAYER);
    if (map.getSource(SRC)) map.removeSource(SRC);
    map.addSource(SRC, { type: 'raster', tiles: spec.tiles, tileSize: spec.tileSize, maxzoom: spec.maxzoom, scheme: spec.scheme, attribution: spec.attribution });
    const first = layers().find(l => l.type !== 'background');
    map.addLayer({ id: LAYER, type: 'raster', source: SRC }, first && first.id);       // right above the background
    cur = spec; errs = 0; tilesOK = false;
    credit(spec.attribution);
  }
  // The panel hides the map's own credit strip on phones, so the picture credit is repeated in the panel footer while Satellite is on.
  function credit(html) {
    const foot = document.querySelector('.foot'); let sc = document.getElementById('satcr');
    if (!on || !html) { if (sc) sc.remove(); return }
    if (foot && !sc) { sc = document.createElement('div'); sc.id = 'satcr'; foot.appendChild(sc) }
    if (sc) sc.innerHTML = 'Satellite: ' + html;
  }

  // ---- turning the view on and off ----
  function styleChanges() {
    snap = { vis: {}, paint: {} };
    for (const l of layers()) {
      if (!vector(l)) continue;
      const vis = (l.layout && l.layout.visibility) || 'visible';
      if (l.type === 'fill' || l.type === 'fill-extrusion' || (l.type === 'line' && /casing/.test(l.id))) { snap.vis[l.id] = vis; map.setLayoutProperty(l.id, 'visibility', 'none') }
      else if (l.type === 'line') { snap.paint[l.id + '|line-opacity'] = map.getPaintProperty(l.id, 'line-opacity'); map.setPaintProperty(l.id, 'line-opacity', .55) }
      else if (l.type === 'symbol' && l.layout && l.layout['text-field']) for (const p of ['text-color', 'text-halo-color', 'text-halo-width']) snap.paint[l.id + '|' + p] = map.getPaintProperty(l.id, p);
    }
    labelColours();
  }
  async function apply() {
    if (applied || !map.getStyle()) return;
    const my = ++tok; let spec = null, note = '';
    if (sharpOK && !sharpFailed) {
      if (chip) chip.setAttribute('aria-busy', 'true');
      try { spec = await readSharp() } catch (e) { sharpFailed = true; if (baseOK) note = 'Sharp satellite pictures are not available right now, so the free lower-detail ones are shown.' }
      if (chip) chip.removeAttribute('aria-busy');
      if (!on || my !== tok || applied || !map.getStyle()) return;           // turned off (or on again) while waiting
    }
    if (!spec && baseOK) spec = baseSpec();
    if (!spec) { set(false); toast('Satellite pictures are not available right now.', 6000); return }
    applied = true;
    styleChanges(); mountPictures(spec);
    if (note) toast(note, 7000);
  }
  function revert() {
    tok++;
    if (!applied) return; applied = false;
    if (map.getStyle() && snap) {
      for (const id in snap.vis) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', snap.vis[id]);
      for (const k in snap.paint) { const [id, prop] = k.split('|'); if (map.getLayer(id)) map.setPaintProperty(id, prop, snap.paint[k]) }
      if (map.getLayer(LAYER)) map.removeLayer(LAYER);
      if (map.getSource(SRC)) map.removeSource(SRC);
    }
    snap = null; cur = null;
    // The colour theme may have been changed while Satellite was on: put the labels and colours of the *current* theme back.
    try { if (typeof paintDark === 'function' && typeof styleReady !== 'undefined' && styleReady && map.getStyle()) paintDark(ti === 2) } catch (e) { /* the theme is repainted at the next change */ }
  }

  function paint() { if (!chip) return; chip.classList.toggle('on', on); chip.setAttribute('aria-pressed', on ? 'true' : 'false') }
  function set(v, remember = true) {
    on = v; if (remember) lsSet('aesthe_sat', v ? '1' : '0'); paint();
    errs = 0; tilesOK = false;
    if (v) apply(); else { revert(); credit('') }
    document.body.classList.toggle('sat', v);
    self.dispatchEvent(new CustomEvent('aesthe-satellite', { detail: v }));
  }

  // If the picture server does not answer at all, say so: the sharp pictures give way to the free ones, and those to the normal map.
  map.on('sourcedata', e => { if (e.sourceId === SRC && e.tile) tilesOK = true });
  map.on('error', e => {
    if (!on || !applied || !e || e.sourceId !== SRC || tilesOK) return;
    if (++errs < 3) return;
    if (cur && cur.kind === 'sharp' && baseOK) {
      sharpFailed = true; mountPictures(baseSpec());
      toast('Sharp satellite pictures could not be loaded, so the free lower-detail ones are shown.', 7000);
    } else { set(false); toast(navigator.onLine ? 'Satellite pictures could not be loaded, so the normal map is shown again.' : 'You are offline, so satellite pictures are not available.', 6000) }
  });
  // The free pictures are only about 10 m per pixel: say so once, rather than leave people wondering why they are soft.
  // (A 256-pixel tile of zoom z is sharp up to map zoom z-1; beyond that it is stretched.)
  map.on('zoomend', () => {
    if (!on || hinted || !cur || cur.maxzoom >= 19) return;
    if (map.getZoom() >= cur.maxzoom - (cur.tileSize >= 512 ? 0 : 1) + 1.5) { hinted = true; toast('Satellite pictures are low detail this close. Turn Satellite off for streets and buildings.', 6000) }
  });
  // A colour theme change re-paints the labels; put the satellite label colours back on top.
  if (typeof paintDark === 'function') { const pd = paintDark; paintDark = function (x) { pd(x); if (applied) labelColours() } };   // eslint-disable-line no-global-assign

  if (chip) chip.onclick = () => set(!on);
  const start = () => { if (on) { applied = false; set(true, false) } else paint() };
  if (typeof styleReady !== 'undefined' && styleReady) start(); else map.once('load', start);
  paint();

  self.aestheSatellite = { isOn: () => on, set, applied: () => applied, kind: () => cur && cur.kind, maxzoom: () => cur && cur.maxzoom };
})();
