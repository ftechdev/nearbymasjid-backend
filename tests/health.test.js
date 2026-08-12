const request = require('supertest');
const app = require('../index');

describe('Health & misc endpoints', () => {
  test('GET / reports the API is running', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/running/i);
  });

  test('GET /api/ping responds ok (used by uptime monitors)', async () => {
    const res = await request(app).get('/api/ping');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  test('GET /reset-password serves the reset-password HTML page', async () => {
    const res = await request(app).get('/reset-password?token=sometoken');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toMatch(/Reset Password/i);
  });

  test('POST /api/notifications/register-token always succeeds', async () => {
    const res = await request(app).post('/api/notifications/register-token').send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  test('POST /api/notifications/dissociate-token always succeeds', async () => {
    const res = await request(app).post('/api/notifications/dissociate-token').send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  test('unknown route returns a 404-shaped response, not a crash', async () => {
    const res = await request(app).get('/api/this-route-does-not-exist');
    expect(res.status).toBe(404);
  });

  // FINDING: every other /api/admin/* route requires protect+admin — this one
  // doesn't. Not a security hole (it returns nothing but a static string), but
  // documenting the inconsistency here so it doesn't get missed later.
  test('GET /api/admin/health is public (inconsistent with the rest of /api/admin, but not sensitive)', async () => {
    const res = await request(app).get('/api/admin/health');
    expect(res.status).toBe(200);
  });
});
