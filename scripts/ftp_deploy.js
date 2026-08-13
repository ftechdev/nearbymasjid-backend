/**
 * Deploys updated backend source files to Hostinger via FTP.
 * The FTP user root = public_html/uploads/ which is the Node.js app root.
 * Usage: node scripts/ftp_deploy.js
 */
const ftp = require('basic-ftp');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const APP_ROOT = path.join(__dirname, '..');

// Files that changed and need to be deployed
const FILES_TO_DEPLOY = [
  'index.js',
  'config/db.js',
  'config/redis.js',
  'models/Mosque.js',
  'models/Settings.js',
  'routes/admin.js',
  'routes/auth.js',
  'routes/mosques.js',
  'routes/settings.js',
  'utils/uploadHandler.js',
];

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

    for (const relPath of FILES_TO_DEPLOY) {
      const localFile = path.join(APP_ROOT, relPath);
      // FTP user root = app root, so deploy to same relative path
      const remoteFile = `/${relPath.replace(/\\/g, '/')}`;

      // Ensure remote directory exists
      const remoteDir = path.dirname(remoteFile).replace(/\\/g, '/');
      if (remoteDir !== '/') {
        try { await client.ensureDir(remoteDir); } catch (e) {}
        await client.cd('/'); // reset back to root after ensureDir
      }

      process.stdout.write(`⬆️  Deploying ${relPath}... `);
      await client.uploadFrom(localFile, remoteFile);
      console.log('✅ Done');
    }

    console.log('\n✅ Deployment complete!');
    console.log('⚠️  You still need to RESTART the Node.js process on Hostinger hPanel for changes to take effect.');

  } catch (err) {
    console.error('❌ FTP Error:', err.message);
  } finally {
    client.close();
  }
})();
