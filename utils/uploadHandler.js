const ftp = require("basic-ftp");
const cloudinary = require('cloudinary').v2;
const { Readable } = require('stream');
const path = require('path');
const fs = require('fs');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const FTP_UPLOAD_DIR = '/uploads';

const uploadToHostinger = async (file) => {
  const client = new ftp.Client(15000); // 15s timeout so a hung connection fails fast into the Cloudinary/local fallback
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
    const remotePath = `${FTP_UPLOAD_DIR}/${fileName}`;

    try { await client.ensureDir(FTP_UPLOAD_DIR); } catch(e) {}

    const source = new Readable();
    source._read = () => {};
    source.push(file.buffer);
    source.push(null);

    await client.uploadFrom(source, remotePath);

    // Derived from FTP_HOST (ftp.<domain>) instead of a hardcoded domain, so
    // rotating/changing the FTP host doesn't also require a code edit here.
    const publicHost = (process.env.FTP_HOST || '').replace(/^ftp\./i, '');
    return `https://${publicHost}${FTP_UPLOAD_DIR}/${fileName}`;
  } catch (err) {
    console.error("Hostinger FTP Upload Failed:", err.message);
    throw err;
  } finally {
    client.close();
  }
};

const uploadToCloudinary = async (file) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder: 'masjid_photos' },
      (error, result) => {
        if (error) return reject(error);
        resolve(result.secure_url);
      }
    );
    
    const source = new Readable();
    source._read = () => {};
    source.push(file.buffer);
    source.push(null);
    source.pipe(uploadStream);
  });
};

const uploadToLocal = async (file) => {
  const uploadsDir = path.join(__dirname, '../uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  const fileName = `masjid_${Date.now()}${path.extname(file.originalname || '.jpg')}`;
  const filePath = path.join(uploadsDir, fileName);
  await fs.promises.writeFile(filePath, file.buffer);

  // Return relative URL so clients (Mobile App & Web Admin) automatically resolve to their active API host
  return `/uploads/${fileName}`;
};

const smartUpload = async (file) => {
  // Tier 1: Cloudinary CDN (global URL — accessible from any device/server, no path issues)
  if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
    try {
      console.log("📸 Uploading to Cloudinary CDN...");
      const url = await uploadToCloudinary(file);
      console.log("✅ Cloudinary upload success:", url);
      return url;
    } catch (err) {
      console.warn("⚠️  Cloudinary upload failed:", err.message);
    }
  }

  // Tier 2: Local server disk (fallback — only works if app & client share same server)
  try {
    console.log("💾 Falling back to local server storage...");
    return await uploadToLocal(file);
  } catch (err) {
    console.warn("⚠️  Local storage upload failed:", err.message);
  }

  // Tier 3: Hostinger FTP Fallback
  if (process.env.FTP_USER && process.env.FTP_PASS) {
    try {
      console.log("📡 Attempting Hostinger FTP Upload fallback...");
      return await uploadToHostinger(file);
    } catch (err) {
      console.warn("⚠️  Hostinger FTP fallback failed:", err.message);
    }
  }

  throw new Error("All upload methods failed.");
};

module.exports = { smartUpload };
