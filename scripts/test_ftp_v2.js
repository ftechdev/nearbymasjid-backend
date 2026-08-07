const ftp = require('basic-ftp');
require('dotenv').config();

async function testFTP() {
  const client = new ftp.Client(15000);
  client.ftp.verbose = true;
  try {
    console.log('\n--- Connecting to FTP ---');
    console.log('Host:', process.env.FTP_HOST);
    console.log('User:', process.env.FTP_USER);
    console.log('Port:', process.env.FTP_PORT || 21);

    await client.access({
      host: process.env.FTP_HOST,
      user: process.env.FTP_USER,
      password: process.env.FTP_PASS,
      port: parseInt(process.env.FTP_PORT) || 21,
      secure: false,
    });

    console.log('\n✅ FTP Login SUCCESS');
    const list = await client.list('/');
    console.log('\nRoot directory contents:');
    list.forEach(f => console.log(' -', f.name, f.type === 2 ? '(dir)' : ''));

    // Try listing /domains or /public_html
    try {
      const pub = await client.list('/public_html');
      console.log('\n/public_html contents:');
      pub.forEach(f => console.log(' -', f.name, f.type === 2 ? '(dir)' : ''));
    } catch(e) { console.log('No /public_html'); }

  } catch (err) {
    console.error('\n❌ FTP Error:', err.message);
    console.error('Code:', err.code);
  } finally {
    client.close();
  }
}
testFTP();
