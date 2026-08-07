/**
 * Uploads all local /uploads/ images to the Hostinger server via FTP.
 * Run once after confirming FTP credentials work.
 * Usage: node scripts/ftp_seed_uploads.js
 */
const ftp = require('basic-ftp');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
require('dotenv').config();

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

(async () => {
  const client = new ftp.Client(30000);
  client.ftp.verbose = false;

  try {
    console.log('📡 Connecting to FTP...');
    await client.access({
      host: process.env.FTP_HOST,
      user: process.env.FTP_USER,
      password: process.env.FTP_PASS,
      port: parseInt(process.env.FTP_PORT) || 21,
      secure: false,
    });
    console.log('✅ FTP connected\n');

    // Ensure /uploads directory exists
    try { await client.ensureDir('/uploads'); } catch (e) {}

    const files = fs.readdirSync(UPLOADS_DIR).filter(f => !f.startsWith('.'));
    console.log(`Found ${files.length} local files to upload:\n`);

    for (const filename of files) {
      const localPath = path.join(UPLOADS_DIR, filename);
      const remotePath = `/uploads/${filename}`;
      const stat = fs.statSync(localPath);
      
      try {
        // Check if file already exists on server
        const list = await client.list('/uploads');
        const exists = list.find(f => f.name === filename);
        if (exists) {
          console.log(`⏭️  ${filename} — already on server (${(stat.size/1024).toFixed(1)}KB), skipping`);
          continue;
        }

        process.stdout.write(`⬆️  Uploading ${filename} (${(stat.size/1024).toFixed(1)}KB)... `);
        await client.uploadFrom(localPath, remotePath);
        console.log('✅ Done');
      } catch (err) {
        console.log(`❌ Failed: ${err.message}`);
      }
    }

    // List what's now on the server
    const serverFiles = await client.list('/uploads');
    console.log(`\n📂 Server /uploads/ now contains (${serverFiles.length} files):`);
    serverFiles.forEach(f => console.log(`  - ${f.name} (${(f.size/1024).toFixed(1)}KB)`));

    console.log('\n🌐 Accessible URLs:');
    const host = process.env.FTP_HOST.replace(/^ftp\./i, '');
    serverFiles.forEach(f => console.log(`  https://${host}/uploads/${f.name}`));

  } catch (err) {
    console.error('❌ FTP Error:', err.message);
  } finally {
    client.close();
  }
})();
