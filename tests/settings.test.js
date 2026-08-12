const request = require('supertest');
const app = require('../index');

describe('Public settings routes (/api/settings)', () => {
  test('GET /api/settings/default-timings returns prayer times without maghrib (always location sunset)', async () => {
    const res = await request(app).get('/api/settings/default-timings');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('fajr');
    expect(res.body).toHaveProperty('dhuhr');
    expect(res.body).toHaveProperty('asr');
    expect(res.body).toHaveProperty('isha');
    expect(res.body).not.toHaveProperty('maghrib');
  });

  test('GET /api/settings/hijri-adjustment returns a numeric day offset', async () => {
    const res = await request(app).get('/api/settings/hijri-adjustment');
    expect(res.status).toBe(200);
    expect(typeof res.body.adjustment).toBe('number');
  });
});
