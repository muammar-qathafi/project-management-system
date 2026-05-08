const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const pinoHttp = require('pino-http');
const logger = require('./config/logger');
require('dotenv').config();

// Import routes
const routes = require('./routes');

// Import utils
const { errorResponse } = require('./utils/responseHandler');

// Initialize Express app
const app = express();

// Security middleware
app.use(helmet());

// CORS configuration
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true
}));

// HTTP request/response logger (replaces morgan)
// Setiap request otomatis di-log dengan method, url, status, dan responseTime
app.use(pinoHttp({
  logger,
  // Jangan log health check — terlalu noisy
  autoLogging: { ignore: (req) => req.url === '/health' }
}));

// Body parser middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV
  });
});

// API Routes
app.use('/api', routes);

// 404 handler
app.use((req, res) => {
  res.status(404).json(errorResponse('Route not found', 404));
});

// Global error handler
app.use((err, req, res, next) => {
  logger.error({ err, url: req.url, method: req.method }, 'Unhandled error');

  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  res.status(statusCode).json(errorResponse(message, statusCode, err.errors));
});

module.exports = app;
