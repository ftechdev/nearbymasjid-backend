const ftp = require("basic-ftp");
const { Readable } = require('stream');
const path = require('path');
const fs = require('fs');

<<<<<<< HEAD
// FTP user is chrooted to public_html/uploads/ (the Node.js app root).
// To land files in public_html/uploads/uploads/ (where express.static serves from),
// we upload to /uploads/{filename} on FTP — NOT to root /.
const FTP_REMOTE_DIR = '/uploads';
=======
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// This FTP account is chrooted straight into public_html/uploads on the host
// (confirmed via the hPanel file manager — its own root already IS that
// folder), so we upload to FTP root, not to a "/uploads" subfolder — writing
// to "/uploads" from here lands one directory too deep (uploads/uploads) and
// the web server can never find it, which is exactly what was happening.
const FTP_URL_PATH = '/uploads';
>>>>>>> 7c1ece4adc1fd8033039e5011fec23d092393927

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
<<<<<<< HEAD

    // Ensure the /uploads directory exists on FTP server
    try { await client.ensureDir(FTP_REMOTE_DIR); } catch(e) {}
    await client.cd('/'); // reset back to root
=======
>>>>>>> 7c1ece4adc1fd8033039e5011fec23d092393927

    const source = new Readable();
    source._read = () => {};
    source.push(file.buffer);
    source.push(null);

<<<<<<< HEAD
    // Upload to /uploads/ so file lands in public_html/uploads/uploads/ on Hostinger
    await client.uploadFrom(source, `${FTP_REMOTE_DIR}/${fileName}`);

    // Return URL via api.nearbymosque.in — served by express.static from uploads/ dir
    const apiHost = process.env.API_PUBLIC_URL || `https://${(process.env.FTP_HOST || '').replace(/^ftp\./i, 'api.')}`;
    return `${apiHost}/uploads/${fileName}`;
=======
    await client.uploadFrom(source, `/${fileName}`);

    // Derived from FTP_HOST (ftp.<domain>) instead of a hardcoded domain, so
    // rotating/changing the FTP host doesn't also require a code edit here.
    const publicHost = (process.env.FTP_HOST || '').replace(/^ftp\./i, '');
    return `https://${publicHost}${FTP_URL_PATH}/${fileName}`;
>>>>>>> 7c1ece4adc1fd8033039e5011fec23d092393927
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
  // Tier 1: Hostinger FTP — durable storage on nearbymosque.in, verified working
  // end-to-end (upload + public serving) after fixing the double-nested
  // /uploads/uploads path this account's chroot was causing.
  if (process.env.FTP_USER && process.env.FTP_PASS) {
    try {
      console.log("📡 Uploading via Hostinger FTP...");
      const url = await uploadToHostinger(file);
      console.log("✅ FTP upload success:", url);
      return url;
    } catch (err) {
      console.warn("⚠️  FTP upload failed:", err.message);
    }
  }

  // Tier 2: Cloudinary CDN (currently disabled on the account as of writing,
  // but kept as a fallback in case that's resolved later).
  if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
    try {
      console.log("📸 Falling back to Cloudinary CDN...");
      const url = await uploadToCloudinary(file);
      console.log("✅ Cloudinary upload success:", url);
      return url;
    } catch (err) {
      console.warn("⚠️  Cloudinary upload failed:", err.message);
    }
  }

  // Tier 3: Local server disk — last resort. Ephemeral on Render (wiped on
  // every redeploy/restart), only used if both durable options above failed.
  try {
    console.log("💾 Falling back to local server storage (not durable)...");
    return await uploadToLocal(file);
  } catch (err) {
    console.warn("⚠️  Local storage upload failed:", err.message);
  }

  throw new Error("All upload methods failed.");
};

module.exports = { smartUpload };
