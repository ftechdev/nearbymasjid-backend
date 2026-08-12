// Shared setup for the whole test suite.
//
// IMPORTANT: this suite runs against the real configured database (see
// backend/.env — as of writing that's the same Hostinger MySQL instance
// production uses). There is no separate test database. Every row this suite
// creates is therefore tagged so it can never be confused with real data:
//   - Users:   email ends in "@e2e.nearbymosque.test"
//   - Mosques/Quotes/Reviews: name/text/comment starts with "__E2E_TEST__"
// Each test file cleans up what it created in its own afterAll, and
// globalTeardown.js does one more sweep for the whole tagged domain/prefix
// at the very end — so even a crashed test run can't leave orphaned rows in
// a shared production database.
const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');
const { sequelize } = require('../config/db');
const User = require('../models/User');
const Mosque = require('../models/Mosque');
const Quote = require('../models/Quote');
const AppReview = require('../models/AppReview');

const RUN_TAG = `e2e${Date.now()}`;
const TEST_EMAIL_DOMAIN = 'e2e.nearbymosque.test';
const TEST_NAME_PREFIX = '__E2E_TEST__';

const testEmail = (label) => `${RUN_TAG}-${label}@${TEST_EMAIL_DOMAIN}`.toLowerCase();
const testName = (label) => `${TEST_NAME_PREFIX} ${RUN_TAG} ${label}`;
const generateToken = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '1h' });

// There's no self-service way to become admin (by design) — the only way to
// get an admin-authenticated test session is to create the row directly.
async function createTestAdmin(label = 'admin') {
  const user = await User.create({
    name: testName(label),
    email: testEmail(label),
    password: 'Test@12345',
    role: 'admin',
  });
  return { user, token: generateToken(user.id) };
}

// Registers a plain user through the real /api/auth/register endpoint — for
// test files that need a logged-in user but aren't themselves testing register.
async function registerTestUser(request, app, label = 'user') {
  const res = await request(app).post('/api/auth/register').send({
    name: testName(label),
    email: testEmail(label),
    password: 'Test@12345',
  });
  return res.body; // { _id, name, email, role, token }
}

// Removes every row this suite could plausibly have created, from ANY run
// (not just the current one) — the final safety net if a test crashes before
// its own afterAll runs. Scoped strictly to the tagged domain/prefix.
async function sweepTestData() {
  await Mosque.destroy({ where: { name: { [Op.like]: `${TEST_NAME_PREFIX}%` } } });
  await Quote.destroy({ where: { text: { [Op.like]: `${TEST_NAME_PREFIX}%` } } });
  await AppReview.destroy({ where: { comment: { [Op.like]: `${TEST_NAME_PREFIX}%` } } });
  await User.destroy({ where: { email: { [Op.like]: `%@${TEST_EMAIL_DOMAIN}` } } });
}

module.exports = {
  RUN_TAG,
  TEST_EMAIL_DOMAIN,
  TEST_NAME_PREFIX,
  testEmail,
  testName,
  generateToken,
  createTestAdmin,
  registerTestUser,
  sweepTestData,
  sequelize,
  User,
  Mosque,
  Quote,
  AppReview,
};
