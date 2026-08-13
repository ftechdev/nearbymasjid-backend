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

// ── Whitelist of allowed fields from client-supplied mosqueData ────────────────
// SECURITY: prevents clients from injecting arbitrary columns (userId, isApproved…)
function sanitiseMosqueData(raw) {
  const { name, address, lat, lng, googlePlaceId, school } = raw || {};
  return { name, address, lat, lng, googlePlaceId, school };
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

          googleMosques = (googleRes.data?.results || []).map(place => {
            const localMatch = mosques.find(m => m.googlePlaceId === place.place_id);
            return {
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
              iqamahTimings: localMatch ? localMatch.iqamahTimings : null,
              timingsApproved: localMatch ? localMatch.timingsApproved : false,
              isGoogle: true,
            };
          });

          await cacheSet(cacheKey, googleMosques, GOOGLE_CACHE_TTL_SECONDS);
        } catch (err) {
          
          console.error('Google API Request Failed:', err.message);
          googleMosques = [];
        }
      }

      // De-duplicate: skip Google results already in our DB
      const uniqueGoogle = googleMosques.filter(g => !mosques.some(m => m.googlePlaceId === g.id));
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
      duplicate.school  = school === 'hanafi' ? 'hanafi' : 'shafi';
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

    // First-ever photo for a Google-sourced mosque not yet in our DB — goes live immediately.
    // SECURITY: whitelist fields.
    if (!mosque && mosqueData) {
      mosque = await Mosque.create({
        ...sanitiseMosqueData(mosqueData),
        photoUrl,
        userId: req.user.id,
        isApproved: true,
      });
      return res.json({ message: 'Photo added successfully', photoUrl: mosque.photoUrl, pending: false });
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
