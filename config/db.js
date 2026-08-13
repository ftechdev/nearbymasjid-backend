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
    // Jest gives each test file its own module registry, so each one that
    // requires this file opens its own separate pool — under test, keep that
    // small (each file also closes its pool in afterAll; see tests/jestSetupAfterEnv.js)
    // so a full test run can't add up to a meaningful chunk of Hostinger's
    // shared max_connections_per_hour quota the way `max: 10, min: 1` per file did.
    pool: process.env.NODE_ENV === 'test'
      ? { max: 2, min: 0, acquire: 30000, idle: 5000, evict: 5000 }
      : {
          max: 5,           // Reduced max open connections to prevent quota exhaustion
          min: 0,           // min: 0 prevents constant reconnection attempts
          acquire: 30000,   // Max ms to wait for connection
          idle: 60000,      // Keep connection alive up to 60s for reuse
          evict: 30000,     // Evict stale connections every 30s
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

// Errors like a Hostinger hourly connection-quota hit, a dropped TCP socket, or
// DNS not resolving yet on a cold boot are all transient — retrying gives the
// process a chance to recover on its own. A bad password/host/DB name never
// will, so those still exit immediately rather than retrying forever.
const RETRYABLE_ERROR_PATTERN = /max_connections_per_hour|too many connections|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ECONNRESET|PROTOCOL_CONNECTION_LOST/i;

const connectDB = async (retryDelayMs = 5000) => {
  try {
    await sequelize.authenticate();
    console.log('✅ MySQL Database Connected Successfully');

    // Start background keep-alive ping so Hostinger MySQL never drops idle connections.
    // Skipped under tests — each test file's pool is short-lived and explicitly
    // closed in afterAll (tests/jestSetupAfterEnv.js); a 3-minute interval would
    // just be extra unnecessary connections and an open handle Jest has to force-exit.
    if (process.env.NODE_ENV !== 'test') startDbKeepAlive();

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

    // Speeds up the duplicate-submission proximity check, which has no isApproved
    // filter and so can't use the leftmost prefix of the index above.
    try {
      await sequelize.query("CREATE INDEX mosques_lat_lng ON Mosques (lat, lng)");
    } catch (e) { /* index already exists */ }

    await sequelize.sync();
  } catch (error) {
    // Under tests, each file owns a short-lived pool that it explicitly closes
    // in afterAll — a background retry can fire after that close() and hit
    // "pool is draining", which isn't itself retryable, cascading into exactly
    // the crash this whole retry mechanism exists to avoid. So under tests,
    // just log and stop: let the specific test file's own assertions fail
    // naturally against the unreachable DB, instead of retrying or exiting.
    if (process.env.NODE_ENV === 'test') {
      console.error('⚠️ [test] MySQL connection failed, not retrying under NODE_ENV=test:', error.message);
      return;
    }
    if (RETRYABLE_ERROR_PATTERN.test(error.message)) {
      console.error(`⚠️ MySQL connection failed (transient — retrying in ${retryDelayMs / 1000}s): ${error.message}`);
      // The server keeps running and accepting requests while this retries in
      // the background; DB-dependent routes just 500 until a retry succeeds,
      // instead of the whole process dying and needing a manual restart.
      setTimeout(() => connectDB(Math.min(retryDelayMs * 2, 5 * 60 * 1000)), retryDelayMs);
      return;
    }
    console.error('❌ MySQL connection error (not transient — check DB_HOST/DB_USER/DB_PASS/DB_NAME):', error.message);
    process.exit(1);
  }
};

module.exports = { sequelize, connectDB };
