/**
 * ONE-TIME MIGRATION SCRIPT
 * ─────────────────────────────────────────────────────────────────────────────
 * Strips the stored 'maghrib' key from every mosque's iqamahTimings in the DB.
 *
 * WHY:
 *   Maghrib must always equal the location's exact sunset time (from Aladhan
 *   API). If a fixed maghrib value is stored in iqamahTimings, the old app
 *   version will show that fixed value instead of the live sunset.
 *   Removing it from the DB means even old app users will get the correct
 *   live sunset-based Maghrib time (because the app falls back to the
 *   Aladhan API value when no iqamah is stored).
 *
 * RUN ONCE after deploying the new backend:
 *   node scripts/stripMaghribFromDB.js
 * ─────────────────────────────────────────────────────────────────────────────
 */

require('dotenv').config();
const { sequelize } = require('../config/db');
const Mosque = require('../models/Mosque');

(async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ DB connected.\n');

    // Fetch all mosques that have iqamahTimings stored
    const mosques = await Mosque.findAll({
      where: { iqamahTimings: { [require('sequelize').Op.ne]: null } }
    });

    console.log(`🕌 Found ${mosques.length} mosques with iqamahTimings.`);
    let updated = 0;

    for (const mosque of mosques) {
      const timings = mosque.iqamahTimings;

      // Skip if no timings or already no maghrib key
      if (!timings || typeof timings !== 'object' || !timings.maghrib) continue;

      // Remove maghrib key
      const { maghrib, ...rest } = timings;
      mosque.iqamahTimings = rest;
      mosque.changed('iqamahTimings', true);
      await mosque.save();

      console.log(`  ✔ [${mosque.name}] removed maghrib: "${maghrib}"`);
      updated++;
    }

    console.log(`\n✅ Done. Stripped maghrib from ${updated} mosque(s).`);
    if (updated === 0) {
      console.log('   (No mosques had a stored maghrib — nothing to do.)');
    }
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await sequelize.close();
    process.exit(0);
  }
})();
