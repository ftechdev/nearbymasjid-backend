// Runs once per test FILE (Jest gives each file its own module registry, so
// each one that requires ../index.js opens its own separate Sequelize pool —
// see config/db.js). Without this, pools from every file stay open and pile
// up for the whole suite run, which is exactly what exhausted Hostinger's
// max_connections_per_hour quota the first time this suite ran.
afterAll(async () => {
  const { sequelize } = require('./testHelpers');
  await sequelize.close();
});
