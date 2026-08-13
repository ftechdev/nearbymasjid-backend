const ftp = require("basic-ftp");
const { Readable } = require('stream');
const path = require('path');

/**
 * Uploads file directly to Hostinger FTP server.
 * The FTP account root corresponds to public_html/uploads/ on nearbymosque.in.
 */
const uploadToHostinger = async (file) => {
  if (!process.env.FTP_HOST || !process.env.FTP_USER || !process.env.FTP_PASS) {
    throw new Error('FTP configuration is missing in environment variables (FTP_HOST, FTP_USER, FTP_PASS).');
  }

  const client = new ftp.Client(10000);
  client.ftp.verbose = false;
  try {
    console.log(`📡 Connecting to FTP server (${process.env.FTP_HOST}:${process.env.FTP_PORT || 21})...`);
    await client.access({
      host: process.env.FTP_HOST,
      user: process.env.FTP_USER,
      password: process.env.FTP_PASS,
      port: parseInt(process.env.FTP_PORT, 10) || 21,
      secure: false
    });

    const fileName = `masjid_${Date.now()}${path.extname(file.originalname || '.jpg')}`;

    const source = new Readable();
    source._read = () => {};
    source.push(file.buffer);
    source.push(null);

    console.log(`📤 Uploading ${fileName} directly to FTP root...`);
    await client.uploadFrom(source, fileName);

    const mediaHost = process.env.MEDIA_PUBLIC_URL || 'https://nearbymosque.in';
    const photoUrl = `${mediaHost}/uploads/${fileName}`;
    console.log(`✅ [FTP Upload Success] Photo URL: ${photoUrl}`);
    return photoUrl;
  } catch (err) {
    console.error(`❌ [FTP Upload Error] Host: ${process.env.FTP_HOST} — Reason: ${err.message}`);
    throw new Error(`Hostinger FTP Upload Failed: ${err.message}`);
  } finally {
    client.close();
  }
};

/**
 * Main Upload Handler (FTP Only)
 */
const smartUpload = async (file) => {
  return await uploadToHostinger(file);
};

module.exports = { smartUpload, uploadToHostinger };


