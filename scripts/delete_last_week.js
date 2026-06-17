const { Op } = require('sequelize');
const Mosque = require('../models/Mosque');
const { connectDB, sequelize } = require('../config/db');

async function run() {
  // Wait for db authentication
  await sequelize.authenticate();
  
  // Calculate the date 7 days ago
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  
  console.log('Finding mosques created since:', sevenDaysAgo.toISOString());
  
  // Find all mosques created in the last 7 days
  const mosquesToDelete = await Mosque.findAll({
    where: {
      createdAt: {
        [Op.gte]: sevenDaysAgo
      }
    }
  });
  
  console.log(`Found ${mosquesToDelete.length} mosques to delete:`);
  mosquesToDelete.forEach(m => {
    console.log(`- ID: ${m.id}, Name: ${m.name}, CreatedAt: ${m.createdAt}`);
  });
  
  if (mosquesToDelete.length > 0) {
    // Delete them
    const deletedCount = await Mosque.destroy({
      where: {
        createdAt: {
          [Op.gte]: sevenDaysAgo
        }
      }
    });
    console.log(`Successfully deleted ${deletedCount} mosques.`);
  } else {
    console.log('No mosques found to delete.');
  }
  
  await sequelize.close();
  process.exit(0);
}

run().catch(err => {
  console.error('Error executing delete script:', err);
  process.exit(1);
});
