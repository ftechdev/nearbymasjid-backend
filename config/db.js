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
    // ── Connection Pool (Optimized for Hostinger MySQL) ────────────────────
    pool: {
      max: 10,          // Max concurrent open connections
      min: 1,           // Keep at least 1 active connection warm at all times
      acquire: 30000,   // Max ms to wait for connection
      idle: 30000,      // Release extra idle connections after 30s
      evict: 15000,     // Evict stale connections every 15s
    },
    dialectOptions: {
      connectTimeout: 30000,
      enableKeepAlive: true,  // mysql2 dialect option for TCP socket keep-alive
    },
  }
);

/**
 * Background Keep-Alive Ping
 * Runs a light `SELECT 1` query every 3 minutes so Hostinger MySQL never closes
 * idle connections or puts the database connection into a sleep/timeout state.
 */
function startDbKeepAlive() {
  setInterval(async () => {
    try {
      await sequelize.query('SELECT 1;');
      // console.log('🟢 DB Keep-Alive ping OK');
    } catch (err) {
      console.warn('⚠️ DB Keep-Alive ping hiccup:', err.message);
    }
  }, 3 * 60 * 1000); // Every 3 minutes
}

const connectDB = async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ MySQL Database Connected Successfully');

    // Start background keep-alive ping so Hostinger MySQL never drops idle connections
    startDbKeepAlive();

    // Import models before syncing
    require('../models/User');
    require('../models/Mosque');
    require('../models/Quote');
    require('../models/AppReview');
    require('../models/Settings');

    // Password-reset link columns — added once, silently skipped on subsequent boots
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

    // Speeds up nearby-mosques queries
    try {
      await sequelize.query("CREATE INDEX mosques_approved_lat_lng ON Mosques (isApproved, lat, lng)");
    } catch (e) { /* index already exists */ }

    await sequelize.sync();
  } catch (error) {
    console.error('❌ MySQL connection error:', error.message);
    process.exit(1);
  }
};

module.exports = { sequelize, connectDB };
