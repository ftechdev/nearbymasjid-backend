const express = require('express');
const router = express.Router();
const Mosque = require('../models/Mosque');
const User = require('../models/User');
const { protect, admin } = require('../middleware/auth');

const { Op } = require('sequelize');

router.get('/health', (req, res) => res.send('Admin API Healthy'));

// 1. Get all mosques (approved or pending) with pagination
router.get('/mosques', protect, admin, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const offset = (page - 1) * limit;

    const { count, rows } = await Mosque.findAndCountAll({
      include: [{ model: User, as: 'addedBy', attributes: ['id', 'name', 'email'] }],
      order: [['createdAt', 'DESC']],
      limit,
      offset,
    });
    let mosques = rows;
    
    // Ensure JSON is parsed properly for all mosques
    mosques = mosques.map(m => {
      let mosque = m.toJSON();
      if (typeof mosque.iqamahTimings === 'string') {
        try { mosque.iqamahTimings = JSON.parse(mosque.iqamahTimings); } catch(e) {}
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
    const pendingMosques = await Mosque.count({ where: { isApproved: false } });
    const pendingPhotos = await Mosque.count({ where: { pendingPhotoUrl: { [Op.ne]: null } } });
    const totalUsers = await User.count();
    res.json({ totalMosques, pendingMosques, pendingPhotos, totalUsers });
  } catch (err) {
    console.error('Admin Analytics Error:', err);
    res.status(500).json({ message: 'Error fetching analytics' });
  }
});

// 3. SPECIFIC ROUTES FIRST (Crucial for Express)
router.put('/mosques/:id/approve-timing', protect, admin, async (req, res) => {
  const mosque = await Mosque.findByPk(req.params.id);
  if (mosque) {
    mosque.timingsApproved = true;
    await mosque.save();
    res.json({ message: 'Timings approved', mosque });
  } else {
    res.status(404).json({ message: 'Mosque not found' });
  }
});

// Approve a pending photo update — makes it the live photo
router.put('/mosques/:id/approve-photo', protect, admin, async (req, res) => {
  const mosque = await Mosque.findByPk(req.params.id);
  if (!mosque) return res.status(404).json({ message: 'Mosque not found' });
  if (!mosque.pendingPhotoUrl) return res.status(400).json({ message: 'No pending photo to approve' });

  mosque.photoUrl = mosque.pendingPhotoUrl;
  mosque.pendingPhotoUrl = null;
  await mosque.save();
  res.json({ message: 'Photo approved', mosque });
});

// Reject a pending photo update — keeps the current live photo unchanged
router.put('/mosques/:id/reject-photo', protect, admin, async (req, res) => {
  const mosque = await Mosque.findByPk(req.params.id);
  if (!mosque) return res.status(404).json({ message: 'Mosque not found' });

  mosque.pendingPhotoUrl = null;
  await mosque.save();
  res.json({ message: 'Photo rejected', mosque });
});

// 4. GENERIC ROUTES LAST
router.put('/mosques/:id', protect, admin, async (req, res) => {
  const mosque = await Mosque.findByPk(req.params.id);
  if (mosque) {
    mosque.isApproved = req.body.isApproved;
    await mosque.save();
    res.json(mosque);
  } else {
    res.status(404).json({ message: 'Mosque not found' });
  }
});

router.delete('/mosques/:id', protect, admin, async (req, res) => {
  const mosque = await Mosque.findByPk(req.params.id);
  if (mosque) {
    await mosque.destroy();
    res.json({ message: 'Mosque removed' });
  } else {
    res.status(404).json({ message: 'Mosque not found' });
  }
});

// ── USER MANAGEMENT ─────────────────────────────────────────
// GET all users
router.get('/users', protect, admin, async (req, res) => {
  try {
    const users = await User.findAll({
      attributes: ['id', 'name', 'email', 'role', 'createdAt'],
      order: [['createdAt', 'DESC']]
    });
    res.json(users);
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
    res.status(500).json({ message: err.message });
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

const AppReview = require('../models/AppReview');

// ── REVIEW MANAGEMENT ───────────────────────────────────────
// GET all reviews for moderation
router.get('/reviews', protect, admin, async (req, res) => {
  try {
    const reviews = await AppReview.findAll({
      include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email'] }],
      order: [['createdAt', 'DESC']]
    });
    res.json(reviews);
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
    await review.destroy();
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
        try { timings = JSON.parse(timings); } catch(e) { timings = null; }
      }
      // Detect corruption (like {"0": "{", "1": "\"" ...})
      if (timings && typeof timings === 'object' && timings['0'] !== undefined) {
        console.error('Detected corrupted settings data in DB, ignoring it.');
        timings = null;
      }
    }

    if (timings && typeof timings === 'object' && timings.fajr) {
      console.log('Returning valid global defaults from DB');
      res.json(timings);
    } else {
      console.log('Returning fallback values (no valid record in DB)');
      res.json({
        fajr: '05:30',
        sunrise: '06:30',
        dhuhr: '13:30',
        asr: '17:00',
        maghrib: '19:00',
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
      try { timings = JSON.parse(timings); } catch(e) { return res.status(400).json({ message: 'Invalid JSON string' }); }
    }

    if (!timings || typeof timings !== 'object' || Array.isArray(timings)) {
      return res.status(400).json({ message: 'Timings must be an object' });
    }

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
    res.json({ message: 'Default timings updated', timings: setting.value });
  } catch (err) {
    console.error('POST default timings error:', err);
    res.status(500).json({ message: 'Server Error', detail: err.message });
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
        maghrib: '19:00',
        isha: '20:30',
        jumma: '13:30'
      };
    }

    const mosque = await Mosque.findByPk(req.params.id);
    if (!mosque) return res.status(404).json({ message: 'Mosque not found' });

    mosque.iqamahTimings = defaultTimings;
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
