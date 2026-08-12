const express = require('express');
const router = express.Router();
const Mosque = require('../models/Mosque');
const User = require('../models/User');
const Quote = require('../models/Quote');
const AppReview = require('../models/AppReview');
const { protect, admin } = require('../middleware/auth');
const { cacheDel } = require('../config/redis');

const { Op } = require('sequelize');

// Must match APPROVED_REVIEWS_CACHE_KEY in routes/reviews.js
const APPROVED_REVIEWS_CACHE_KEY = 'reviews:approved';

router.get('/health', (req, res) => res.send('Admin API Healthy'));

// ONE-TIME MIGRATION — strip stored maghrib from all mosque iqamahTimings
// GET /api/admin/migrate/strip-maghrib  (requires admin login)
router.get('/migrate/strip-maghrib', protect, admin, async (req, res) => {
  try {
    const allMosques = await Mosque.findAll();
    const results = [];
    for (const mosque of allMosques) {
      const t = mosque.iqamahTimings;
      if (t && typeof t === 'object' && t.maghrib) {
        const { maghrib, ...rest } = t;
        mosque.iqamahTimings = rest;
        mosque.changed('iqamahTimings', true);
        await mosque.save();
        results.push({ name: mosque.name, removed: maghrib });
      }
    }
    res.json({
      message: `Done. Stripped maghrib from ${results.length} of ${allMosques.length} mosque(s).`,
      updated: results
    });
  } catch (err) {
    res.status(500).json({ message: 'Migration failed', error: err.message });
  }
});

// 1. Get all mosques (approved or pending) with pagination
// ?pendingPhotos=true switches to the photo-moderation queue (all mosques with a
// pending photo submission, regardless of which page they'd normally fall on).
router.get('/mosques', protect, admin, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(500, parseInt(req.query.limit) || 50);
    const offset = (page - 1) * limit;
    const pendingPhotosOnly = req.query.pendingPhotos === 'true';

    const { count, rows } = await Mosque.findAndCountAll({
      where: pendingPhotosOnly ? { pendingPhotoUrl: { [Op.ne]: null } } : undefined,
      include: [{ model: User, as: 'addedBy', attributes: ['id', 'name', 'email'] }],
      order: [[pendingPhotosOnly ? 'updatedAt' : 'createdAt', 'DESC']],
      limit,
      offset,
    });
    let mosques = rows;

    // Ensure JSON is parsed properly for all mosques
    mosques = mosques.map(m => {
      let mosque = m.toJSON();
      if (typeof mosque.iqamahTimings === 'string') {
        try { mosque.iqamahTimings = JSON.parse(mosque.iqamahTimings); } catch (e) { }
      }
      return mosque;
    });

    res.json({ mosques, total: count, page, totalPages: Math.ceil(count / limit) });
  } catch (err) {
    console.error('Admin Mosques Error:', err);
    res.status(500).json({ message: 'Error fetching mosques' });
  }
});

// 2. Get basic analytics
router.get('/analytics', protect, admin, async (req, res) => {
  try {
    const totalMosques = await Mosque.count();
    const approvedMosques = await Mosque.count({ where: { isApproved: true } });
    const pendingMosques = await Mosque.count({ where: { isApproved: false } });
    const pendingPhotos = await Mosque.count({ where: { pendingPhotoUrl: { [Op.ne]: null } } });
    const totalUsers = await User.count();
    const totalQuotes = await Quote.count();
    const totalReviews = await AppReview.count();
    res.json({ totalMosques, approvedMosques, pendingMosques, pendingPhotos, totalUsers, totalQuotes, totalReviews });
  } catch (err) {
    console.error('Admin Analytics Error:', err);
    res.status(500).json({ message: 'Error fetching analytics' });
  }
});

// 3. SPECIFIC ROUTES FIRST (Crucial for Express)
router.put('/mosques/:id/approve-timing', protect, admin, async (req, res) => {
  try {
    const mosque = await Mosque.findByPk(req.params.id);
    if (!mosque) return res.status(404).json({ message: 'Mosque not found' });
    mosque.timingsApproved = true;
    await mosque.save();
    res.json({ message: 'Timings approved', mosque });
  } catch (err) {
    console.error('Approve timing error:', err);
    res.status(500).json({ message: 'Server Error' });
  }
});

// Approve a pending photo update — makes it the live photo
router.put('/mosques/:id/approve-photo', protect, admin, async (req, res) => {
  try {
    const mosque = await Mosque.findByPk(req.params.id);
    if (!mosque) return res.status(404).json({ message: 'Mosque not found' });
    if (!mosque.pendingPhotoUrl) return res.status(400).json({ message: 'No pending photo to approve' });
    mosque.photoUrl = mosque.pendingPhotoUrl;
    mosque.pendingPhotoUrl = null;
    await mosque.save();
    res.json({ message: 'Photo approved', mosque });
  } catch (err) {
    console.error('Approve photo error:', err);
    res.status(500).json({ message: 'Server Error' });
  }
});

// Reject a pending photo update — keeps the current live photo unchanged
router.put('/mosques/:id/reject-photo', protect, admin, async (req, res) => {
  try {
    const mosque = await Mosque.findByPk(req.params.id);
    if (!mosque) return res.status(404).json({ message: 'Mosque not found' });
    mosque.pendingPhotoUrl = null;
    await mosque.save();
    res.json({ message: 'Photo rejected', mosque });
  } catch (err) {
    console.error('Reject photo error:', err);
    res.status(500).json({ message: 'Server Error' });
  }
});


// 4. GENERIC ROUTES LAST — Full mosque update by admin
router.put('/mosques/:id', protect, admin, async (req, res) => {
  try {
    const mosque = await Mosque.findByPk(req.params.id);
    if (!mosque) return res.status(404).json({ message: 'Mosque not found' });

    const { isApproved, name, address, school, photoUrl, iqamahTimings, timingsApproved, lat, lng } = req.body;

    if (isApproved !== undefined) mosque.isApproved = isApproved;
    if (name !== undefined) mosque.name = name;
    if (address !== undefined) mosque.address = address;
    if (school !== undefined) mosque.school = school;
    if (photoUrl !== undefined) mosque.photoUrl = photoUrl;
    if (timingsApproved !== undefined) mosque.timingsApproved = timingsApproved;
    if (lat !== undefined && !isNaN(parseFloat(lat))) mosque.lat = parseFloat(lat);
    if (lng !== undefined && !isNaN(parseFloat(lng))) mosque.lng = parseFloat(lng);
    if (iqamahTimings !== undefined) {
      const raw = typeof iqamahTimings === 'string' ? JSON.parse(iqamahTimings) : iqamahTimings;
      // Maghrib is always location-based sunset — never store it as a fixed iqamah time
      delete raw.maghrib;
      mosque.iqamahTimings = raw;
    }

    await mosque.save();
    res.json(mosque);
  } catch (err) {
    console.error('Admin mosque update error:', err);
    res.status(500).json({ message: 'Server Error' });
  }
});


router.delete('/mosques/:id', protect, admin, async (req, res) => {
  try {
    const mosque = await Mosque.findByPk(req.params.id);
    if (!mosque) return res.status(404).json({ message: 'Mosque not found' });
    await mosque.destroy();
    res.json({ message: 'Mosque removed' });
  } catch (err) {
    console.error('Admin mosque delete error:', err);
    res.status(500).json({ message: 'Server Error' });
  }
});

// ── USER MANAGEMENT ─────────────────────────────────────────
// GET all users (paginated)
router.get('/users', protect, admin, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(500, parseInt(req.query.limit) || 100);
    const offset = (page - 1) * limit;

    const { count, rows } = await User.findAndCountAll({
      attributes: ['id', 'name', 'email', 'role', 'createdAt'],
      order: [['createdAt', 'DESC']],
      limit,
      offset,
    });
    res.json({ users: rows, total: count, page, totalPages: Math.ceil(count / limit) });
  } catch (err) {
    res.status(500).json({ message: 'Server Error' });
  }
});

// POST create a new admin account
router.post('/users/create-admin', protect, admin, async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email and password are required' });
    }
    const exists = await User.findOne({ where: { email } });
    if (exists) {
      return res.status(400).json({ message: 'User with this email already exists' });
    }
    const user = await User.create({ name, email, password, role: 'admin' });
    res.status(201).json({ id: user.id, name: user.name, email: user.email, role: user.role });
  } catch (err) {
    console.error('create-admin error:', err);
    res.status(500).json({ message: 'Failed to create admin account' });
  }
});

// PUT change user role (promote/demote)
router.put('/users/:id/role', protect, admin, async (req, res) => {
  try {
    const { role } = req.body;
    if (!['user', 'admin'].includes(role)) {
      return res.status(400).json({ message: 'Invalid role' });
    }
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    user.role = role;
    await user.save();
    res.json({ message: `User role updated to ${role}`, user: { id: user.id, name: user.name, role: user.role } });
  } catch (err) {
    res.status(500).json({ message: 'Server Error' });
  }
});

// DELETE a user
router.delete('/users/:id', protect, admin, async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    await user.destroy();
    res.json({ message: 'User deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Server Error' });
  }
});

// ── REVIEW MANAGEMENT ───────────────────────────────────────
// GET all reviews for moderation (paginated)
router.get('/reviews', protect, admin, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(500, parseInt(req.query.limit) || 100);
    const offset = (page - 1) * limit;

    const { count, rows } = await AppReview.findAndCountAll({
      include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email'] }],
      order: [['createdAt', 'DESC']],
      limit,
      offset,
    });
    res.json({ reviews: rows, total: count, page, totalPages: Math.ceil(count / limit) });
  } catch (err) {
    res.status(500).json({ message: 'Server Error' });
  }
});

// PUT approve a review
router.put('/reviews/:id/approve', protect, admin, async (req, res) => {
  try {
    const review = await AppReview.findByPk(req.params.id);
    if (!review) return res.status(404).json({ message: 'Review not found' });
    review.isApproved = true;
    await review.save();
    await cacheDel(APPROVED_REVIEWS_CACHE_KEY);
    res.json({ message: 'Review approved', review });
  } catch (err) {
    res.status(500).json({ message: 'Server Error' });
  }
});

// DELETE a review
router.delete('/reviews/:id', protect, admin, async (req, res) => {
  try {
    const review = await AppReview.findByPk(req.params.id);
    if (!review) return res.status(404).json({ message: 'Review not found' });
    const wasApproved = review.isApproved;
    await review.destroy();
    if (wasApproved) await cacheDel(APPROVED_REVIEWS_CACHE_KEY);
    res.json({ message: 'Review deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Server Error' });
  }
});

// ── SETTINGS MANAGEMENT ─────────────────────────────────────
const Settings = require('../models/Settings');

// GET default timings
router.get('/settings/default-timings', protect, admin, async (req, res) => {
  try {
    console.log('GET /settings/default-timings requested by:', req.user.email);
    const setting = await Settings.findOne({ where: { key: 'default_timings' } });

    let timings = null;
    if (setting) {
      timings = setting.value;
      // Handle cases where data might be a string in the DB or corrupted as an indexed object
      if (typeof timings === 'string') {
        try { timings = JSON.parse(timings); } catch (e) { timings = null; }
      }
      // Detect corruption (like {"0": "{", "1": "\"" ...})
      if (timings && typeof timings === 'object' && timings['0'] !== undefined) {
        console.error('Detected corrupted settings data in DB, ignoring it.');
        timings = null;
      }
    }

    if (timings && typeof timings === 'object' && timings.fajr) {
      console.log('Returning valid global defaults from DB');
      // Maghrib is always derived from location-based sunset — never a fixed stored value
      const { maghrib: _m, ...timingsWithoutMaghrib } = timings;
      res.json(timingsWithoutMaghrib);
    } else {
      console.log('Returning fallback values (no valid record in DB)');
      res.json({
        fajr: '05:30',
        sunrise: '06:30',
        dhuhr: '13:30',
        asr: '17:00',
        // maghrib intentionally omitted — always equals location sunset
        isha: '20:30',
        jumma: '13:30'
      });
    }
  } catch (err) {
    console.error('GET default timings error:', err);
    res.status(500).json({ message: 'Server Error' });
  }
});

// POST/PUT update default timings
router.post('/settings/default-timings', protect, admin, async (req, res) => {
  try {
    let { timings } = req.body;
    console.log('POST /settings/default-timings - Received:', typeof timings, JSON.stringify(timings));

    // Ensure timings is a proper object
    if (typeof timings === 'string') {
      try { timings = JSON.parse(timings); } catch (e) { return res.status(400).json({ message: 'Invalid JSON string' }); }
    }

    if (!timings || typeof timings !== 'object' || Array.isArray(timings)) {
      return res.status(400).json({ message: 'Timings must be an object' });
    }

    // Maghrib is always equal to location-based sunset — never stored as a fixed value
    delete timings.maghrib;
    console.log('Maghrib stripped from default timings (always equals location sunset).');

    let setting = await Settings.findOne({ where: { key: 'default_timings' } });

    if (setting) {
      console.log('Updating existing settings record...');
      setting.value = timings;
      setting.changed('value', true);
      await setting.save();
    } else {
      console.log('Creating new settings record...');
      setting = await Settings.create({ key: 'default_timings', value: timings });
    }

    console.log('Save successful.');
    // Return without maghrib so frontend knows it's not stored
    const { maghrib: _m, ...returnTimings } = setting.value || timings;
    res.json({ message: 'Default timings updated', timings: returnTimings });
  } catch (err) {
    console.error('POST default timings error:', err);
    res.status(500).json({ message: 'Server Error' });
  }
});

// GET Hijri date adjustment (whole days, e.g. -1, 0, +1)
router.get('/settings/hijri-adjustment', protect, admin, async (req, res) => {
  try {
    const setting = await Settings.findOne({ where: { key: 'hijri_adjustment' } });
    const days = setting?.value?.days;
    res.json({ adjustment: typeof days === 'number' ? days : 0 });
  } catch (err) {
    console.error('GET hijri adjustment error:', err);
    res.status(500).json({ message: 'Server Error' });
  }
});

// POST/PUT update Hijri date adjustment
router.post('/settings/hijri-adjustment', protect, admin, async (req, res) => {
  try {
    const days = parseInt(req.body.adjustment, 10);
    if (isNaN(days) || days < -3 || days > 3) {
      return res.status(400).json({ message: 'Adjustment must be a whole number between -3 and 3' });
    }

    let setting = await Settings.findOne({ where: { key: 'hijri_adjustment' } });
    if (setting) {
      setting.value = { days };
      setting.changed('value', true);
      await setting.save();
    } else {
      setting = await Settings.create({ key: 'hijri_adjustment', value: { days } });
    }

    res.json({ message: 'Hijri adjustment updated', adjustment: days });
  } catch (err) {
    console.error('POST hijri adjustment error:', err);
    res.status(500).json({ message: 'Server Error' });
  }
});

// POST apply default timings to a specific mosque
router.post('/mosques/:id/apply-default-timings', protect, admin, async (req, res) => {
  try {
    let defaultTimings;
    const setting = await Settings.findOne({ where: { key: 'default_timings' } });

    if (setting) {
      defaultTimings = setting.value;
    } else {
      defaultTimings = {
        fajr: '05:30',
        dhuhr: '13:30',
        asr: '17:00',
        // maghrib intentionally omitted — always equals location-based sunset
        isha: '20:30',
        jumma: '13:30'
      };
    }

    // Maghrib is always location-based sunset — never stored as fixed iqamah timing
    const { maghrib: _m, ...timingsWithoutMaghrib } = (defaultTimings || {});

    const mosque = await Mosque.findByPk(req.params.id);
    if (!mosque) return res.status(404).json({ message: 'Mosque not found' });

    mosque.iqamahTimings = timingsWithoutMaghrib;
    mosque.timingsApproved = true;
    mosque.timingsSubmittedBy = {
      id: req.user.id,
      name: 'System (Admin Default)',
      submittedAt: new Date().toISOString()
    };
    await mosque.save();

    res.json({ message: 'Default timings applied', mosque });
  } catch (err) {
    console.error('Apply Default Timings Error:', err);
    res.status(500).json({ message: 'Server Error' });
  }
});

module.exports = router;
