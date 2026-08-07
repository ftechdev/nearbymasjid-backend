/**
 * End-to-end FTP upload test:
 * 1. Uploads a small test image via FTP
 * 2. Verifies it's accessible via the live API URL
 * Usage: node scripts/test_ftp_upload_e2e.js
 */
const ftp = require('basic-ftp');
const { Readable } = require('stream');
const https = require('https');
require('dotenv').config();

// 1x1 green pixel PNG (minimal valid PNG, ~68 bytes)
const TEST_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108020000009001' +
  '2e0000000c4944415478016360f8cfc000000002000173e3b9910000000049454e44ae426082',
  'hex'
);

const fileName = `masjid_ftp_test_${Date.now()}.png`;

function checkUrl(url) {
  return new Promise((resolve) => {
    https.get(url, (res) => resolve(res.statusCode)).on('error', () => resolve(0));
  });
}

(async () => {
  const client = new ftp.Client(15000);
  client.ftp.verbose = false;

  try {
    console.log('1️⃣  Connecting to FTP...');
    await client.access({
      host: process.env.FTP_HOST,
      user: process.env.FTP_USER,
      password: process.env.FTP_PASS,
      port: parseInt(process.env.FTP_PORT) || 21,
      secure: false,
    });
    console.log('   ✅ Connected');

    console.log(`2️⃣  Uploading test file: ${fileName}`);
    const source = new Readable();
    source._read = () => {};
    source.push(TEST_PNG);
    source.push(null);

    // Ensure /uploads directory exists
    try { await client.ensureDir('/uploads'); } catch(e) {}
    await client.cd('/');

    // Upload to /uploads/ so file lands in public_html/uploads/uploads/ on Hostinger
    await client.uploadFrom(source, `/uploads/${fileName}`);
    console.log('   ✅ FTP upload done');

    // The URL the app will use
    const fileUrl = `https://api.nearbymosque.in/uploads/${fileName}`;
    console.log(`3️⃣  Checking URL: ${fileUrl}`);

    await new Promise(r => setTimeout(r, 2000)); // wait 2s for server to register
    const status = await checkUrl(fileUrl);
    if (status === 200) {
      console.log(`   ✅ HTTP ${status} — Image is LIVE and accessible!`);
      console.log(`\n🟢 FTP is working end-to-end!`);
      console.log(`   Open in browser: ${fileUrl}`);
    } else {
      console.log(`   ❌ HTTP ${status} — File uploaded but not accessible via URL`);
      console.log(`   This means express.static still needs to be restarted on Hostinger.`);
    }

    // Cleanup: delete test file
    try { await client.remove(`/${fileName}`); console.log('   🗑️  Test file cleaned up'); } catch(e) {}

  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    client.close();
  }
})();
