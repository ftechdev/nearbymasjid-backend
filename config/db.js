const { Sequelize } = require('sequelize');
require('dotenv').config();

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASS,
  {
    host: process.env.DB_HOST,
    dialect: 'mysql',
    logging: false,
    // ── Connection Pool (critical for Hostinger MySQL) ─────────────────────
    // Hostinger's MySQL server closes idle connections after its wait_timeout.
    // Without pool eviction, Sequelize holds stale connections and the first
    // request after a quiet period hits a "Cannot enqueue" / ECONNRESET error.
    pool: {
      max: 5,           // max open connections
      min: 0,           // allow pool to drop to zero when idle
      acquire: 30000,   // ms to wait for a connection before throwing error
      idle: 600000,     // 10 min — release a connection if unused this long
      evict: 60000,     // every 60s, evict connections idle > `idle` ms above
    },
    dialectOptions: {
      // Keep the underlying TCP socket alive so the OS doesn't drop it
      // before Sequelize's pool eviction notices the connection is stale.
      connectTimeout: 30000,
    },
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
