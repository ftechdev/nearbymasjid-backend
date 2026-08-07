require('dotenv').config();
const { sequelize } = require('../config/db');
const Mosque = require('../models/Mosque');
const { Op } = require('sequelize');

(async () => {
  try {
    await sequelize.authenticate();
    const pending = await Mosque.findAll({
      where: { pendingPhotoUrl: { [Op.ne]: null } },
      attributes: ['id', 'name', 'pendingPhotoUrl', 'photoUrl', 'photoSubmittedBy'],
    });
    console.log(`\nMosques with pendingPhotoUrl (${pending.length} total):\n`);
    pending.forEach(m => {
      console.log(`Name:            ${m.name}`);
      console.log(`pendingPhotoUrl: ${m.pendingPhotoUrl}`);
      console.log(`photoUrl:        ${m.photoUrl}`);
      console.log(`photoSubmittedBy:`, JSON.stringify(m.photoSubmittedBy));
      console.log('---');
    });

    // Also show all mosques with photoUrl
    const withPhoto = await Mosque.findAll({
      where: { photoUrl: { [Op.ne]: null } },
      attributes: ['id', 'name', 'photoUrl'],
      limit: 10,
    });
    console.log(`\nMosques with live photoUrl (first 10):\n`);
    withPhoto.forEach(m => console.log(`  ${m.name}: ${m.photoUrl}`));
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await sequelize.close();
  }
})();
