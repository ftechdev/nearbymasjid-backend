/**
 * Fix script: 
 * 1. Fixes pendingPhotoUrl with wrong domain (nearbymosque.in → api.nearbymosque.in)
 * 2. Fixes photoUrl with relative /uploads/ path → full URL with api.nearbymosque.in
 * 
 * Usage: node scripts/fix_photo_url_domains.js
 */
require('dotenv').config();
const { sequelize } = require('../config/db');
const Mosque = require('../models/Mosque');
const { Op } = require('sequelize');

const CORRECT_API_BASE = 'https://api.nearbymosque.in';
const WRONG_DOMAIN = 'https://nearbymosque.in';

(async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ DB connected\n');

    // --- Fix 1: pendingPhotoUrl with wrong domain ---
    const wrongDomainPending = await Mosque.findAll({
      where: { pendingPhotoUrl: { [Op.like]: `${WRONG_DOMAIN}/%` } },
      attributes: ['id', 'name', 'pendingPhotoUrl'],
    });

    console.log(`Fix 1: Found ${wrongDomainPending.length} mosque(s) with wrong domain in pendingPhotoUrl`);
    for (const m of wrongDomainPending) {
      const oldUrl = m.pendingPhotoUrl;
      const newUrl = oldUrl.replace(WRONG_DOMAIN, CORRECT_API_BASE);
      m.pendingPhotoUrl = newUrl;
      await m.save();
      console.log(`  ✅ ${m.name}`);
      console.log(`     OLD: ${oldUrl}`);
      console.log(`     NEW: ${newUrl}`);
    }

    // --- Fix 2: photoUrl that is a relative /uploads/ path ---
    const relativePhotoUrl = await Mosque.findAll({
      where: { photoUrl: { [Op.like]: '/uploads/%' } },
      attributes: ['id', 'name', 'photoUrl'],
    });

    console.log(`\nFix 2: Found ${relativePhotoUrl.length} mosque(s) with relative /uploads/ in photoUrl`);
    for (const m of relativePhotoUrl) {
      const oldUrl = m.photoUrl;
      const newUrl = `${CORRECT_API_BASE}${oldUrl}`;
      m.photoUrl = newUrl;
      await m.save();
      console.log(`  ✅ ${m.name}`);
      console.log(`     OLD: ${oldUrl}`);
      console.log(`     NEW: ${newUrl}`);
    }

    // --- Fix 3: pendingPhotoUrl that is relative /uploads/ path ---
    const relativePendingUrl = await Mosque.findAll({
      where: { pendingPhotoUrl: { [Op.like]: '/uploads/%' } },
      attributes: ['id', 'name', 'pendingPhotoUrl'],
    });

    console.log(`\nFix 3: Found ${relativePendingUrl.length} mosque(s) with relative /uploads/ in pendingPhotoUrl`);
    for (const m of relativePendingUrl) {
      const oldUrl = m.pendingPhotoUrl;
      const newUrl = `${CORRECT_API_BASE}${oldUrl}`;
      m.pendingPhotoUrl = newUrl;
      await m.save();
      console.log(`  ✅ ${m.name}: ${oldUrl} → ${newUrl}`);
    }

    console.log('\n✅ All URL fixes applied.\n');
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await sequelize.close();
  }
})();
