/* aesthe settings. Edit this file (no rebuild needed for the app itself).
   It is read by the page and by the service worker, so keep it plain JavaScript. */
self.AESTHE_CONFIG = {
  // URL of your aesthe API server (the Cloudflare Worker in /worker), e.g. 'https://api.example.com'.
  // Leave '' to talk to the public servers (Photon, Nominatim, Overpass, OSRM) directly. That is fine for
  // development and a few people, but those servers are donated and rate limited: a public launch should use your own server.
  apiBase: '',

  // Your contact e-mail. Sent to Nominatim (direct mode only) so its operators can reach you if your app misbehaves.
  contact: '',

  // Map style. The default is the free OpenFreeMap "liberty" style (no key needed).
  style: 'https://tiles.openfreemap.org/styles/liberty',

  // Satellite view. Tiles are fetched straight from the provider, so it sees which map areas people look at.
  //
  // SHARP PICTURES: the free default below is only about 10 m per pixel (see further down), so it turns blurry when you zoom in.
  // For pictures that stay sharp down to street level (roughly 0.3 to 1 m per pixel in most towns) add ONE key here.
  // The app then uses that provider first, and falls back to the free pictures if the provider cannot be reached.
  // A key in a web page is public, so ALWAYS restrict it to your site's address in the provider's dashboard.
  //   esriKey:      Esri World Imagery. Free account at https://location.arcgis.com, create an API key with the "Basemaps" privilege.
  //                 Free tier has monthly limits and conditions: read https://developers.arcgis.com/terms/ before a commercial launch.
  //   maptilerKey:  MapTiler Satellite. Free account at https://cloud.maptiler.com/account/keys/ (free plan is for non-commercial use;
  //                 commercial use needs a paid plan). Then run  node tests/live-smoke.mjs  once to confirm the key and tileset work.
  // After changing a key run: node scripts/build.mjs
  esriKey: '',
  maptilerKey: '',
  //
  // The free default: "Sentinel-2 cloudless" by EOX, one picture of the whole world at about 10 m per pixel (a house is one or two
  // pixels). Its real maximum zoom is 14 (maxzoom below); closer than that the picture is simply enlarged. That is the limit of the
  // pictures themselves, not a fault of the app. Free for NON-COMMERCIAL use only (CC BY-NC-SA 4.0), with the credit below.
  // Another free-form provider: put its tile URL (with {z}/{x}/{y}), credit text and real maximum zoom here.
  // Set  satellite: null  to hide the Satellite button.
  satellite: {
    tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/g/{z}/{y}/{x}.jpg'],
    tileSize: 256,
    maxzoom: 14,
    attribution: '<a href="https://s2maps.eu" target="_blank" rel="noopener">Sentinel-2 cloudless</a> by <a href="https://eox.at" target="_blank" rel="noopener">EOX IT Services GmbH</a> (Contains modified Copernicus Sentinel data 2025)'
  },

  // Which side the little cars, buses and bikes keep to: 'left' (India, UK, Japan, Australia...) or 'right' (most of the rest).
  // This is only decoration, but it looks wrong if it does not match your country.
  drivingSide: 'left',

  // Optional site-wide Mapillary client token (free, public by design). People can also add their own in About.
  mapillaryToken: ''
};

// A key above turns on the sharp provider (satellite.sharp). Esri wins if both are set.
// Esri maxzoom 18 is a safe limit: beyond it Esri has no pictures in many places (grey "Map data not yet available" tiles),
// so the last level is simply enlarged. If your area has sharper pictures you may try 19.
(function (C) {
  if (!C.satellite) return;
  if (C.esriKey) {
    C.satellite.sharp = {
      tiles: ['https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=' + encodeURIComponent(C.esriKey)],
      tileSize: 256, maxzoom: 18,
      attribution: '<a href="https://www.esri.com" target="_blank" rel="noopener">Esri</a>, Maxar, Earthstar Geographics, and the GIS User Community'
    };
  } else if (C.maptilerKey) {
    C.satellite.sharp = {
      url: 'https://api.maptiler.com/tiles/satellite-v4/tiles.json?key=' + encodeURIComponent(C.maptilerKey),
      attribution: '<a href="https://www.maptiler.com/copyright/" target="_blank" rel="noopener">&copy; MapTiler</a> <a href="https://www.maptiler.com/copyright/" target="_blank" rel="noopener">and imagery providers</a>'
    };
  }
})(self.AESTHE_CONFIG);
