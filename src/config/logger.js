const pino = require('pino');
const path = require('path');
const fs = require('fs');

const logsDir = path.join(__dirname, '..', '..', 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}
const logFileName = process.env.NODE_ENV === 'test' ? 'app_test.log' : 'app.log';
const logFile = path.join(logsDir, logFileName);

/**
 * Centralized Logger (Pino)
 *
 * Level berdasarkan environment:
 *  - development : debug  (semua log termasuk SQL query dan cache hit/miss)
 *  - test        : warn   (hanya warning dan error agar test output bersih)
 *  - production  : info   (info, warn, error — tanpa debug noise)
 *
 * Output:
 *  - development : pino-pretty (berwarna, human-readable, timestamp HH:MM:ss)
 *  - production  : JSON murni ke stdout (diteruskan ke log aggregator)
 *
 * Redaction:
 *  Field sensitif tidak akan pernah muncul di log meskipun object-nya diteruskan.
 */
const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),

  base: {
    service: 'project-management-api',
    env: process.env.NODE_ENV || 'development'
  },

  // Jangan log credentials atau token meskipun ada di object yang di-log
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.token',
      '*.secret'
    ],
    censor: '[REDACTED]'
  },

  // pino-pretty hanya aktif di non-production
  transport: process.env.NODE_ENV !== 'production'
    ? {
      targets: [
        { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:yyyy-mm-dd HH:MM:ss', ignore: 'pid,hostname,service,env' } },
        { target: 'pino-pretty', options: { colorize: false, translateTime: 'SYS:yyyy-mm-dd HH:MM:ss', ignore: 'pid,hostname,service,env', destination: logFile } }
      ]
    }
    : undefined
});

module.exports = logger;
