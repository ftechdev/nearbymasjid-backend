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

    // Password-reset link columns (replaced the old OTP-based reset — resetOtp /
    // resetOtpExpiry below are legacy and no longer read by any route)
    try {
      await sequelize.query("ALTER TABLE Users ADD COLUMN resetOtp VARCHAR(6) NULL");
    } catch (e) { /* column already exists */ }
    try {
      await sequelize.query("ALTER TABLE Users ADD COLUMN resetOtpExpiry DATETIME NULL");
    } catch (e) { /* column already exists */ }
    try {
      await sequelize.query("ALTER TABLE Users ADD COLUMN resetToken VARCHAR(128) NULL");
    } catch (e) { /* column already exists */ }
    try {
      await sequelize.query("ALTER TABLE Users ADD COLUMN resetTokenExpiry DATETIME NULL");
    } catch (e) { /* column already exists */ }

    // Ensure new Mosque columns exist on database startup
    try {
      await sequelize.query("ALTER TABLE Mosques ADD COLUMN pendingPhotoUrl VARCHAR(500) NULL");
    } catch (e) { /* column already exists */ }
    try {
      await sequelize.query("ALTER TABLE Mosques ADD COLUMN photoSubmittedBy JSON NULL");
    } catch (e) { /* column already exists */ }
    try {
      await sequelize.query("ALTER TABLE Mosques ADD COLUMN timingsSubmittedBy JSON NULL");
    } catch (e) { /* column already exists */ }

    // Speeds up the nearby-mosques search (GET /api/mosques), which filters by all
    // three of these columns together. sync() below only creates indexes on brand-new
    // tables, so add it manually here too for databases that already existed before it.
    try {
      await sequelize.query("CREATE INDEX mosques_approved_lat_lng ON Mosques (isApproved, lat, lng)");
    } catch (e) { /* index already exists */ }

    await sequelize.sync(); // Just sync, don't alter
  } catch (error) {
    console.error('MySQL connection error:', error.message);
    process.exit(1);
  }
};

module.exports = { sequelize, connectDB };
