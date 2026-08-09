const ftp = require("basic-ftp");
const { Readable } = require('stream');
const path = require('path');
const fs = require('fs');

const FTP_REMOTE_DIR = '/uploads';


const uploadToLocal = async (file) => {
  try {
    const uploadsDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    const fileName = `masjid_${Date.now()}${path.extname(file.originalname || '.jpg')}`;
    const filePath = path.join(uploadsDir, fileName);
    await fs.promises.writeFile(filePath, file.buffer);
    return `/uploads/${fileName}`;
  } catch (err) {
    console.error(`[Local Storage Error] Path: ${path.join(__dirname, '../uploads')} — Reason: ${err.message}`);
    throw new Error(`Local Storage Write Failed: ${err.message}`);
  }
};

/**
 * Tier 2 (Fallback): Hostinger FTP Upload
 * Used as a secondary fallback if local disk write fails.
 */
const uploadToHostinger = async (file) => {
  const client = new ftp.Client(10000);
  client.ftp.verbose = false;
  try {
    await client.access({
      host: process.env.FTP_HOST,
      user: process.env.FTP_USER,
      password: process.env.FTP_PASS,
      port: parseInt(process.env.FTP_PORT, 10) || 21,
      secure: false
    });

    const fileName = `masjid_${Date.now()}${path.extname(file.originalname || '.jpg')}`;

    try { 
      await client.ensureDir(FTP_REMOTE_DIR); 
    } catch(dirErr) {
      console.warn(`[FTP Warning] Could not ensure remote directory ${FTP_REMOTE_DIR}:`, dirErr.message);
    }
    await client.cd('/');

    const source = new Readable();
    source._read = () => {};
    source.push(file.buffer);
    source.push(null);

    await client.uploadFrom(source, `${FTP_REMOTE_DIR}/${fileName}`);

    const apiHost = process.env.API_PUBLIC_URL || `https://${(process.env.FTP_HOST || '').replace(/^ftp\./i, 'api.')}`;
    return `${apiHost}/uploads/${fileName}`;
  } catch (err) {
    console.error(`[FTP Upload Error] Host: ${process.env.FTP_HOST} — Reason: ${err.message}`);
    throw new Error(`Hostinger FTP Upload Failed: ${err.message}`);
  } finally {
    client.close();
  }
};

/**
 * Main Smart Upload Handler
 * Priority 1 (Primary): Local Server Storage (Instant HTTP 200, served directly by Express)
 * Priority 2 (Fallback): Hostinger FTP Storage
 */
const smartUpload = async (file) => {
  let localError = null;

  // ── PRIORITY 1: Local Server Disk Storage (Primary) ──────────────────────
  try {
    console.log("💾 [Priority 1] Saving image to Local Server Storage...");
    const url = await uploadToLocal(file);
    console.log("✅ [Priority 1] Local Storage Success:", url);
    return url;
  } catch (err) {
    localError = err;
    console.warn("⚠️ [Priority 1] Local Storage write failed, trying FTP fallback:", err.message);
  }

  // ── PRIORITY 2: Hostinger FTP Upload (Fallback) ───────────────────────────
  if (process.env.FTP_HOST && process.env.FTP_USER && process.env.FTP_PASS) {
    try {
      console.log("📡 [Priority 2] Attempting Hostinger FTP Fallback...");
      const url = await uploadToHostinger(file);
      console.log("✅ [Priority 2] Hostinger FTP Upload Success:", url);
      return url;
    } catch (ftpErr) {
      console.error("❌ Both Local Storage (Primary) and FTP (Fallback) failed!");
      throw new Error(`Image upload failed on all storage mechanisms. Local Error: (${localError.message}). FTP Error: (${ftpErr.message}).`);
    }
  }

  throw new Error(`Image upload failed. Local storage error: (${localError ? localError.message : 'Write failed'}). No FTP configuration available.`);
};

module.exports = { smartUpload };
