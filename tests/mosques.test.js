const request = require('supertest');
const { Op } = require('sequelize');
const app = require('../index');
const { registerTestUser, createTestAdmin, testName, User, Mosque } = require('./testHelpers');

// Deliberately in the middle of the Southern Ocean — impossible to collide
// with any real mosque, so the duplicate-detection test below is exercising
// our own fixture, never real data.
const TEST_LAT = -75.123456;
const TEST_LNG = 0.123456;

describe('Mosque routes (/api/mosques)', () => {
  let user;
  let createdMosqueId;
  let googleImportedMosqueId;

  beforeAll(async () => {
    user = await registerTestUser(request, app, 'mosques-user');
  });

  afterAll(async () => {
    if (createdMosqueId) await Mosque.destroy({ where: { id: createdMosqueId } });
    if (googleImportedMosqueId) await Mosque.destroy({ where: { id: googleImportedMosqueId } });
    await User.destroy({ where: { id: user._id } });
  });

  // ── GET / (public list) ──────────────────────────────────────────────────
  test('GET /api/mosques with no coordinates returns an array (no Google merge triggered)', async () => {
    const res = await request(app).get('/api/mosques');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('GET /api/mosques rejects an out-of-range latitude', async () => {
    const res = await request(app).get('/api/mosques?lat=999&lng=0');
    expect(res.status).toBe(400);
  });

  // ── GET /:id ──────────────────────────────────────────────────────────────
  test('GET /api/mosques/:id returns 404 for an unknown id', async () => {
    const res = await request(app).get('/api/mosques/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
  });

  // ── GET /proxy-photo ─────────────────────────────────────────────────────
  test('GET /api/mosques/proxy-photo rejects a missing ref', async () => {
    const res = await request(app).get('/api/mosques/proxy-photo');
    expect(res.status).toBe(400);
  });

  // ── POST / (submit a new mosque) ─────────────────────────────────────────
  test('POST /api/mosques rejects an unauthenticated request', async () => {
    const res = await request(app).post('/api/mosques').send({ name: 'x', address: 'x', location: { lat: 1, lng: 1 } });
    expect(res.status).toBe(401);
  });

  test('POST /api/mosques rejects a missing name/address/location', async () => {
    const res = await request(app)
      .post('/api/mosques')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ address: 'x' });
    expect(res.status).toBe(400);
  });

  test('POST /api/mosques creates a new, unapproved mosque', async () => {
    const res = await request(app)
      .post('/api/mosques')
      .set('Authorization', `Bearer ${user.token}`)
      .send({
        name: testName('mosque'),
        address: testName('address'),
        location: { lat: TEST_LAT, lng: TEST_LNG },
        school: 'hanafi',
      });
    expect(res.status).toBe(201);
    expect(res.body.isApproved).toBe(false);
    createdMosqueId = res.body.id;
  });

  test('GET /api/mosques/:id finds the newly created mosque', async () => {
    const res = await request(app).get(`/api/mosques/${createdMosqueId}`);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe(testName('mosque'));
  });

  test('POST /api/mosques with the same coordinates updates the existing mosque instead of creating a duplicate', async () => {
    const res = await request(app)
      .post('/api/mosques')
      .set('Authorization', `Bearer ${user.token}`)
      .send({
        name: testName('mosque (renamed)'),
        address: testName('address'),
        location: { lat: TEST_LAT, lng: TEST_LNG },
        school: 'hanafi',
      });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/already added/i);
    expect(res.body.mosque.id).toBe(createdMosqueId);

    const total = await Mosque.count({ where: { name: { [Op.like]: `${testName('mosque')}%` } } });
    expect(total).toBe(1); // still exactly one row, not two
  });

  // ── PUT /:id/timings ──────────────────────────────────────────────────────
  test('PUT /:id/timings rejects an unauthenticated request', async () => {
    const res = await request(app).put(`/api/mosques/${createdMosqueId}/timings`).send({ iqamahTimings: { fajr: '05:00' } });
    expect(res.status).toBe(401);
  });

  test('PUT /:id/timings rejects an empty timings payload', async () => {
    const res = await request(app)
      .put(`/api/mosques/${createdMosqueId}/timings`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ iqamahTimings: {} });
    expect(res.status).toBe(400);
  });

  // Trust-based approval: a mosque's first-ever timing submission (or one from
  // someone other than whoever's timing was last approved) needs admin review;
  // that same trusted user's later updates go live immediately.
  test('PUT /:id/timings on a mosque with no prior approved timing is pending, not live', async () => {
    const res = await request(app)
      .put(`/api/mosques/${createdMosqueId}/timings`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ iqamahTimings: { fajr: '05:15', dhuhr: '13:30' } });
    expect(res.status).toBe(200);
    expect(res.body.iqamahTimings.fajr).toBe('05:15');
    expect(res.body.timingsApproved).toBe(false);

    const dbRow = await Mosque.findByPk(createdMosqueId);
    expect(dbRow.timingsApproved).toBe(false);
  });

  test('once an admin approves it, the SAME user\'s next update goes live immediately', async () => {
    const admin = await createTestAdmin('mosques-timing-admin');
    await request(app).put(`/api/admin/mosques/${createdMosqueId}/approve-timing`).set('Authorization', `Bearer ${admin.token}`);

    const res = await request(app)
      .put(`/api/mosques/${createdMosqueId}/timings`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ iqamahTimings: { fajr: '05:20' } });
    expect(res.body.timingsApproved).toBe(true);

    await admin.user.destroy();
  });

  test('a DIFFERENT user updating the same mosque needs approval again', async () => {
    const otherUser = await registerTestUser(request, app, 'mosques-other-user');
    const res = await request(app)
      .put(`/api/mosques/${createdMosqueId}/timings`)
      .set('Authorization', `Bearer ${otherUser.token}`)
      .send({ iqamahTimings: { fajr: '05:25' } });
    expect(res.body.timingsApproved).toBe(false);

    await User.destroy({ where: { id: otherUser._id } });
  });

  // ── PUT /:id/photo ────────────────────────────────────────────────────────
  test('PUT /:id/photo on an EXISTING mosque goes to pending review, not live immediately', async () => {
    const res = await request(app)
      .put(`/api/mosques/${createdMosqueId}/photo`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ photoUrl: '/uploads/test-photo.jpg' });
    expect(res.status).toBe(200);
    expect(res.body.pending).toBe(true);

    const dbRow = await Mosque.findByPk(createdMosqueId);
    expect(dbRow.pendingPhotoUrl).toBe('/uploads/test-photo.jpg');
    expect(dbRow.photoUrl).not.toBe('/uploads/test-photo.jpg'); // live photo untouched
  });

  // ── GET /my-mosques ───────────────────────────────────────────────────────
  test('GET /api/mosques/my-mosques lists mosques added by the current user', async () => {
    const res = await request(app).get('/api/mosques/my-mosques').set('Authorization', `Bearer ${user.token}`);
    expect(res.status).toBe(200);
    expect(res.body.some(m => m.id === createdMosqueId)).toBe(true);
  });

  test('GET /api/mosques/my-mosques rejects an unauthenticated request', async () => {
    const res = await request(app).get('/api/mosques/my-mosques');
    expect(res.status).toBe(401);
  });

  // ── Google-Places-sourced mosque: find-or-create on first crowdsourced edit ─
  // This is the exact mechanism the app relies on when a user selects a
  // Google-Places-only mosque (not yet in the DB) as "my masjid".
  test('PUT /:id/timings auto-creates a DB row for a not-yet-imported Google mosque when mosqueData is supplied', async () => {
    const fakeGooglePlaceId = `ChIJ_test_${Date.now()}`;
    const res = await request(app)
      .put(`/api/mosques/${fakeGooglePlaceId}/timings`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({
        iqamahTimings: { fajr: '05:20' },
        mosqueData: {
          name: testName('google-imported'),
          address: testName('google address'),
          lat: TEST_LAT + 1,
          lng: TEST_LNG + 1,
          googlePlaceId: fakeGooglePlaceId,
        },
      });
    expect(res.status).toBe(200);

    const dbRow = await Mosque.findOne({ where: { googlePlaceId: fakeGooglePlaceId } });
    expect(dbRow).toBeTruthy();
    expect(dbRow.isApproved).toBe(false); // crowdsourced additions still need admin review
    googleImportedMosqueId = dbRow.id;

    // The exact lookup path PrayerTimesScreen relies on — GET /:id by googlePlaceId.
    const getRes = await request(app).get(`/api/mosques/${fakeGooglePlaceId}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.id).toBe(dbRow.id);
  });

  test('PUT /:id/timings with an unknown id and no mosqueData returns 404 (cannot silently create)', async () => {
    const res = await request(app)
      .put('/api/mosques/00000000-0000-0000-0000-000000000000/timings')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ iqamahTimings: { fajr: '05:00' } });
    expect(res.status).toBe(404);
  });
});
