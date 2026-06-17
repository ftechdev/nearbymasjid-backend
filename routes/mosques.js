const express = require('express');
const router = express.Router();
const Mosque = require('../models/Mosque');
const { protect } = require('../middleware/auth');

const axios = require('axios');

// Get all approved mosques (and nearby places from Google)
router.get('/', async (req, res) => {
  try {
    const { lat, lng, keyword } = req.query;

    // Validate coordinates if provided
    if (lat || lng) {
      const latNum = parseFloat(lat), lngNum = parseFloat(lng);
      if (isNaN(latNum) || isNaN(lngNum) || latNum < -90 || latNum > 90 || lngNum < -180 || lngNum > 180) {
        return res.status(400).json({ message: 'Invalid latitude or longitude' });
      }
    }

    let mosques = await Mosque.findAll({ where: { isApproved: true } });
    // Convert to plain JSON if coming from Sequelize
    mosques = mosques.map(m => m.toJSON ? m.toJSON() : m);

    // Filter DB mosques by keyword (name or address match)
    if (keyword) {
      const kw = keyword.toLowerCase();
      mosques = mosques.filter(m =>
        m.name?.toLowerCase().includes(kw) ||
        m.address?.toLowerCase().includes(kw)
      );
    }
    
    if (lat && lng && process.env.GOOGLE_MAPS_API_KEY) {
      try {
        const searchKeyword = keyword ? `${keyword} masjid` : 'masjid';
        const googleRes = await axios.get(`https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=5000&type=mosque&keyword=${encodeURIComponent(searchKeyword)}&key=${process.env.GOOGLE_MAPS_API_KEY}`);
        
        if (googleRes.data && googleRes.data.status !== 'OK' && googleRes.data.status !== 'ZERO_RESULTS') {
          console.error('Google Places API Status:', googleRes.data.status, googleRes.data.error_message || '');
        }

        if (googleRes.data && googleRes.data.results) {
          const googleMosques = googleRes.data.results.map(place => {
            // Check if this google masjid already has timings in our DB
            const localMatch = mosques.find(m => m.googlePlaceId === place.place_id);
            
            return {
              id: place.place_id,
              name: place.name,
              address: place.vicinity,
              lat: place.geometry.location.lat,
              lng: place.geometry.location.lng,
              rating: place.rating || 0,
              photoUrl: place.photos && place.photos.length > 0 
                ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photo_reference=${place.photos[0].photo_reference}&key=${process.env.GOOGLE_MAPS_API_KEY}`
                : null,
              iqamahTimings: localMatch ? localMatch.iqamahTimings : null,
              timingsApproved: localMatch ? localMatch.timingsApproved : false,
              isGoogle: true
            };
          });
          
          // Filter out google results that we are already showing from DB to avoid duplicates
          const uniqueGoogle = googleMosques.filter(g => !mosques.some(m => m.googlePlaceId === g.id));
          mosques = [...mosques, ...uniqueGoogle];
        }
      } catch (err) {
        console.error('Google API Request Failed:', err.message);
      }
    }
    
    res.json(mosques);
  } catch (err) {
    console.error('[mosques GET] Fatal error:', err.message, err.stack);
    res.status(500).json({ message: 'Server Error', detail: err.message });
  }
});

// Submit a new mosque
router.post('/', protect, async (req, res) => {
  try {
    const { name, address, location, school, iqamahTimings, photoUrl } = req.body;
    if (!name || !address || !location?.lat) {
      return res.status(400).json({ message: 'Name, address and location are required' });
    }

    // Check for existing mosques at the same location (proximity check ~100m)
    const existingMosques = await Mosque.findAll();
    const threshold = 0.0009; // Approx 100 meters in degrees
    const duplicate = existingMosques.find(m => 
      Math.abs(m.lat - location.lat) < threshold && 
      Math.abs(m.lng - location.lng) < threshold
    );

    if (duplicate) {
      duplicate.name = name;
      duplicate.address = address;
      duplicate.school = school === 'hanafi' ? 'hanafi' : 'shafi';
      if (iqamahTimings) {
        duplicate.iqamahTimings = typeof iqamahTimings === 'string' ? JSON.parse(iqamahTimings) : iqamahTimings;
        duplicate.timingsApproved = false;
        duplicate.timingsSubmittedBy = {
          id: req.user.id,
          name: req.user.name,
          email: req.user.email,
          submittedAt: new Date().toISOString(),
        };
      }
      if (photoUrl) {
        duplicate.photoUrl = photoUrl;
      }
      await duplicate.save();
      return res.status(200).json({
        message: 'Already added masjid has been updated with the new details and timings.',
        mosque: duplicate
      });
    }

    const createdMosque = await Mosque.create({
      name, address, lat: location.lat, lng: location.lng, userId: req.user.id, isApproved: false,
      school: school === 'hanafi' ? 'hanafi' : 'shafi',
      iqamahTimings,
      photoUrl,
      timingsApproved: false
    });
    res.status(201).json(createdMosque);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to submit mosque' });
  }
});

// Photo upload route (Smart: Hostinger primary, Cloudinary fallback)
const multer = require('multer');
const memoryStorage = multer.memoryStorage();
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

const uploadMem = multer({
  storage: memoryStorage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, WebP, and GIF images are allowed'));
    }
  },
});
const { smartUpload } = require('../utils/uploadHandler');

router.post('/upload-photo', protect, (req, res, next) => {
  uploadMem.single('photo')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ message: 'File too large. Maximum size is 5 MB.' });
      }
      return res.status(400).json({ message: err.message || 'Upload error' });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    const photoUrl = await smartUpload(req.file);
    res.json({ photoUrl });
  } catch (err) {
    console.error("Smart Upload Error:", err);
    res.status(500).json({ message: 'Upload failed on all platforms' });
  }
});

// Update mosque timings
router.put('/:id/timings', protect, async (req, res) => {
  try {
    const { iqamahTimings, mosqueData } = req.body;
    let mosque = null;

    // Try finding by internal PK (UUID)
    try {
      mosque = await Mosque.findByPk(req.params.id);
    } catch {}

    // If still not found, try finding by googlePlaceId
    if (!mosque) {
      mosque = await Mosque.findOne({ where: { googlePlaceId: req.params.id } });
    }
    
    // If NOT found and mosqueData is provided, create it as a new DB record
    if (!mosque && mosqueData) {
      mosque = await Mosque.create({
        ...mosqueData,
        userId: req.user.id,
        isApproved: true
      });
    }

    if (!mosque) {
      return res.status(404).json({ message: 'Mosque not found' });
    }

    // Basic validation of the 5 times
    const required = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
    const provided = Object.keys(iqamahTimings || {});
    const isValid = required.every(p => provided.includes(p));

    if (!isValid) {
      return res.status(400).json({ message: 'Please provide all 5 prayer times' });
    }

    // Ensure it's stored correctly as an object (Sequelize JSON handles this)
    mosque.iqamahTimings = typeof iqamahTimings === 'string' ? JSON.parse(iqamahTimings) : iqamahTimings;
    mosque.timingsApproved = false; // Set to false for manual review
    mosque.timingsSubmittedBy = {
      id: req.user.id,
      name: req.user.name,
      email: req.user.email,
      submittedAt: new Date().toISOString(),
    };
    await mosque.save();

    res.json({ message: 'Timings updated successfully', iqamahTimings });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server Error' });
  }
});

// Get mosques added by the current user
router.get('/my-mosques', protect, async (req, res) => {
  try {
    const mosques = await Mosque.findAll({ 
      where: { userId: req.user.id },
      order: [['createdAt', 'DESC']]
    });
    res.json(mosques);
  } catch (err) {
    res.status(500).json({ message: 'Server Error' });
  }
});

module.exports = router;
