const ftp = require("basic-ftp");
const { Readable } = require('stream');
const path = require('path');
const fs = require('fs');

const FTP_URL_PATH = '/uploads';

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

    const source = new Readable();
    source._read = () => {};
    source.push(file.buffer);
    source.push(null);

    // FTP user is chrooted to the uploads directory, so upload to FTP root "/"
    await client.uploadFrom(source, `/${fileName}`);

    const publicHost = (process.env.FTP_HOST || '').replace(/^ftp\./i, '');
    return `https://${publicHost}${FTP_URL_PATH}/${fileName}`;
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
