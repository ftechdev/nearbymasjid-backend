/**
 * Run once to create (or promote) the admin user. Credentials come from
 * environment variables so no live password is ever hardcoded/committed:
 *   ADMIN_NAME=Admin ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=... node scripts/createAdmin.js
 */
require('dotenv').config();
const { Sequelize } = require('sequelize');
const bcrypt = require('bcryptjs');

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASS,
  { host: process.env.DB_HOST, dialect: 'mysql', logging: false }
);

const ADMIN = {
  name:     process.env.ADMIN_NAME || 'Admin',
  email:    process.env.ADMIN_EMAIL,
  password: process.env.ADMIN_PASSWORD,
  role:     'admin',
};

if (!ADMIN.email || !ADMIN.password) {
  console.error('❌ Set ADMIN_EMAIL and ADMIN_PASSWORD environment variables before running this script.');
  process.exit(1);
}

(async () => {
  try {
    await sequelize.authenticate();
    console.log('DB connected');

    const hashedPassword = await bcrypt.hash(ADMIN.password, 10);

    const [results] = await sequelize.query(
      `SELECT id FROM Users WHERE email = ? LIMIT 1`,
      { replacements: [ADMIN.email] }
    );

    if (results.length > 0) {
      // Update existing user to admin
      await sequelize.query(
        `UPDATE Users SET role = 'admin', name = ?, password = ? WHERE email = ?`,
        { replacements: [ADMIN.name, hashedPassword, ADMIN.email] }
      );
      console.log('✅ Existing user upgraded to admin!');
    } else {
      // Create fresh admin user
      const { v4: uuidv4 } = require('uuid');
      await sequelize.query(
        `INSERT INTO Users (id, name, email, password, role, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, 'admin', NOW(), NOW())`,
        { replacements: [uuidv4(), ADMIN.name, ADMIN.email, hashedPassword] }
      );
      console.log('✅ Admin user created!');
    }

    // Optionally delete old admin to keep it clean
    await sequelize.query(
      `DELETE FROM Users WHERE email = 'admin@masjid.com'`
    );

    console.log('');
    console.log('─────────────────────────────────');
    console.log(`  Admin ready: ${ADMIN.email}`);
    console.log('─────────────────────────────────');

    await sequelize.close();
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
})();
