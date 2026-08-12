const request = require('supertest');
const app = require('../index');
const { testEmail, testName, User, sequelize } = require('./testHelpers');

describe('Auth routes (/api/auth)', () => {
  const email = testEmail('auth-main');
  const password = 'Test@12345';
  let token;

  afterAll(async () => {
    await User.destroy({ where: { email } });
    await User.destroy({ where: { email: testEmail('google-only') } });
  });

  // ── POST /register ───────────────────────────────────────────────────────
  describe('POST /api/auth/register', () => {
    test('rejects a missing name', async () => {
      const res = await request(app).post('/api/auth/register').send({ email, password });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/name/i);
    });

    test('rejects a missing email', async () => {
      const res = await request(app).post('/api/auth/register').send({ name: testName('x'), password });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/email/i);
    });

    test('rejects a malformed email', async () => {
      const res = await request(app).post('/api/auth/register').send({ name: testName('x'), email: 'not-an-email', password });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/valid email/i);
    });

    test('rejects a missing password', async () => {
      const res = await request(app).post('/api/auth/register').send({ name: testName('x'), email: testEmail('nopass') });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/password/i);
    });

    test('rejects a password under 6 characters', async () => {
      const res = await request(app).post('/api/auth/register').send({ name: testName('x'), email: testEmail('shortpass'), password: '123' });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/at least 6 characters/i);
    });

    test('creates a new account and returns a usable token', async () => {
      const res = await request(app).post('/api/auth/register').send({ name: testName('auth-main'), email, password });
      expect(res.status).toBe(201);
      expect(res.body.email).toBe(email);
      expect(res.body.role).toBe('user');
      expect(typeof res.body.token).toBe('string');
      token = res.body.token;
    });

    test('rejects a duplicate email with a clear message (not a generic 500)', async () => {
      const res = await request(app).post('/api/auth/register').send({ name: testName('dup'), email, password });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/already exists/i);
    });
  });

  // ── GET /me ───────────────────────────────────────────────────────────────
  describe('GET /api/auth/me', () => {
    test('returns the current user with a valid token', async () => {
      const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.email).toBe(email);
    });

    test('rejects with no Authorization header', async () => {
      const res = await request(app).get('/api/auth/me');
      expect(res.status).toBe(401);
    });

    test('rejects a garbage token', async () => {
      const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer not-a-real-jwt');
      expect(res.status).toBe(401);
      expect(res.body.message).toMatch(/invalid/i);
    });
  });

  // ── POST /login ───────────────────────────────────────────────────────────
  describe('POST /api/auth/login', () => {
    test('rejects a missing email', async () => {
      const res = await request(app).post('/api/auth/login').send({ password });
      expect(res.status).toBe(400);
    });

    test('rejects a missing password', async () => {
      const res = await request(app).post('/api/auth/login').send({ email });
      expect(res.status).toBe(400);
    });

    test('rejects an email with no account, without confirming it is unregistered ambiguously', async () => {
      const res = await request(app).post('/api/auth/login').send({ email: testEmail('never-registered'), password });
      expect(res.status).toBe(404);
      expect(res.body.message).toMatch(/no account found/i);
    });

    test('rejects the wrong password with a specific message', async () => {
      const res = await request(app).post('/api/auth/login').send({ email, password: 'WrongPassword123' });
      expect(res.status).toBe(401);
      expect(res.body.message).toMatch(/incorrect password/i);
    });

    test('tells a Google-only account to use Google Sign-In instead of a generic failure', async () => {
      const googleOnlyEmail = testEmail('google-only');
      await User.create({ name: testName('google-only'), email: googleOnlyEmail }); // no password — mirrors how /api/auth/google creates users
      const res = await request(app).post('/api/auth/login').send({ email: googleOnlyEmail, password: 'anything' });
      expect(res.status).toBe(401);
      expect(res.body.message).toMatch(/google sign-in/i);
    });

    test('logs in successfully with the correct credentials', async () => {
      const res = await request(app).post('/api/auth/login').send({ email, password });
      expect(res.status).toBe(200);
      expect(res.body.email).toBe(email);
      expect(typeof res.body.token).toBe('string');
    });
  });

  // ── POST /google ──────────────────────────────────────────────────────────
  // NOTE: a real successful Google sign-in can't be exercised here without a
  // token actually signed by Google — that would require mocking
  // google-auth-library rather than testing the real verification path.
  // These cover every branch that's reachable without one.
  describe('POST /api/auth/google', () => {
    test('rejects a missing idToken', async () => {
      const res = await request(app).post('/api/auth/google').send({});
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/token is missing/i);
    });

    test('rejects a token that is not a real Google-signed JWT', async () => {
      const res = await request(app).post('/api/auth/google').send({ idToken: 'clearly-not-a-real-google-token' });
      expect(res.status).toBe(401);
      expect(res.body.message).toMatch(/could not be verified/i);
    });
  });

  // ── POST /forgot-password + POST /reset-password ────────────────────────
  describe('Password reset flow', () => {
    test('forgot-password rejects a missing email', async () => {
      const res = await request(app).post('/api/auth/forgot-password').send({});
      expect(res.status).toBe(400);
    });

    test('forgot-password rejects a malformed email', async () => {
      const res = await request(app).post('/api/auth/forgot-password').send({ email: 'not-an-email' });
      expect(res.status).toBe(400);
    });

    test('forgot-password gives the identical response for a real vs. unregistered email (no account enumeration)', async () => {
      const realRes = await request(app).post('/api/auth/forgot-password').send({ email });
      const fakeRes = await request(app).post('/api/auth/forgot-password').send({ email: testEmail('does-not-exist') });
      expect(realRes.status).toBe(200);
      expect(fakeRes.status).toBe(200);
      expect(realRes.body.message).toBe(fakeRes.body.message);
    });

    test('reset-password rejects a missing token', async () => {
      const res = await request(app).post('/api/auth/reset-password').send({ newPassword: 'NewPass123' });
      expect(res.status).toBe(400);
    });

    test('reset-password rejects a new password under 6 characters', async () => {
      const res = await request(app).post('/api/auth/reset-password').send({ token: 'whatever', newPassword: '123' });
      expect(res.status).toBe(400);
    });

    test('reset-password rejects an unknown/invalid token', async () => {
      const res = await request(app).post('/api/auth/reset-password').send({ token: 'not-a-real-token', newPassword: 'NewPass123' });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/invalid/i);
    });

    test('a real reset token successfully changes the password end-to-end', async () => {
      // forgot-password writes a real resetToken to this user's row — read it
      // back directly rather than intercepting the email, since we control the DB.
      await request(app).post('/api/auth/forgot-password').send({ email });
      const dbUser = await User.findOne({ where: { email } });
      expect(dbUser.resetToken).toBeTruthy();

      const newPassword = 'BrandNewPass123';
      const resetRes = await request(app).post('/api/auth/reset-password').send({ token: dbUser.resetToken, newPassword });
      expect(resetRes.status).toBe(200);

      // Old password must no longer work, new one must.
      const oldLogin = await request(app).post('/api/auth/login').send({ email, password });
      expect(oldLogin.status).toBe(401);

      const newLogin = await request(app).post('/api/auth/login').send({ email, password: newPassword });
      expect(newLogin.status).toBe(200);

      // The token must be single-use.
      const reuseRes = await request(app).post('/api/auth/reset-password').send({ token: dbUser.resetToken, newPassword: 'AnotherPass123' });
      expect(reuseRes.status).toBe(400);
    });
  });
});
