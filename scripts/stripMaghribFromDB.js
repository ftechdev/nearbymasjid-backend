/**
 * ONE-TIME MIGRATION SCRIPT
 * Strips the stored 'maghrib' key from every mosque's iqamahTimings in the DB.
 * Run once after deploying the new backend:
 *   node scripts/stripMaghribFromDB.js
 */

require('dotenv').config();
const { sequelize } = require('../config/db');
const Mosque = require('../models/Mosque');

(async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ DB connected.\n');

    // Fetch ALL mosques — filter in JS to avoid Sequelize Op import issues
    const allMosques = await Mosque.findAll();
    const mosques = allMosques.filter(m => {
      const t = m.iqamahTimings;
      return t && typeof t === 'object' && t.maghrib;
    });

    console.log(`🕌 Total mosques: ${allMosques.length}`);
    console.log(`🕌 Mosques with stored maghrib: ${mosques.length}`);

    if (mosques.length === 0) {
      console.log('\n✅ Nothing to do — no mosque has a stored maghrib value.');
      return;
    }

    let updated = 0;
    for (const mosque of mosques) {
      const timings = mosque.iqamahTimings;
      const { maghrib, ...rest } = timings;
      mosque.iqamahTimings = rest;
      mosque.changed('iqamahTimings', true);
      await mosque.save();
      console.log(`  ✔ [${mosque.name}] removed stored maghrib: "${maghrib}"`);
      updated++;
    }

    console.log(`\n✅ Done. Stripped maghrib from ${updated} mosque(s).`);
  } catch (err) {
    console.error('❌ Error details:');
    console.error(err);
  } finally {
    try { await sequelize.close(); } catch {}
    process.exit(0);
  }
})();

