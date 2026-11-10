// Nearby-mosque lookups from outside our own DB.
//
// Google Places is the primary source. When it can't answer (no key, billing
// disabled, quota exceeded, network error) we fall back to OpenStreetMap via
// the Overpass API, so the app still shows real nearby masjids instead of an
// empty list. Both sources are cached in Redis by a ~1.1 km grid cell.
//
// Every external mosque carries `isGoogle: true` — older app builds use that
// flag to mean "not in our DB yet, send mosqueData when editing it" — plus a
// `source` of 'google' or 'osm'.
const axios = require('axios');
const { cacheGet, cacheSet } = require('../config/redis');

const GOOGLE_CACHE_TTL_SECONDS = 60 * 60;          // 1 hour
const OSM_CACHE_TTL_SECONDS = 24 * 60 * 60;        // OSM data changes slowly
const SOURCE_DOWN_COOLDOWN_MS = 10 * 60 * 1000;    // skip a failing source for 10 min
const GOOGLE_TEXT_SEARCH_RADIUS_M = 30000;
const OSM_RADIUS_M = 8000;
const OSM_MAX_ELEMENTS = 300;
const OSM_TIMEOUT_MS = 7000;

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
// Overpass rejects requests from generic HTTP-library user agents.
const OSM_HEADERS = { 'User-Agent': 'NearbyMosque/1.0 (+https://nearbymosque.in)', Accept: 'application/json' };

// Google statuses that mean "this key can't be used right now" (as opposed to
// a one-off bad request) — retrying on every request would only add latency.
const GOOGLE_HARD_FAILURES = new Set(['REQUEST_DENIED', 'OVER_QUERY_LIMIT', 'OVER_DAILY_LIMIT']);

// Per-process cooldowns. Deliberately not in Redis: they must work even when
// Redis is down, and a 10-minute per-instance skip is cheap to get wrong.
const sourceDownUntil = { google: 0, osm: 0 };
const isSourceDown = (name) => Date.now() < sourceDownUntil[name];
const markSourceDown = (name) => { sourceDownUntil[name] = Date.now() + SOURCE_DOWN_COOLDOWN_MS; };

// ── Geometry helpers ─────────────────────────────────────────────────────────
function distanceMeters(lat1, lng1, lat2, lng2) {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLng = (lng2 - lng1) * toRad;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(a)));
}

// ~1.1 km grid cell — the cache bucket, and the point we query external APIs
// from, so every user inside one cell shares one cached answer.
function gridCell(lat, lng) {
  const latStr = Number(lat).toFixed(2);
  const lngStr = Number(lng).toFixed(2);
  return { lat: Number(latStr), lng: Number(lngStr), key: `${latStr},${lngStr}` };
}

// ── Keyword helpers ──────────────────────────────────────────────────────────
// Words nearly every masjid name contains. Matching on them alone would turn
// "Noor Masjid" into "every masjid", so they're dropped whenever the query has
// at least one more specific word.
const GENERIC_NAME_WORDS = new Set([
  'masjid', 'masjide', 'masjed', 'mosque', 'jama', 'jamia', 'jame', 'jami', 'jamah',
  'e', 'al', 'el', 'the', 'of', 'near', 'in', 'مسجد',
]);

function keywordTokens(keyword) {
  const all = String(keyword || '')
    .toLowerCase()
    .split(/[\s,.\-_/()'"]+/)
    .filter(Boolean);
  const specific = all.filter((t) => !GENERIC_NAME_WORDS.has(t));
  return (specific.length ? specific : all).slice(0, 5);
}

function matchesKeyword(mosque, tokens) {
  if (!tokens.length) return true;
  const haystack = `${mosque.name || ''} ${mosque.address || ''}`.toLowerCase();
  return tokens.every((t) => haystack.includes(t));
}

// ── Google Places ────────────────────────────────────────────────────────────
function googlePlaceToMosque(place) {
  return {
    id: place.place_id,
    name: place.name,
    address: place.vicinity || place.formatted_address || '',
    lat: place.geometry.location.lat,
    lng: place.geometry.location.lng,
    rating: place.rating || 0,
    // SECURITY: photo reference is proxied through our own endpoint —
    // the Google API key is NEVER sent to the client.
    photoUrl: place.photos?.length
      ? `/api/mosques/proxy-photo?ref=${encodeURIComponent(place.photos[0].photo_reference)}`
      : null,
    isGoogle: true,
    source: 'google',
  };
}

// Resolves to an array (possibly empty) when Google answered, or null when
// Google is unavailable and the caller should try another source.
async function fetchGoogleMosques(lat, lng, keyword) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key || isSourceDown('google')) return null;

  const cell = gridCell(lat, lng);
  const cacheKey = keyword
    ? `google:v2:text:${cell.key}:${keyword.toLowerCase()}`
    : `google:v2:near:${cell.key}`;
  const cached = await cacheGet(cacheKey);
  if (cached) return cached;

  try {
    let response;
    if (keyword) {
      // Text Search matches names far better than Nearby Search's keyword
      // filter, and also understands "<name> <area>" queries.
      const query = /masjid|mosque|مسجد/i.test(keyword) ? keyword : `${keyword} masjid`;
      response = await axios.get('https://maps.googleapis.com/maps/api/place/textsearch/json', {
        params: { query, location: `${cell.lat},${cell.lng}`, radius: GOOGLE_TEXT_SEARCH_RADIUS_M, type: 'mosque', key },
        timeout: 5000,
      });
    } else {
      // rankby=distance returns the 20 NEAREST mosques. The old radius-based
      // query ranked by "prominence", so a famous masjid 15 km away beat the
      // small one around the corner.
      response = await axios.get('https://maps.googleapis.com/maps/api/place/nearbysearch/json', {
        params: { location: `${cell.lat},${cell.lng}`, rankby: 'distance', type: 'mosque', key },
        timeout: 5000,
      });
    }

    const { status, error_message: errorMessage, results } = response.data || {};
    if (status === 'OK' || status === 'ZERO_RESULTS') {
      const mosques = (results || []).filter((p) => p.geometry?.location).map(googlePlaceToMosque);
      await cacheSet(cacheKey, mosques, GOOGLE_CACHE_TTL_SECONDS);
      return mosques;
    }

    console.error('Google Places API Status:', status, errorMessage || '');
    if (GOOGLE_HARD_FAILURES.has(status)) markSourceDown('google');
    return null;
  } catch (err) {
    console.error('Google API Request Failed:', err.message);
    return null;
  }
}

// ── OpenStreetMap (Overpass) ─────────────────────────────────────────────────
function osmElementToMosque(el) {
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const tags = el.tags || {};
  const address = [
    tags['addr:housenumber'],
    tags['addr:street'],
    tags['addr:suburb'] || tags['addr:neighbourhood'],
    tags['addr:city'],
  ].filter(Boolean).join(', ');
  return {
    id: `osm-${el.type}-${el.id}`, // no ':' or '/' — it's used as a URL path segment
    name: tags['name:en'] || tags.name || tags['name:ur'] || tags['name:hi'] || 'Masjid',
    address: address || tags['addr:full'] || '',
    lat,
    lng,
    rating: 0,
    photoUrl: null,
    isGoogle: true, // "not in our DB yet" — see the note at the top of this file
    source: 'osm',
  };
}

// Resolves to an array, or null when no Overpass server answered in time.
async function fetchOsmMosques(lat, lng) {
  if (isSourceDown('osm')) return null;

  const cell = gridCell(lat, lng);
  const cacheKey = `osm:v1:${cell.key}`;
  const cached = await cacheGet(cacheKey);
  if (cached) return cached;

  const query = `[out:json][timeout:${Math.ceil(OSM_TIMEOUT_MS / 1000)}];`
    + `nwr["amenity"="place_of_worship"]["religion"="muslim"](around:${OSM_RADIUS_M},${cell.lat},${cell.lng});`
    + `out center tags ${OSM_MAX_ELEMENTS};`;

  try {
    // Public Overpass servers are often overloaded — ask all mirrors at once
    // and take whichever answers first.
    const data = await Promise.any(OVERPASS_ENDPOINTS.map((url) =>
      axios.get(url, { params: { data: query }, timeout: OSM_TIMEOUT_MS, headers: OSM_HEADERS })
        .then((r) => {
          if (!Array.isArray(r.data?.elements)) throw new Error('Unexpected Overpass response');
          return r.data;
        })
    ));
    const mosques = data.elements.map(osmElementToMosque).filter(Boolean);
    await cacheSet(cacheKey, mosques, OSM_CACHE_TTL_SECONDS);
    return mosques;
  } catch (err) {
    const reasons = err.errors ? err.errors.map((e) => e.response?.status || e.code || e.message).join(', ') : err.message;
    console.error('OSM Overpass lookup failed:', reasons);
    markSourceDown('osm');
    return null;
  }
}

// ── Public entry point ───────────────────────────────────────────────────────
// Returns { source, mosques } — source is 'google', 'osm' or null (nothing worked).
async function findExternalMosques(lat, lng, keyword) {
  const google = await fetchGoogleMosques(lat, lng, keyword);
  if (google) return { source: 'google', mosques: google };

  const osm = await fetchOsmMosques(lat, lng);
  if (osm) {
    const tokens = keywordTokens(keyword);
    return { source: 'osm', mosques: keyword ? osm.filter((m) => matchesKeyword(m, tokens)) : osm };
  }
  return { source: null, mosques: [] };
}

module.exports = {
  findExternalMosques,
  distanceMeters,
  keywordTokens,
  // exported for tests
  _internal: { fetchGoogleMosques, fetchOsmMosques, osmElementToMosque, gridCell, matchesKeyword, sourceDownUntil },
};
