const request = require('supertest');
const app = require('../index');
const { createTestAdmin, registerTestUser, testName, User, AppReview } = require('./testHelpers');

describe('Reviews routes (/api/reviews)', () => {
  let user;
  let admin;

  beforeAll(async () => {
    user = await registerTestUser(request, app, 'reviews-user');
    admin = await createTestAdmin('reviews-admin');
  });

  afterAll(async () => {
    await AppReview.destroy({ where: { userId: user._id } });
    await User.destroy({ where: { id: user._id } });
    await admin.user.destroy();
  });

  test('POST /api/reviews rejects an unauthenticated request', async () => {
    const res = await request(app).post('/api/reviews').send({ rating: 5 });
    expect(res.status).toBe(401);
  });

  test('POST /api/reviews rejects a rating outside 1-5', async () => {
    const res = await request(app)
      .post('/api/reviews')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ rating: 9, comment: testName('bad rating') });
    expect(res.status).toBe(400);
  });

  test('POST /api/reviews creates a review for the current user', async () => {
    const res = await request(app)
      .post('/api/reviews')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ rating: 4, comment: testName('first review') });
    expect(res.status).toBe(200);
    expect(res.body.rating).toBe(4);
    expect(res.body.isApproved).toBe(false);
  });

  test('POST /api/reviews again updates (not duplicates) the same user\'s review, and resets approval', async () => {
    const res = await request(app)
      .post('/api/reviews')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ rating: 5, comment: testName('updated review') });
    expect(res.status).toBe(200);
    expect(res.body.rating).toBe(5);
    expect(res.body.isApproved).toBe(false);

    const all = await AppReview.findAll({ where: { userId: user._id } });
    expect(all.length).toBe(1); // still just one row, not a second one
  });

  test('GET /api/reviews/me returns the current user\'s review', async () => {
    const res = await request(app).get('/api/reviews/me').set('Authorization', `Bearer ${user.token}`);
    expect(res.status).toBe(200);
    expect(res.body.comment).toBe(testName('updated review'));
  });

  test('GET /api/reviews/approved is public and only ever returns approved reviews', async () => {
    const res = await request(app).get('/api/reviews/approved');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.every(r => r.isApproved !== false)).toBe(true);
    // Our review isn't approved yet, so it must not be in this list.
    expect(res.body.some(r => r.comment === testName('updated review'))).toBe(false);
  });

  test('GET /api/reviews (admin list) rejects a non-admin user', async () => {
    const res = await request(app).get('/api/reviews').set('Authorization', `Bearer ${user.token}`);
    expect(res.status).toBe(403);
  });

  test('GET /api/reviews (admin list) includes our pending review', async () => {
    const res = await request(app).get('/api/reviews').set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    const mine = res.body.find(r => r.comment === testName('updated review'));
    expect(mine).toBeTruthy();
  });

  test('admin can approve the review, after which it appears in the public approved list', async () => {
    const listRes = await request(app).get('/api/reviews').set('Authorization', `Bearer ${admin.token}`);
    const mine = listRes.body.find(r => r.comment === testName('updated review'));

    const approveRes = await request(app).put(`/api/admin/reviews/${mine.id}/approve`).set('Authorization', `Bearer ${admin.token}`);
    expect(approveRes.status).toBe(200);

    const approvedList = await request(app).get('/api/reviews/approved');
    expect(approvedList.body.some(r => r.id === mine.id)).toBe(true);
  });

  test('DELETE /api/reviews removes the current user\'s review', async () => {
    const res = await request(app).delete('/api/reviews').set('Authorization', `Bearer ${user.token}`);
    expect(res.status).toBe(200);

    const check = await request(app).get('/api/reviews/me').set('Authorization', `Bearer ${user.token}`);
    expect(check.body).toBeNull();
  });

  test('DELETE /api/reviews when there is nothing to delete returns 404', async () => {
    const res = await request(app).delete('/api/reviews').set('Authorization', `Bearer ${user.token}`);
    expect(res.status).toBe(404);
  });

  // FINDING: there are two separate admin-only "list all reviews" endpoints —
  // GET /api/reviews (reviews.js, plain array) and GET /api/admin/reviews
  // (admin.js, paginated {reviews,total,page,totalPages}) — with different
  // response shapes for the same data. Not a bug (each has its own consumer),
  // but worth knowing about if either client is ever refactored.
  test('admin delete on an unknown review id returns 404, not a 500', async () => {
    const res = await request(app)
      .delete('/api/admin/reviews/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(404);
  });
});
