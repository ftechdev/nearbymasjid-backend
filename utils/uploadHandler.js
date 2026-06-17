const ftp = require("basic-ftp");
const cloudinary = require('cloudinary').v2;
const { Readable } = require('stream');
const path = require('path');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const uploadToHostinger = async (file) => {
  const client = new ftp.Client();
  // client.ftp.verbose = true;
  try {
    await client.access({
      host: process.env.FTP_HOST,
      user: process.env.FTP_USER,
      password: process.env.FTP_PASS,
      port: parseInt(process.env.FTP_PORT) || 21,
      secure: false
    });

    const fileName = `masjid_${Date.now()}${path.extname(file.originalname)}`;
    const remotePath = `/public_html/masjid_photos/${fileName}`;

    // Ensure directory exists (this might fail if already exists, so we wrap in try/catch or just ignore)
    try { await client.ensureDir("/public_html/masjid_photos"); } catch(e) {}

    const source = new Readable();
    source._read = () => {};
    source.push(file.buffer);
    source.push(null);

    await client.uploadFrom(source, remotePath);
    
    // Return the public URL
    return `https://amirhost.in/masjid_photos/${fileName}`;
  } catch (err) {
    console.error("Hostinger FTP Upload Failed:", err.message);
    throw err; // Throw to trigger fallback
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

const smartUpload = async (file) => {
  try {
    // Attempt 1: Hostinger
    console.log("Attempting Hostinger Upload...");
    return await uploadToHostinger(file);
  } catch (err) {
    // Attempt 2: Cloudinary Fallback
    console.log("Hostinger failed, falling back to Cloudinary...");
    return await uploadToCloudinary(file);
  }
};

module.exports = { smartUpload };
