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

const uploadToHostinger = async (file) => {
  const client = new ftp.Client();
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
    const remotePath = `/public_html/masjid_photos/${fileName}`;

    try { await client.ensureDir("/public_html/masjid_photos"); } catch(e) {}

    const source = new Readable();
    source._read = () => {};
    source.push(file.buffer);
    source.push(null);

    await client.uploadFrom(source, remotePath);
    
    return `https://amirhost.in/masjid_photos/${fileName}`;
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
  // Attempt 1: Hostinger FTP
  try {
    console.log("Attempting Hostinger FTP Upload...");
    return await uploadToHostinger(file);
  } catch (err) {
    console.warn("Hostinger FTP failed:", err.message);
  }

  // Attempt 2: Cloudinary Fallback
  try {
    console.log("Falling back to Cloudinary Upload...");
    return await uploadToCloudinary(file);
  } catch (err) {
    console.warn("Cloudinary failed:", err.message);
  }

  // Attempt 3: Local Server Disk Storage
  try {
    console.log("Falling back to Local Server Storage...");
    return await uploadToLocal(file);
  } catch (err) {
    console.error("Local storage upload failed:", err.message);
    throw new Error("All upload methods failed.");
  }
};

module.exports = { smartUpload };
