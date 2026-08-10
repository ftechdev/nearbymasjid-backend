const express = require('express');
const router = express.Router();
const Settings = require('../models/Settings');

// GET public settings (e.g. default timings)
router.get('/default-timings', async (req, res) => {
  try {
    const setting = await Settings.findOne({ where: { key: 'default_timings' } });
    if (setting) {
      let data = setting.value;

      // Handle corrupted indexed object strings
      if (data && typeof data === 'object' && data['0'] !== undefined && data['1'] !== undefined) {
         console.log('Public API detected corrupted settings in DB, ignoring.');
         data = null;
      }

      if (data) {
        // Maghrib is always location-based sunset — never a fixed stored default
        const { maghrib: _m, ...dataWithoutMaghrib } = (typeof data === 'object' ? data : {});
        return res.json(Object.keys(dataWithoutMaghrib).length ? dataWithoutMaghrib : null || (() => { throw new Error('empty'); })());
      }
    }

    // Standard Fallback (maghrib intentionally omitted — always equals location sunset)
    res.json({
      fajr: '05:30',
      sunrise: '06:30',
      dhuhr: '13:30',
      asr: '17:00',
      isha: '20:30',
      jumma: '13:30'
    });
  } catch (error) {
    console.error('Error fetching public default timings:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
