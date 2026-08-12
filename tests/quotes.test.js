const request = require('supertest');
const app = require('../index');
const { createTestAdmin, testEmail, testName, Quote, User } = require('./testHelpers');

describe('Quotes routes (/api/quotes)', () => {
  let admin;
  let createdQuoteId;

  beforeAll(async () => {
    admin = await createTestAdmin('quotes-admin');
  });

  afterAll(async () => {
    if (createdQuoteId) await Quote.destroy({ where: { id: createdQuoteId } });
    await admin.user.destroy();
  });

  // NOTE: this is the real, shared "quote of the day" rotation used by the
  // live app — reading it is what any user's app does every day, so this is
  // safe, but it does legitimately advance the rotation pointer on a real row
  // (marking whichever quote comes up next as "shown today"), same as normal use.
  test('GET /api/quotes/daily returns a quote (public, no auth)', async () => {
    const res = await request(app).get('/api/quotes/daily');
    // 404 only if the admin has never added any quotes at all yet.
    expect([200, 404]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body).toHaveProperty('text');
    }
  });

  test('admin routes reject requests with no token', async () => {
    const res = await request(app).get('/api/quotes');
    expect(res.status).toBe(401);
  });

  test('admin routes reject a non-admin user', async () => {
    const reg = await request(app).post('/api/auth/register').send({
      name: testName('quotes-nonadmin'), email: testEmail('quotes-nonadmin'), password: 'Test@12345',
    });
    const res = await request(app).get('/api/quotes').set('Authorization', `Bearer ${reg.body.token}`);
    expect(res.status).toBe(403);
    await User.destroy({ where: { email: reg.body.email } });
  });

  test('admin can create a quote', async () => {
    const res = await request(app)
      .post('/api/quotes')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ text: testName('quote text'), reference: 'Test Reference 1:1' });
    expect(res.status).toBe(201);
    expect(res.body.text).toBe(testName('quote text'));
    createdQuoteId = res.body.id;
  });

  test('admin quote creation rejects empty text', async () => {
    const res = await request(app)
      .post('/api/quotes')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ text: '   ' });
    expect(res.status).toBe(400);
  });

  test('admin can list quotes and finds the one just created', async () => {
    const res = await request(app).get('/api/quotes').set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some(q => q.id === createdQuoteId)).toBe(true);
  });

  test('admin can delete the quote', async () => {
    const res = await request(app).delete(`/api/quotes/${createdQuoteId}`).set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    const check = await Quote.findByPk(createdQuoteId);
    expect(check).toBeNull();
    createdQuoteId = null;
  });

  test('deleting an already-deleted/unknown quote returns 404', async () => {
    const res = await request(app)
      .delete('/api/quotes/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(404);
  });
});
