/**
 * Run once to create the admin user:
 *   node scripts/createAdmin.js
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
  name:     'Admin',
  email:    'admin@gmail.com',
  password: 'admin123',
  role:     'admin',
};

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
    console.log('  Admin Login Credentials');
    console.log('  Email   : admin@gmail.com');
    console.log('  Password: admin123');
    console.log('─────────────────────────────────');

    await sequelize.close();
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
})();
