const { sequelize } = require('../config/db');
const Mosque = require('../models/Mosque');
require('dotenv').config();

const MEDIA_HOST = process.env.MEDIA_PUBLIC_URL || 'https://nearbymosque.in';

async function migratePhotoUrls() {
  try {
    await sequelize.authenticate();
    console.log('✅ DB Connected.\n');

    const mosques = await Mosque.findAll();
    console.log(`Total Mosques in Database: ${mosques.length}`);

    let updatedPhotoCount = 0;
    let updatedPendingCount = 0;

    for (const m of mosques) {
      let changed = false;

      // Update photoUrl if it's a relative path
      if (m.photoUrl && m.photoUrl.startsWith('/uploads/')) {
        const fullUrl = `${MEDIA_HOST}${m.photoUrl}`;
        console.log(`[MIGRATING photoUrl] ${m.name}`);
        console.log(`   Old: ${m.photoUrl}`);
        console.log(`   New: ${fullUrl}`);
        m.photoUrl = fullUrl;
        changed = true;
        updatedPhotoCount++;
      }

      // Update pendingPhotoUrl if it's a relative path
      if (m.pendingPhotoUrl && m.pendingPhotoUrl.startsWith('/uploads/')) {
        const fullPendingUrl = `${MEDIA_HOST}${m.pendingPhotoUrl}`;
        console.log(`[MIGRATING pendingPhotoUrl] ${m.name}`);
        console.log(`   Old: ${m.pendingPhotoUrl}`);
        console.log(`   New: ${fullPendingUrl}`);
        m.pendingPhotoUrl = fullPendingUrl;
        changed = true;
        updatedPendingCount++;
      }

      if (changed) {
        await m.save();
      }
    }

    console.log(`\n==================================================`);
    console.log(`MIGRATION COMPLETE!`);
    console.log(`- Updated photoUrls: ${updatedPhotoCount}`);
    console.log(`- Updated pendingPhotoUrls: ${updatedPendingCount}`);
    console.log(`==================================================\n`);

  } catch (err) {
    console.error('Migration error:', err);
  } finally {
    await sequelize.close();
  }
}

migratePhotoUrls();
