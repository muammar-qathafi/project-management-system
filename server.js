require('dotenv').config();

// ─── Environment Variable Validation ─────────────────────────────────────────
// Fail fast sebelum menyentuh DB / Redis / RabbitMQ.
// Tambahkan variabel baru ke sini jika diperlukan.
const REQUIRED_ENV = [
  'JWT_SECRET',
  'DB_HOST',
  'DB_NAME',
  'DB_USER',
  'REDIS_HOST',
  'RABBITMQ_URL',
];

const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`[Startup] Missing required environment variables:\n  ${missing.join('\n  ')}`);
  console.error('[Startup] Copy .env.example to .env and fill in the values.');
  process.exit(1);
}

if (process.env.JWT_SECRET.length < 32) {
  console.error('[Startup] JWT_SECRET must be at least 32 characters long.');
  process.exit(1);
}
// ─────────────────────────────────────────────────────────────────────────────

const app = require('./src/app');
const { sequelize, testConnection } = require('./src/config/database');
const { connectRedis } = require('./src/config/redis');
const { connectRabbitMQ } = require('./src/config/rabbitmq');
const { verifyMailer } = require('./src/config/mailer');

const PORT = process.env.PORT || 3000;

// Initialize server
const startServer = async () => {
  try {
    console.log('Starting server...');
    
    // Test database connection
    await testConnection();

    // Sync database models (only in development)
    if (process.env.NODE_ENV === 'development') {
      await sequelize.sync({ alter: false });
      console.log('✓ Database models synchronized');
    }

    // Connect to Redis
    await connectRedis();

    // Connect to RabbitMQ
    await connectRabbitMQ();

    // Verify mailer
    await verifyMailer();

    // Start Express server
    app.listen(PORT, () => {
      console.log(`\n🚀 Server is running on port ${PORT}`);
      console.log(`📍 Environment: ${process.env.NODE_ENV}`);
      console.log(`🔗 API: http://localhost:${PORT}/api`);
      console.log(`💚 Health check: http://localhost:${PORT}/health\n`);
    });

  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
};

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  console.log('\nSIGTERM signal received: closing HTTP server');
  await sequelize.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('\nSIGINT signal received: closing HTTP server');
  await sequelize.close();
  process.exit(0);
});

// Start the server
startServer();
