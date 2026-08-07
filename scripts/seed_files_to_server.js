/**
 * Uploads local /uploads/ image files to the hosted server via the 
 * temporary /api/admin/seed-file endpoint.
 * 
 * Run AFTER Hostinger has redeployed the backend with the new endpoint.
 * Usage: node scripts/seed_files_to_server.js
 */
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
require('dotenv').config();

const SERVER = 'https://api.nearbymosque.in';
const SECRET = 'seed_masjid_2026_xK9mP';
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

// Only seed files that are referenced in the DB (don't send unnecessary data)
const FILES_TO_SEED = [
  'masjid_1786107600040.png',  // Ashok nagar masjid - current live photoUrl
  'masjid_1786109614901.png',  // Dewan sah - current live photoUrl
  'masjid_1786106965355.png',  // backup
  'masjid_1786109491374.jpg',  // backup
];

(async () => {
  console.log('📡 Seeding local files to hosted server...\n');
  
  for (const filename of FILES_TO_SEED) {
    const filePath = path.join(UPLOADS_DIR, filename);
    if (!fs.existsSync(filePath)) {
      console.log(`⚠️  Skipping (not found locally): ${filename}`);
      continue;
    }

    try {
      const form = new FormData();
      form.append('file', fs.createReadStream(filePath), filename);

      const res = await axios.post(
        `${SERVER}/api/admin/seed-file?filename=${encodeURIComponent(filename)}`,
        form,
        {
          headers: {
            ...form.getHeaders(),
            'x-seed-secret': SECRET,
          },
          maxBodyLength: Infinity,
          timeout: 30000,
        }
      );
      console.log(`✅ ${filename} → ${SERVER}${res.data.url}`);
    } catch (err) {
      const msg = err.response?.data?.message || err.message;
      console.error(`❌ ${filename}: ${msg}`);
    }
  }

  console.log('\n✅ Seeding complete!');
  console.log('Now verify with:');
  FILES_TO_SEED.forEach(f => console.log(`  ${SERVER}/uploads/${f}`));
})();
