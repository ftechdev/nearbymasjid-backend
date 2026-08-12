// Runs once after the entire suite finishes, regardless of individual test
// failures — a last-resort cleanup of anything a crashed test left behind in
// the shared database. See testHelpers.js for the full explanation.
module.exports = async () => {
  const { sweepTestData, sequelize } = require('./testHelpers');
  try {
    await sweepTestData();
  } catch (e) {
    console.error('[globalTeardown] Final sweep failed:', e.message);
  } finally {
    await sequelize.close();
  }
};
