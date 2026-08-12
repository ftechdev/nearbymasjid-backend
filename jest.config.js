module.exports = {
  testEnvironment: 'node',
  // Network-touching integration tests (real DB, occasionally real Aladhan/Google
  // calls) are slower than unit tests — 30s covers even a cold Hostinger connection.
  testTimeout: 30000,
  // Every test file shares one real DB connection pool and mutates shared rows
  // (see tests/testHelpers.js) — running them in parallel workers would race.
  // (--runInBand in the npm script enforces this; maxWorkers here is a second guard.)
  maxWorkers: 1,
  setupFilesAfterEnv: ['./tests/jestSetupAfterEnv.js'],
  globalTeardown: './tests/globalTeardown.js',
};
