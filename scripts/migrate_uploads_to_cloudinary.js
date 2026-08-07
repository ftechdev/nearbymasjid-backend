// Script to upload existing local images to Cloudinary and print their new URLs
const cloudinary = require('cloudinary').v2;
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const uploadsDir = path.join(__dirname, '..', 'uploads');
const files = fs.readdirSync(uploadsDir);

(async () => {
  console.log(`Found ${files.length} files to upload...\n`);
  for (const file of files) {
    const filePath = path.join(uploadsDir, file);
    try {
      const result = await cloudinary.uploader.upload(filePath, {
        folder: 'masjid_photos',
        public_id: path.parse(file).name,
        overwrite: true,
      });
      console.log(`✅ ${file}`);
      console.log(`   OLD: /uploads/${file}`);
      console.log(`   NEW: ${result.secure_url}\n`);
    } catch (err) {
      console.error(`❌ ${file}: ${err.message}`);
    }
  }
})();
