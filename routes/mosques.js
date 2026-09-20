const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const Mosque = require('../models/Mosque');
const { protect } = require('../middleware/auth');
const { uploadMem } = require('../middleware/upload');
const { Op } = require('sequelize');
const axios = require('axios');
const { cacheGet, cacheSet } = require('../config/redis');

// ── Rate limiter for write operations ─────────────────────────────────────────
// Auth is already required, but this caps a compromised/malicious account too.
const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // See authLimiter in routes/auth.js for why this is relaxed under the test suite only.
  max: process.env.NODE_ENV === 'test' ? 1000 : 30,
  message: { message: 'Too many requests. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Google Places cache (Redis) ─────────────────────────────────────────────────
// Buckets nearby-mosque responses by a coarse grid (~1.1km cells) so repeated
// requests for the same area don't hit the Google API on every call.
// TTL: 5 minutes. Falls back to always-miss (no error) if Redis isn't configured
// or is unreachable — see config/redis.js.
const GOOGLE_CACHE_TTL_SECONDS = 5 * 60;

function googleCacheKey(lat, lng, keyword) {
  // Round to 2 decimal places (~1.1 km grid bucket)
  return `google:${parseFloat(lat).toFixed(2)},${parseFloat(lng).toFixed(2)},${keyword || ''}`;
}

// ── Same-mosque matching (Google Places ↔ DB) ──────────────────────────────────
// Most DB mosques are added by hand (map pin + free-text name) and never carry a
// googlePlaceId, so an exact-id match alone misses the vast majority of real
// duplicates — the same physical mosque then shows up as two separate,
// unlinked cards. This falls back to proximity + fuzzy name matching so a DB
// mosque and its Google Places twin are recognised as ONE mosque and combined
// into a single card instead of either duplicating or silently dropping data.
const SAME_MOSQUE_DISTANCE_THRESHOLD = 0.0009; // ~100 m — matches POST /api/mosques's own duplicate check
// Tighter radius used when neither name is usable for comparison (e.g. both
// normalise to "" after stripping generic words like "Jama Masjid") — proximity
// alone is a much weaker signal, so require near-exact overlap (~30-40 m) to
// avoid merging two genuinely distinct, closely-spaced mosques.
const SAME_MOSQUE_NAMELESS_DISTANCE_THRESHOLD = 0.0003;

function normaliseMosqueName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/masjid|mosque|jama|jamia|jame|the/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function isSameMosque(a, b) {
  const n1 = normaliseMosqueName(a.name);
  const n2 = normaliseMosqueName(b.name);
  const hasUsableName = n1 && n2;
  const threshold = hasUsableName ? SAME_MOSQUE_DISTANCE_THRESHOLD : SAME_MOSQUE_NAMELESS_DISTANCE_THRESHOLD;
  const closeBy = Math.abs(a.lat - b.lat) < threshold && Math.abs(a.lng - b.lng) < threshold;
  if (!closeBy) return false;
  if (!hasUsableName) return true; // no usable name on one side — only trust very tight proximity
  return n1 === n2 || n1.includes(n2) || n2.includes(n1);
}

// ── Whitelist of allowed fields from client-supplied mosqueData ────────────────
// SECURITY: prevents clients from injecting arbitrary columns (userId, isApproved…)
function sanitiseMosqueData(raw) {
  const { name, address, lat, lng, googlePlaceId, school, photoUrl } = raw || {};
  return { name, address, lat, lng, googlePlaceId, school, photoUrl };
}

// ── GET /api/mosques ───────────────────────────────────────────────────────────
// Returns DB mosques (approved) merged with Google Places results.
// Supports: ?lat=&lng= (nearby), ?keyword= (search), ?page=&limit= (pagination)
router.get('/', async (req, res) => {
  try {
    const { lat, lng, keyword } = req.query;
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const offset = (page - 1) * limit;

    const where = { isApproved: true };

    // Validate coordinates
    let latNum, lngNum;
    if (lat || lng) {
      latNum = parseFloat(lat);
      lngNum = parseFloat(lng);
      if (isNaN(latNum) || isNaN(lngNum) || latNum < -90 || latNum > 90 || lngNum < -180 || lngNum > 180) {
        return res.status(400).json({ message: 'Invalid latitude or longitude' });
      }
      // Apply bounding box only when no keyword search is active
      if (!keyword) {
        const RADIUS_KM = 50; // Expanded to 50 km radius for better coverage
        const latDelta = RADIUS_KM / 111;
        const lngDelta = RADIUS_KM / (111 * Math.cos(latNum * Math.PI / 180));
        where.lat = { [Op.between]: [latNum - latDelta, latNum + latDelta] };
        where.lng = { [Op.between]: [lngNum - lngDelta, lngNum + lngDelta] };
      }
    }

    // Keyword filter — applied in DB for name/address fields
    if (keyword) {
      const cleanKeyword = keyword.trim();
      where[Op.or] = [
        { name: { [Op.like]: `%${cleanKeyword}%` } },
        { address: { [Op.like]: `%${cleanKeyword}%` } },
      ];
    }

    let { count, rows } = await Mosque.findAndCountAll({ where, limit, offset, order: [['createdAt', 'DESC']] });

    // Fallback: If bounding box returned 0 mosques and no keyword was specified, return all approved mosques
    if (rows.length === 0 && !keyword) {
      delete where.lat;
      delete where.lng;
      const fallbackResult = await Mosque.findAndCountAll({ where: { isApproved: true }, limit, offset, order: [['createdAt', 'DESC']] });
      rows = fallbackResult.rows;
    }

    let mosques = rows.map(m => m.toJSON());

    // ── Merge Google Places results ────────────────────────────────────────────
    if (latNum != null && lngNum != null && process.env.GOOGLE_MAPS_API_KEY) {
      const cacheKey = googleCacheKey(latNum, lngNum, keyword);
      let googleMosques = await cacheGet(cacheKey);

      if (!googleMosques) {
        try {
          const searchKeyword = keyword ? `${keyword} masjid` : 'masjid';
          const googleRes = await axios.get(
            `https://maps.googleapis.com/maps/api/place/nearbysearch/json`,
            {
              params: {
                location: `${latNum},${lngNum}`,
                radius: 20000,
                type: 'mosque',
                keyword: searchKeyword,
                key: process.env.GOOGLE_MAPS_API_KEY,
              },
              timeout: 5000,
            }
          );

          if (googleRes.data?.status && googleRes.data.status !== 'OK' && googleRes.data.status !== 'ZERO_RESULTS') {
            console.error('Google Places API Status:', googleRes.data.status, googleRes.data.error_message || '');
          }

          googleMosques = (googleRes.data?.results || []).map(place => ({
            id: place.place_id,
            name: place.name,
            address: place.vicinity,
            lat: place.geometry.location.lat,
            lng: place.geometry.location.lng,
            rating: place.rating || 0,
            // SECURITY: photo reference is proxied through our own endpoint —
            // the Google API key is NEVER sent to the client.
            photoUrl: place.photos?.length
              ? `/api/mosques/proxy-photo?ref=${encodeURIComponent(place.photos[0].photo_reference)}`
              : null,
            isGoogle: true,
          }));

          await cacheSet(cacheKey, googleMosques, GOOGLE_CACHE_TTL_SECONDS);
        } catch (err) {

          console.error('Google API Request Failed:', err.message);
          googleMosques = [];
        }
      }

      // ── Merge, don't duplicate: fold each Google result that matches a DB
      // mosque INTO that DB mosque's card (keeping the DB row as the single
      // source of truth for edits), and backfill the link so future requests
      // match instantly by googlePlaceId without needing the name/proximity
      // fallback again.
      const consumedGoogleIds = new Set();
      for (const m of mosques) {
        let g = null;
        if (m.googlePlaceId) {
          // Already linked to a specific Google place — that link is authoritative.
          // Only enrich from THAT exact place if it happens to be in this
          // response; never fuzzy-match an already-linked mosque to a
          // *different* nearby place just because its own didn't show up here.
          g = googleMosques.find(gm => gm.id === m.googlePlaceId);
        } else {
          g = googleMosques.find(gm => !consumedGoogleIds.has(gm.id) && isSameMosque(m, gm));
          if (g) {
            try {
              await Mosque.update({ googlePlaceId: g.id }, { where: { id: m.id } });
              m.googlePlaceId = g.id;
            } catch (err) {
              console.error('Failed to backfill googlePlaceId link:', err.message);
            }
          }
        }
        if (g) {
          consumedGoogleIds.add(g.id);
          m.rating = g.rating || m.rating || 0;
          if (!m.photoUrl) m.photoUrl = g.photoUrl;
          m.isGoogle = false; // Backed by a real DB row — edits always target it directly
        }
      }

      // Remaining Google results have no DB counterpart yet — list them as-is
      const uniqueGoogle = googleMosques.filter(g => !consumedGoogleIds.has(g.id) && !mosques.some(m => m.googlePlaceId === g.id));
      mosques = [...mosques, ...uniqueGoogle];
    }

    res.json(mosques);
  } catch (err) {
    console.error('[mosques GET] Fatal error:', err.message, err.stack);
    res.status(500).json({ message: 'Server Error' });
  }
});

// ── GET /api/mosques/proxy-photo ───────────────────────────────────────────────
// Proxies Google Places photo requests so the API key stays server-side only.
router.get('/proxy-photo', async (req, res) => {
  try {
    const { ref } = req.query;
    if (!ref || !process.env.GOOGLE_MAPS_API_KEY) {
      return res.status(400).json({ message: 'Invalid photo reference' });
    }

    const googleUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photo_reference=${encodeURIComponent(ref)}&key=${process.env.GOOGLE_MAPS_API_KEY}`;
    const response = await axios.get(googleUrl, { responseType: 'stream', timeout: 8000 });

    res.set('Content-Type', response.headers['content-type'] || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=86400'); // Cache photos for 24h on client
    response.data.pipe(res);
  } catch (err) {
    console.error('Photo proxy error:', err.message);
    res.status(502).json({ message: 'Could not fetch photo' });
  }
});

// ── POST /api/mosques — Submit a new mosque ───────────────────────────────────
router.post('/', protect, writeLimiter, async (req, res) => {
  try {
    const { name, address, location, school, iqamahTimings, photoUrl } = req.body;
    if (!name || !address || !location?.lat) {
      return res.status(400).json({ message: 'Name, address and location are required' });
    }

    // Proximity check (~100 m) — bounded box so it stays fast as table grows
    const threshold = 0.0009;
    const nearbyMosques = await Mosque.findAll({
      where: {
        lat: { [Op.between]: [location.lat - threshold, location.lat + threshold] },
        lng: { [Op.between]: [location.lng - threshold, location.lng + threshold] },
      },
    });
    const duplicate = nearbyMosques.find(m =>
      Math.abs(m.lat - location.lat) < threshold &&
      Math.abs(m.lng - location.lng) < threshold
    );

    if (duplicate) {
      // Update name/address/school on the existing record but leave isApproved unchanged
      // and mark timings as pending — admin review still required
      duplicate.name    = name;
      duplicate.address = address;
      // Only touch school if the caller actually sent one — a timings-only
      // follow-up submission has no `school` field and shouldn't silently
      // reset a previously-set 'hanafi' back to the 'shafi' default.
      if (school !== undefined) duplicate.school = school === 'hanafi' ? 'hanafi' : 'shafi';
      if (iqamahTimings) {
        duplicate.iqamahTimings   = typeof iqamahTimings === 'string' ? JSON.parse(iqamahTimings) : iqamahTimings;
        duplicate.timingsApproved = false;
        duplicate.timingsSubmittedBy = {
          id: req.user.id, name: req.user.name, email: req.user.email, submittedAt: new Date().toISOString(),
        };
      }
      if (photoUrl) {
        duplicate.photoUrl = photoUrl;
      }
      await duplicate.save();
      return res.status(200).json({
        message: 'Already added masjid has been updated with the new details and timings.',
        mosque: duplicate,
      });
    }

    const createdMosque = await Mosque.create({
      name, address, lat: location.lat, lng: location.lng,
      userId: req.user.id,
      isApproved: false,   // All new submissions need admin approval
      school: school === 'hanafi' ? 'hanafi' : 'shafi',
      iqamahTimings,
      photoUrl,
      timingsApproved: false,
    });
    res.status(201).json(createdMosque);
  } catch (err) {
    console.error('Mosque submit error:', err);
    res.status(500).json({ message: 'Failed to submit mosque' });
  }
});

// ── POST /api/mosques/upload-photo ────────────────────────────────────────────
router.post('/upload-photo', protect, writeLimiter, (req, res, next) => {
  uploadMem.single('photo')(req, res, (err) => {
    if (err) {
      console.error('[upload-photo] Multer error:', err.code, err.message);
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ message: 'File too large. Maximum size is 5 MB.' });
      }
      return res.status(400).json({ message: err.message || 'Upload error' });
    }
    console.log('[upload-photo] Multer OK. File:', req.file
      ? `${req.file.originalname} (${req.file.mimetype}, ${req.file.size} bytes)`
      : 'NONE');
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      console.error('[upload-photo] No file in request. Content-Type:', req.headers['content-type']);
      return res.status(400).json({ message: 'No file uploaded' });
    }
    const { smartUpload } = require('../utils/uploadHandler');
    const photoUrl = await smartUpload(req.file);
    console.log('[upload-photo] Success. URL:', photoUrl);
    res.json({ photoUrl });
  } catch (err) {
    console.error('Smart Upload Error:', err.message);
    res.status(500).json({ message: `Upload failed: ${err.message}` });
  }
});

// ── PUT /api/mosques/:id/timings — Update mosque timings ─────────────────────
router.put('/:id/timings', protect, writeLimiter, async (req, res) => {
  try {
    const { iqamahTimings, mosqueData } = req.body;
    let mosque = null;

    try { mosque = await Mosque.findByPk(req.params.id); } catch { }
    if (!mosque) mosque = await Mosque.findOne({ where: { googlePlaceId: req.params.id } });

    // If Google-sourced mosque not yet in DB and caller supplied mosqueData, create it.
    // SECURITY: whitelist fields — never spread raw client data directly.
    if (!mosque && mosqueData) {
      mosque = await Mosque.create({
        ...sanitiseMosqueData(mosqueData),
        userId: req.user.id,
        isApproved: false, // New mosques always start as pending
      });
    }

    if (!mosque) return res.status(404).json({ message: 'Mosque not found' });

    if (!iqamahTimings || Object.keys(iqamahTimings).length === 0) {
      return res.status(400).json({ message: 'Please provide at least one prayer time' });
    }

    const raw = typeof iqamahTimings === 'string' ? JSON.parse(iqamahTimings) : iqamahTimings;
    // Strip empty values so partial updates don't erase existing times
    const incoming = Object.fromEntries(Object.entries(raw).filter(([, v]) => v && v.trim() !== ''));
    if (Object.keys(incoming).length === 0) {
      return res.status(400).json({ message: 'Please provide at least one prayer time' });
    }

    // A mosque's first-ever timing submission (or one from someone other than
    // whoever's timing was last approved) needs admin review. Once a specific
    // user's submission has been approved, THAT SAME user's later updates to
    // this same mosque go live immediately — anyone else still needs review.
    const isTrustedSubmitter = mosque.timingsApproved && mosque.timingsSubmittedBy?.id === req.user.id;

    const existing = mosque.iqamahTimings || {};
    mosque.iqamahTimings   = { ...existing, ...incoming };
    mosque.timingsApproved = isTrustedSubmitter;
    mosque.timingsSubmittedBy = {
      id: req.user.id, name: req.user.name, email: req.user.email, submittedAt: new Date().toISOString(),
    };
    await mosque.save();

    res.json({
      message: isTrustedSubmitter ? 'Timings updated successfully' : 'Timings submitted for admin review',
      iqamahTimings: mosque.iqamahTimings,
      timingsApproved: mosque.timingsApproved,
    });
  } catch (err) {
    console.error('Timings update error:', err);
    res.status(500).json({ message: 'Server Error' });
  }
});

// ── PUT /api/mosques/:id/photo — Submit an updated mosque photo ───────────────
// Photo stays pending until an admin approves it; live photoUrl is untouched.
router.put('/:id/photo', protect, writeLimiter, async (req, res) => {
  try {
    const { photoUrl, mosqueData } = req.body;
    if (!photoUrl) return res.status(400).json({ message: 'photoUrl is required' });

    let mosque = null;
    try { mosque = await Mosque.findByPk(req.params.id); } catch { }
    if (!mosque) mosque = await Mosque.findOne({ where: { googlePlaceId: req.params.id } });

    // First-ever photo for a Google-sourced mosque not yet in our DB.
    // SECURITY: whitelist fields — mosqueData is entirely client-supplied, so
    // (like every other new-mosque creation path in this file) it must start
    // unapproved. Trusting it live here would let any authenticated user
    // publish a fabricated mosque straight to the public map with fake
    // name/address/coordinates and no admin review.
    if (!mosque && mosqueData) {
      mosque = await Mosque.create({
        ...sanitiseMosqueData(mosqueData),
        photoUrl,
        userId: req.user.id,
        isApproved: false,
      });
      return res.json({ message: 'Mosque and photo submitted for admin review', photoUrl: mosque.photoUrl, pending: true });
    }

    if (!mosque) return res.status(404).json({ message: 'Mosque not found' });

    mosque.pendingPhotoUrl = photoUrl;
    mosque.photoSubmittedBy = {
      id: req.user.id, name: req.user.name, email: req.user.email, submittedAt: new Date().toISOString(),
    };
    await mosque.save();

    res.json({ message: 'Photo submitted for admin review', pendingPhotoUrl: mosque.pendingPhotoUrl, pending: true });
  } catch (err) {
    console.error('Photo update error:', err);
    res.status(500).json({ message: 'Server Error' });
  }
});

// ── GET /api/mosques/my-mosques — Mosques added by current user ───────────────
router.get('/my-mosques', protect, async (req, res) => {
  try {
    const mosques = await Mosque.findAll({
      where: { userId: req.user.id },
      order: [['createdAt', 'DESC']],
    });
    res.json(mosques);
  } catch (err) {
    console.error('My mosques error:', err);
    res.status(500).json({ message: 'Server Error' });
  }
});

// ── GET /api/mosques/:id — Single mosque by internal ID or Google Place ID ────
// Registered last so it doesn't shadow any more-specific GET routes above.
router.get('/:id', async (req, res) => {
  try {
    let mosque = null;
    try { mosque = await Mosque.findByPk(req.params.id); } catch { }
    if (!mosque) mosque = await Mosque.findOne({ where: { googlePlaceId: req.params.id } });
    if (!mosque) return res.status(404).json({ message: 'Mosque not found' });

    res.json(mosque.toJSON()); // iqamahTimings getter already returns parsed JSON
  } catch (err) {
    console.error('Single mosque fetch error:', err);
    res.status(500).json({ message: 'Server Error' });
  }
});

module.exports = router;
