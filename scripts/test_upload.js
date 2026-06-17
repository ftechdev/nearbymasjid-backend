require('dotenv').config();
const { smartUpload } = require('../utils/uploadHandler');

async function run() {
  console.log('Starting upload test...');
  
  // Create a dummy 1x1 transparent pixel PNG buffer
  const dummyBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64'
  );
  
  const dummyFile = {
    originalname: 'test_pixel.png',
    buffer: dummyBuffer,
    mimetype: 'image/png'
  };
  
  try {
    const url = await smartUpload(dummyFile);
    console.log('SUCCESS! Upload completed.');
    console.log('Uploaded File URL:', url);
  } catch (err) {
    console.error('FAILED! Upload failed on all channels:', err);
  }
  
  process.exit(0);
}

run();
