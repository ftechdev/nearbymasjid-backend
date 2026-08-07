const ftp = require("basic-ftp");
const { Readable } = require('stream');
const path = require('path');
const fs = require('fs');

// FTP user is chrooted to public_html/uploads/ (the Node.js app root).
// To land files in public_html/uploads/uploads/ (where express.static serves from),
// we upload to /uploads/{filename} on FTP — NOT to root /.
const FTP_REMOTE_DIR = '/uploads';

const uploadToHostinger = async (file) => {
  const client = new ftp.Client(15000);
  client.ftp.verbose = false;
  try {
    await client.access({
      host: process.env.FTP_HOST,
      user: process.env.FTP_USER,
      password: process.env.FTP_PASS,
      port: parseInt(process.env.FTP_PORT) || 21,
      secure: false
    });

    const fileName = `masjid_${Date.now()}${path.extname(file.originalname || '.jpg')}`;

    // Ensure the /uploads directory exists on FTP server
    try { await client.ensureDir(FTP_REMOTE_DIR); } catch(e) {}
    await client.cd('/'); // reset back to root

    const source = new Readable();
    source._read = () => {};
    source.push(file.buffer);
    source.push(null);

    // Upload to /uploads/ so file lands in public_html/uploads/uploads/ on Hostinger
    await client.uploadFrom(source, `${FTP_REMOTE_DIR}/${fileName}`);

    // Return URL via api.nearbymosque.in — served by express.static from uploads/ dir
    const apiHost = process.env.API_PUBLIC_URL || `https://${(process.env.FTP_HOST || '').replace(/^ftp\./i, 'api.')}`;
    return `${apiHost}/uploads/${fileName}`;
  } catch (err) {
    console.error("Hostinger FTP Upload Failed:", err.message);
    throw err;
  } finally {
    client.close();
  }
};

const uploadToLocal = async (file) => {
  const uploadsDir = path.join(__dirname, '../uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  const fileName = `masjid_${Date.now()}${path.extname(file.originalname || '.jpg')}`;
  const filePath = path.join(uploadsDir, fileName);
  await fs.promises.writeFile(filePath, file.buffer);
  // Return relative URL — resolveImageUrl() in the app prepends API_BASE_URL
  return `/uploads/${fileName}`;
};

const smartUpload = async (file) => {
  // Tier 1: Local server disk storage (~50ms, no timeout risk).
  // express.static now uses path.join(__dirname, 'uploads') so files are served correctly.
  try {
    console.log("💾 Saving image to local server storage...");
    const url = await uploadToLocal(file);
    console.log("✅ Local upload success:", url);
    return url;
  } catch (err) {
    console.warn("⚠️  Local storage failed:", err.message);
  }

  // Tier 2: Hostinger FTP fallback — durable cross-server storage
  if (process.env.FTP_USER && process.env.FTP_PASS && process.env.FTP_HOST) {
    try {
      console.log("📡 Trying Hostinger FTP fallback...");
      const url = await uploadToHostinger(file);
      console.log("✅ FTP upload success:", url);
      return url;
    } catch (err) {
      console.warn("⚠️  FTP fallback failed:", err.message);
    }
  }

  throw new Error("All upload methods failed.");
};

module.exports = { smartUpload };
