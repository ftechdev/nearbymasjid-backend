const { Sequelize } = require('sequelize');
require('dotenv').config();

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASS,
  {
    host: process.env.DB_HOST,
    dialect: 'mysql',
    logging: false, // Set to console.log to see SQL queries
  }
);

const connectDB = async () => {
  try {
    await sequelize.authenticate();
    // Ensure columns exist manually to prevent crashes
    // try {
    //   await sequelize.query("ALTER TABLE Mosques ADD COLUMN iqamahTimings JSON");
    // } catch (e) { /* already exists */ }
    // try {
    //   await sequelize.query("ALTER TABLE Mosques ADD COLUMN timingsApproved TINYINT DEFAULT 1");
    // } catch (e) { /* already exists */ }
    // try {
    //   await sequelize.query("ALTER TABLE Mosques ADD COLUMN googlePlaceId VARCHAR(255) UNIQUE");
    // } catch (e) { /* already exists */ }
    // try {
    //   await sequelize.query("ALTER TABLE Mosques ADD COLUMN photoUrl VARCHAR(500)");
    // } catch (e) { /* already exists */ }
    // try {
    //   await sequelize.query("ALTER TABLE Mosques ADD COLUMN school ENUM('hanafi','shafi') DEFAULT 'shafi'");
    // } catch (e) { /* already exists */ }
    // try {
    //   await sequelize.query("ALTER TABLE Mosques ADD COLUMN userId VARCHAR(36)");
    // } catch (e) { /* already exists */ }

    // Import models before syncing
    require('../models/User');
    require('../models/Mosque');
    require('../models/Quote');
    require('../models/AppReview');
    require('../models/Settings');

    // Add OTP columns if they don't exist yet (safe on re-deploy)
    try {
      await sequelize.query("ALTER TABLE Users ADD COLUMN resetOtp VARCHAR(6) NULL");
    } catch (e) { /* column already exists */ }
    try {
      await sequelize.query("ALTER TABLE Users ADD COLUMN resetOtpExpiry DATETIME NULL");
    } catch (e) { /* column already exists */ }

    await sequelize.sync(); // Just sync, don't alter
  } catch (error) {
    console.error('MySQL connection error:', error.message);
    process.exit(1);
  }
};

module.exports = { sequelize, connectDB };
