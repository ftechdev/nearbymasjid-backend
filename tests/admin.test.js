const request = require('supertest');
const app = require('../index');
const { createTestAdmin, registerTestUser, testName, testEmail, User, Mosque } = require('./testHelpers');

describe('Admin routes (/api/admin)', () => {
  let admin;
  let plainUser;

  beforeAll(async () => {
    admin = await createTestAdmin('admin-main');
    plainUser = await registerTestUser(request, app, 'admin-plain-user');
  });

  afterAll(async () => {
    await User.destroy({ where: { id: plainUser._id } });
    await admin.user.destroy();
  });

  // ── Auth guard sanity, checked once broadly ──────────────────────────────
  describe('Auth guards', () => {
    test('rejects requests with no token', async () => {
      const res = await request(app).get('/api/admin/analytics');
      expect(res.status).toBe(401);
    });

    test('rejects a logged-in non-admin user', async () => {
      const res = await request(app).get('/api/admin/analytics').set('Authorization', `Bearer ${plainUser.token}`);
      expect(res.status).toBe(403);
    });
  });

  // ── Mosques ───────────────────────────────────────────────────────────────
  describe('Mosque management', () => {
    let mosqueId;

    beforeAll(async () => {
      const m = await Mosque.create({
        name: testName('admin-mosque'),
        address: testName('admin-mosque-address'),
        lat: -76.0,
        lng: 1.0,
        userId: plainUser._id,
        isApproved: false,
      });
      mosqueId = m.id;
    });

    afterAll(async () => {
      await Mosque.destroy({ where: { id: mosqueId } });
    });

    test('GET /api/admin/mosques returns a paginated shape', async () => {
      const res = await request(app).get('/api/admin/mosques?limit=5').set('Authorization', `Bearer ${admin.token}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.mosques)).toBe(true);
      expect(typeof res.body.total).toBe('number');
    });

    test('GET /api/admin/mosques?pendingPhotos=true only returns mosques with a pending photo', async () => {
      const res = await request(app).get('/api/admin/mosques?pendingPhotos=true').set('Authorization', `Bearer ${admin.token}`);
      expect(res.status).toBe(200);
      expect(res.body.mosques.every(m => !!m.pendingPhotoUrl)).toBe(true);
    });

    test('GET /api/admin/analytics returns numeric counts', async () => {
      const res = await request(app).get('/api/admin/analytics').set('Authorization', `Bearer ${admin.token}`);
      expect(res.status).toBe(200);
      expect(typeof res.body.totalMosques).toBe('number');
      expect(typeof res.body.totalUsers).toBe('number');
      expect(typeof res.body.totalReviews).toBe('number');
    });

    test('PUT /api/admin/mosques/:id approves the mosque and edits its fields', async () => {
      const res = await request(app)
        .put(`/api/admin/mosques/${mosqueId}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ isApproved: true, name: testName('admin-mosque-edited') });
      expect(res.status).toBe(200);
      expect(res.body.isApproved).toBe(true);
      expect(res.body.name).toBe(testName('admin-mosque-edited'));
    });

    test('PUT /api/admin/mosques/:id on an unknown id returns 404', async () => {
      const res = await request(app)
        .put('/api/admin/mosques/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ isApproved: true });
      expect(res.status).toBe(404);
    });

    test('PUT /api/admin/mosques/:id/approve-timing marks timings approved', async () => {
      const res = await request(app)
        .put(`/api/admin/mosques/${mosqueId}/approve-timing`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(res.status).toBe(200);
      const dbRow = await Mosque.findByPk(mosqueId);
      expect(dbRow.timingsApproved).toBe(true);
    });

    test('PUT /api/admin/mosques/:id/approve-photo requires a pending photo to exist', async () => {
      const noPending = await request(app)
        .put(`/api/admin/mosques/${mosqueId}/approve-photo`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(noPending.status).toBe(400);

      await Mosque.update({ pendingPhotoUrl: '/uploads/pending-test.jpg' }, { where: { id: mosqueId } });
      const res = await request(app)
        .put(`/api/admin/mosques/${mosqueId}/approve-photo`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(res.status).toBe(200);

      const dbRow = await Mosque.findByPk(mosqueId);
      expect(dbRow.photoUrl).toBe('/uploads/pending-test.jpg');
      expect(dbRow.pendingPhotoUrl).toBeNull();
    });

    test('PUT /api/admin/mosques/:id/reject-photo clears a pending photo without applying it', async () => {
      await Mosque.update({ pendingPhotoUrl: '/uploads/reject-test.jpg' }, { where: { id: mosqueId } });
      const res = await request(app)
        .put(`/api/admin/mosques/${mosqueId}/reject-photo`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(res.status).toBe(200);

      const dbRow = await Mosque.findByPk(mosqueId);
      expect(dbRow.pendingPhotoUrl).toBeNull();
      expect(dbRow.photoUrl).not.toBe('/uploads/reject-test.jpg');
    });

    test('POST /api/admin/mosques/:id/apply-default-timings fills in the current global defaults', async () => {
      const defaultsRes = await request(app).get('/api/settings/default-timings');
      const res = await request(app)
        .post(`/api/admin/mosques/${mosqueId}/apply-default-timings`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(res.status).toBe(200);

      const dbRow = await Mosque.findByPk(mosqueId);
      expect(dbRow.iqamahTimings.fajr).toBe(defaultsRes.body.fajr);
    });

    test('DELETE /api/admin/mosques/:id removes the mosque', async () => {
      const res = await request(app).delete(`/api/admin/mosques/${mosqueId}`).set('Authorization', `Bearer ${admin.token}`);
      expect(res.status).toBe(200);
      const check = await Mosque.findByPk(mosqueId);
      expect(check).toBeNull();
      mosqueId = null; // already gone — afterAll's destroy() on null id is a safe no-op
    });
  });

  // ── Users ─────────────────────────────────────────────────────────────────
  describe('User management', () => {
    let createdAdminId;

    afterAll(async () => {
      if (createdAdminId) await User.destroy({ where: { id: createdAdminId } });
    });

    test('GET /api/admin/users returns a paginated shape and never leaks password hashes', async () => {
      const res = await request(app).get('/api/admin/users?limit=5').set('Authorization', `Bearer ${admin.token}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.users)).toBe(true);
      expect(res.body.users.every(u => u.password === undefined)).toBe(true);
    });

    test('POST /api/admin/users/create-admin rejects missing fields', async () => {
      const res = await request(app)
        .post('/api/admin/users/create-admin')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ name: testName('incomplete') });
      expect(res.status).toBe(400);
    });

    test('POST /api/admin/users/create-admin creates a new admin account', async () => {
      const res = await request(app)
        .post('/api/admin/users/create-admin')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ name: testName('created-admin'), email: testEmail('created-admin'), password: 'Test@12345' });
      expect(res.status).toBe(201);
      expect(res.body.role).toBe('admin');
      createdAdminId = res.body.id;
    });

    test('POST /api/admin/users/create-admin rejects a duplicate email', async () => {
      const res = await request(app)
        .post('/api/admin/users/create-admin')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ name: testName('created-admin-2'), email: testEmail('created-admin'), password: 'Test@12345' });
      expect(res.status).toBe(400);
    });

    test('PUT /api/admin/users/:id/role toggles a role (only ever on a test-created account)', async () => {
      const res = await request(app)
        .put(`/api/admin/users/${createdAdminId}/role`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ role: 'user' });
      expect(res.status).toBe(200);
      const dbRow = await User.findByPk(createdAdminId);
      expect(dbRow.role).toBe('user');
    });

    test('DELETE /api/admin/users/:id removes the account', async () => {
      const res = await request(app).delete(`/api/admin/users/${createdAdminId}`).set('Authorization', `Bearer ${admin.token}`);
      expect(res.status).toBe(200);
      const check = await User.findByPk(createdAdminId);
      expect(check).toBeNull();
      createdAdminId = null;
    });
  });

  // ── Settings — global, shared config: read current value, mutate, ALWAYS
  // restore it in afterAll (even on failure) so the test suite never leaves
  // the real app's live prayer-time defaults or Hijri correction changed. ──
  describe('Global settings (read-then-restore)', () => {
    let originalDefaultTimings;
    let originalHijriAdjustment;

    beforeAll(async () => {
      const timingsRes = await request(app).get('/api/admin/settings/default-timings').set('Authorization', `Bearer ${admin.token}`);
      originalDefaultTimings = timingsRes.body;
      const hijriRes = await request(app).get('/api/admin/settings/hijri-adjustment').set('Authorization', `Bearer ${admin.token}`);
      originalHijriAdjustment = hijriRes.body.adjustment;
    });

    afterAll(async () => {
      await request(app)
        .post('/api/admin/settings/default-timings')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ timings: originalDefaultTimings });
      await request(app)
        .post('/api/admin/settings/hijri-adjustment')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ adjustment: originalHijriAdjustment });
    });

    test('POST /api/admin/settings/default-timings rejects a non-object payload', async () => {
      const res = await request(app)
        .post('/api/admin/settings/default-timings')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ timings: 'not-an-object' });
      expect(res.status).toBe(400);
    });

    test('POST then GET /api/admin/settings/default-timings round-trips correctly, with maghrib always stripped', async () => {
      const testTimings = { fajr: '04:44', dhuhr: '12:34', asr: '16:16', isha: '19:19', jumma: '12:45', maghrib: '18:00' };
      const postRes = await request(app)
        .post('/api/admin/settings/default-timings')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ timings: testTimings });
      expect(postRes.status).toBe(200);
      expect(postRes.body.timings).not.toHaveProperty('maghrib');

      const getRes = await request(app).get('/api/admin/settings/default-timings').set('Authorization', `Bearer ${admin.token}`);
      expect(getRes.body.fajr).toBe('04:44');
      expect(getRes.body).not.toHaveProperty('maghrib');

      // The public endpoint must reflect the same value.
      const publicRes = await request(app).get('/api/settings/default-timings');
      expect(publicRes.body.fajr).toBe('04:44');
    });

    test('POST /api/admin/settings/hijri-adjustment rejects an out-of-range value', async () => {
      const res = await request(app)
        .post('/api/admin/settings/hijri-adjustment')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ adjustment: 99 });
      expect(res.status).toBe(400);
    });

    test('POST then GET /api/admin/settings/hijri-adjustment round-trips correctly', async () => {
      const postRes = await request(app)
        .post('/api/admin/settings/hijri-adjustment')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ adjustment: -1 });
      expect(postRes.status).toBe(200);

      const getRes = await request(app).get('/api/admin/settings/hijri-adjustment').set('Authorization', `Bearer ${admin.token}`);
      expect(getRes.body.adjustment).toBe(-1);

      const publicRes = await request(app).get('/api/settings/hijri-adjustment');
      expect(publicRes.body.adjustment).toBe(-1);
    });
  });

  // ── Dangerous / not exercised for real ───────────────────────────────────
  // migrate/strip-maghrib iterates and mutates every real mosque row in the
  // database — only its auth guard is safe to test here, never its actual
  // effect, since this suite runs against the shared production database.
  describe('Migration endpoint (auth guard only — never actually run)', () => {
    test('rejects requests with no token', async () => {
      const res = await request(app).get('/api/admin/migrate/strip-maghrib');
      expect(res.status).toBe(401);
    });

    test('rejects a non-admin user', async () => {
      const res = await request(app).get('/api/admin/migrate/strip-maghrib').set('Authorization', `Bearer ${plainUser.token}`);
      expect(res.status).toBe(403);
    });
  });
});
