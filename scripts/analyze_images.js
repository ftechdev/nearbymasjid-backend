const { sequelize } = require('../config/db');
const Mosque = require('../models/Mosque');
const Settings = require('../models/Settings');
require('dotenv').config();

async function analyze() {
  try {
    await sequelize.authenticate();

    const mosques = await Mosque.findAll({
      attributes: ['id', 'name', 'photoUrl', 'pendingPhotoUrl', 'isApproved']
    });

    console.log(`\n==================================================`);
    console.log(`         MOSQUE IMAGE ANALYSIS REPORT             `);
    console.log(`==================================================\n`);
    console.log(`Total Mosques in Database: ${mosques.length}\n`);

    let countWithPhotoUrl = 0;
    let countWithPendingPhotoUrl = 0;
    let countNoPhoto = 0;

    const domainCounts = {};
    const categorized = {
      localRelative: [],
      googlePlaces: [],
      fullUrlHostinger: [],
      otherExternal: []
    };

    mosques.forEach(m => {
      const data = m.toJSON();
      const photo = data.photoUrl;
      const pending = data.pendingPhotoUrl;

      if (photo) countWithPhotoUrl++;
      if (pending) countWithPendingPhotoUrl++;
      if (!photo && !pending) countNoPhoto++;

      if (photo) {
        if (photo.startsWith('/uploads/')) {
          categorized.localRelative.push({ id: data.id, name: data.name, photoUrl: photo });
          domainCounts['Relative Path (/uploads/...)'] = (domainCounts['Relative Path (/uploads/...)'] || 0) + 1;
        } else if (photo.includes('maps.googleapis.com')) {
          categorized.googlePlaces.push({ id: data.id, name: data.name, photoUrl: photo });
          domainCounts['Google Places API (maps.googleapis.com)'] = (domainCounts['Google Places API (maps.googleapis.com)'] || 0) + 1;
        } else if (photo.includes('nearbymosque.in')) {
          categorized.fullUrlHostinger.push({ id: data.id, name: data.name, photoUrl: photo });
          domainCounts['Hostinger Domain (nearbymosque.in)'] = (domainCounts['Hostinger Domain (nearbymosque.in)'] || 0) + 1;
        } else {
          categorized.otherExternal.push({ id: data.id, name: data.name, photoUrl: photo });
          domainCounts['Other External URL'] = (domainCounts['Other External URL'] || 0) + 1;
        }
      }
    });

    console.log(`SUMMARY STATS:`);
    console.log(`- Mosques with photoUrl: ${countWithPhotoUrl}`);
    console.log(`- Mosques with pendingPhotoUrl: ${countWithPendingPhotoUrl}`);
    console.log(`- Mosques with NO photo: ${countNoPhoto}\n`);

    console.log(`URL TYPES BREAKDOWN:`);
    Object.entries(domainCounts).forEach(([type, count]) => {
      console.log(`  * ${type}: ${count}`);
    });

    console.log(`\n--------------------------------------------------`);
    console.log(`1. RELATIVE PATHS (/uploads/...) [${categorized.localRelative.length} items]:`);
    categorized.localRelative.forEach(item => {
      console.log(`   - ${item.name}: ${item.photoUrl}`);
    });

    console.log(`\n--------------------------------------------------`);
    console.log(`2. GOOGLE PLACES API IMAGES [${categorized.googlePlaces.length} items]:`);
    categorized.googlePlaces.forEach(item => {
      console.log(`   - ${item.name}: ${item.photoUrl.substring(0, 80)}...`);
    });

    console.log(`\n--------------------------------------------------`);
    console.log(`3. HOSTINGER FULL DOMAIN IMAGES [${categorized.fullUrlHostinger.length} items]:`);
    if (categorized.fullUrlHostinger.length === 0) console.log(`   (None currently using full hostinger domain)`);
    categorized.fullUrlHostinger.forEach(item => {
      console.log(`   - ${item.name}: ${item.photoUrl}`);
    });

    console.log(`\n--------------------------------------------------`);
    console.log(`4. OTHER EXTERNAL IMAGES [${categorized.otherExternal.length} items]:`);
    if (categorized.otherExternal.length === 0) console.log(`   (None)`);
    categorized.otherExternal.forEach(item => {
      console.log(`   - ${item.name}: ${item.photoUrl}`);
    });

    if (countWithPendingPhotoUrl > 0) {
      console.log(`\n--------------------------------------------------`);
      console.log(`5. PENDING PHOTO APPROVALS:`);
      mosques.filter(m => m.pendingPhotoUrl).forEach(m => {
        console.log(`   - ${m.name}: ${m.pendingPhotoUrl}`);
      });
    }

  } catch (err) {
    console.error('Error analyzing database images:', err);
  } finally {
    await sequelize.close();
  }
}

analyze();
