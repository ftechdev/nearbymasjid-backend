const ftp = require('basic-ftp');
const { sequelize } = require('../config/db');
const Mosque = require('../models/Mosque');
require('dotenv').config();

async function checkFtpAndDb() {
  const client = new ftp.Client(10000);
  client.ftp.verbose = false;

  try {
    await sequelize.authenticate();
    console.log('✅ DB Connected.');

    const mosques = await Mosque.findAll({
      attributes: ['id', 'name', 'photoUrl', 'pendingPhotoUrl']
    });

    console.log(`Total DB mosques: ${mosques.length}`);

    await client.access({
      host: process.env.FTP_HOST,
      user: process.env.FTP_USER,
      password: process.env.FTP_PASS,
      port: parseInt(process.env.FTP_PORT) || 21,
    });
    console.log('✅ Connected to Hostinger FTP.\n');

    // List root and /uploads
    const rootList = await client.list();
    console.log(`FTP Root files count: ${rootList.length}`);

    let uploadsList = [];
    try {
      uploadsList = await client.list('/uploads');
      console.log(`FTP /uploads files count: ${uploadsList.length}`);
    } catch(e) {
      console.log('Error listing /uploads on FTP:', e.message);
    }

    const ftpFileNames = new Set(uploadsList.map(f => f.name));
    const rootFileNames = new Set(rootList.map(f => f.name));

    console.log('\n--- Checking DB photoUrls against FTP files ---');

    let inUploadsCount = 0;
    let inRootCount = 0;
    let missingCount = 0;

    mosques.forEach(m => {
      const url = m.photoUrl;
      if (!url) return;

      if (url.startsWith('/uploads/')) {
        const fname = url.replace('/uploads/', '');
        if (ftpFileNames.has(fname)) {
          inUploadsCount++;
        } else if (rootFileNames.has(fname)) {
          inRootCount++;
          console.log(`[FOUND IN FTP ROOT] ${m.name} -> ${fname}`);
        } else {
          missingCount++;
          console.log(`[MISSING ON FTP] ${m.name} -> ${fname}`);
        }
      }
    });

    console.log(`\nSUMMARY:`);
    console.log(`- Files found in /uploads: ${inUploadsCount}`);
    console.log(`- Files found in FTP root: ${inRootCount}`);
    console.log(`- Files missing from FTP: ${missingCount}`);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    client.close();
    await sequelize.close();
  }
}

checkFtpAndDb();
