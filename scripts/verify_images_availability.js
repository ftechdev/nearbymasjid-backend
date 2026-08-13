const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { sequelize } = require('../config/db');
const Mosque = require('../models/Mosque');
require('dotenv').config();

const PUBLIC_DOMAINS = [
  'https://nearbymosque.in',
  'https://api.nearbymosque.in'
];

async function checkUrl(url) {
  try {
    const res = await axios.head(url, {
      timeout: 5000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    return { status: res.status, ok: res.status >= 200 && res.status < 400 };
  } catch (err) {
    if (err.response) {
      // Server responded with status like 404, 403, 500
      return { status: err.response.status, ok: false, error: err.message };
    }
    // Network error / timeout / DNS failure
    return { status: 0, ok: false, error: err.code || err.message };
  }
}

async function verifyImages() {
  try {
    await sequelize.authenticate();
    console.log('✅ Connected to DB. Fetching mosques...\n');

    const mosques = await Mosque.findAll({
      attributes: ['id', 'name', 'photoUrl', 'pendingPhotoUrl']
    });

    const uploadsDir = path.join(__dirname, '../uploads');

    let totalChecked = 0;
    let localExistsCount = 0;
    let localMissingCount = 0;
    let remoteWorkingCount = 0;
    let remote404Count = 0;

    const results = [];

    console.log(`Checking ${mosques.length} mosques...\n`);

    for (const m of mosques) {
      const data = m.toJSON();
      const photoUrl = data.photoUrl;

      if (!photoUrl) continue;
      totalChecked++;

      const itemResult = {
        name: data.name,
        photoUrl: photoUrl,
        localFileExists: null,
        remoteChecks: []
      };

      if (photoUrl.startsWith('/uploads/')) {
        const filename = photoUrl.replace('/uploads/', '');
        const localPath = path.join(uploadsDir, filename);
        itemResult.localFileExists = fs.existsSync(localPath);

        if (itemResult.localFileExists) localExistsCount++;
        else localMissingCount++;

        // Test on public live domains
        let isWorkingRemotely = false;
        for (const domain of PUBLIC_DOMAINS) {
          const fullRemoteUrl = `${domain}${photoUrl}`;
          const check = await checkUrl(fullRemoteUrl);
          itemResult.remoteChecks.push({ domain, fullUrl: fullRemoteUrl, status: check.status, ok: check.ok });
          if (check.ok) isWorkingRemotely = true;
        }

        if (isWorkingRemotely) remoteWorkingCount++;
        else remote404Count++;

      } else if (photoUrl.startsWith('http://') || photoUrl.startsWith('https://')) {
        // Direct URL (e.g. Google Places API)
        const check = await checkUrl(photoUrl);
        itemResult.remoteChecks.push({ domain: 'External/Google', fullUrl: photoUrl, status: check.status, ok: check.ok });
        if (check.ok) remoteWorkingCount++;
        else remote404Count++;
      }

      results.push(itemResult);
    }

    console.log(`==================================================`);
    console.log(`          IMAGE AVAILABILITY VERIFICATION REPORT   `);
    console.log(`==================================================\n`);
    console.log(`Total Images Tested: ${totalChecked}`);
    console.log(`Local Disk Files Exists: ${localExistsCount} / ${totalChecked}`);
    console.log(`Local Disk Files Missing: ${localMissingCount} / ${totalChecked}`);
    console.log(`Remote Web Server Working (HTTP 200 OK): ${remoteWorkingCount} / ${totalChecked}`);
    console.log(`Remote Web Server Broken / 404: ${remote404Count} / ${totalChecked}\n`);

    console.log(`--------------------------------------------------`);
    console.log(`DETAILED STATUS PER IMAGE:\n`);

    results.forEach((item, index) => {
      console.log(`[${index + 1}] ${item.name}`);
      console.log(`    URL: ${item.photoUrl.substring(0, 90)}${item.photoUrl.length > 90 ? '...' : ''}`);
      if (item.localFileExists !== null) {
        console.log(`    Local Disk: ${item.localFileExists ? '✅ EXISTS' : '❌ MISSING (Not on local dev disk)'}`);
      }
      item.remoteChecks.forEach(rc => {
        console.log(`    Live HTTP (${rc.domain}): ${rc.ok ? '✅ 200 OK' : `❌ ${rc.status || 'FAILED'}`}`);
      });
      console.log('');
    });

  } catch (err) {
    console.error('Error verifying images:', err);
  } finally {
    await sequelize.close();
  }
}

verifyImages();
