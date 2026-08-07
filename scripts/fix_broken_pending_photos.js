/**
 * Fix script: Clears all pendingPhotoUrl entries that point to /uploads/... paths
 * which only exist on the local dev machine (not on the hosted server).
 * Run this ONCE after deploying the absolute-path fix to Hostinger.
 * 
 * Usage: node scripts/fix_broken_pending_photos.js
 */
require('dotenv').config();
const { sequelize } = require('../config/db');
const Mosque = require('../models/Mosque');
const { Op } = require('sequelize');

(async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ DB connected\n');

    // Find all mosques with pendingPhotoUrl pointing to a local /uploads/ path
    const broken = await Mosque.findAll({
      where: {
        pendingPhotoUrl: { [Op.like]: '/uploads/%' }
      },
      attributes: ['id', 'name', 'pendingPhotoUrl', 'photoUrl'],
    });

    console.log(`Found ${broken.length} mosque(s) with broken local /uploads/ pending photos:\n`);
    broken.forEach(m => {
      console.log(`  - ${m.name}`);
      console.log(`    pendingPhotoUrl: ${m.pendingPhotoUrl}`);
      console.log(`    photoUrl (live): ${m.photoUrl || 'none'}\n`);
    });

    if (broken.length === 0) {
      console.log('Nothing to fix. Exiting.');
      process.exit(0);
    }

    // Clear the broken pendingPhotoUrl and photoSubmittedBy entries
    const [updated] = await Mosque.update(
      { pendingPhotoUrl: null, photoSubmittedBy: null },
      { where: { pendingPhotoUrl: { [Op.like]: '/uploads/%' } } }
    );

    console.log(`✅ Cleared ${updated} broken pending photo record(s).`);
    console.log('   Users can now re-submit their photos — new uploads will save to the hosted server\'s /uploads/ folder correctly.\n');

  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await sequelize.close();
    process.exit(0);
  }
})();
