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

      if (data && typeof data === 'object' && data.fajr) {
        // Maghrib is always location-based sunset — strip it before returning
        const { maghrib: _m, ...dataWithoutMaghrib } = data;
        return res.json(dataWithoutMaghrib);
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

// GET the Hijri date adjustment (whole days) — astronomical/tabular calculation
// (what the Aladhan API returns) regularly differs by ±1 day from the date
// actually announced by local moon-sighting committees. Admins correct this
// monthly rather than the app silently showing a calculated-but-wrong date.
router.get('/hijri-adjustment', async (req, res) => {
  try {
    const setting = await Settings.findOne({ where: { key: 'hijri_adjustment' } });
    const days = setting?.value?.days;
    res.json({ adjustment: typeof days === 'number' ? days : 0 });
  } catch (error) {
    console.error('Error fetching hijri adjustment:', error);
    res.json({ adjustment: 0 });
  }
});

module.exports = router;
