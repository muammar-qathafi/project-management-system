/**
 * Jest config khusus untuk integration tests.
 * Dipakai oleh: npm run test:integration
 *
 * Perbedaan dari config default (package.json):
 *  - Hanya jalankan tests/integration/**
 *  - testTimeout = 120s (siklus RabbitMQ ~60s + buffer)
 *  - runInBand = true (tests jalan serial, tidak parallel)
 */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/integration/**/*.test.js'],
  testTimeout: 480_000,
  forceExit: true,
  detectOpenHandles: true,
  verbose: true,
};
