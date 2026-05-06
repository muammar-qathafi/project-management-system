const redis = require('redis');
require('dotenv').config();

// Konfigurasi Redis client untuk caching
const redisClient = redis.createClient({
  socket: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379
  },
  password: process.env.REDIS_PASSWORD || undefined,
  database: process.env.REDIS_DB || 0
});

redisClient.on('connect', () => {
  console.log('✓ Redis client connected');
});

redisClient.on('error', (err) => {
  console.error('✗ Redis client error:', err.message);
});

// Connect to Redis
const connectRedis = async () => {
  try {
    await redisClient.connect();
  } catch (error) {
    console.error('✗ Failed to connect to Redis:', error.message);
  }
};

// Helper functions untuk cache operations
const cacheHelper = {
  // Set cache dengan TTL
  async set(key, value, ttl = process.env.CACHE_TTL || 3600) {
    try {
      await redisClient.setEx(key, parseInt(ttl), JSON.stringify(value));
      return true;
    } catch (error) {
      console.error('Redis set error:', error.message);
      return false;
    }
  },

  // Get cache
  async get(key) {
    try {
      const data = await redisClient.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error('Redis get error:', error.message);
      return null;
    }
  },

  // Delete cache
  async del(key) {
    try {
      await redisClient.del(key);
      return true;
    } catch (error) {
      console.error('Redis del error:', error.message);
      return false;
    }
  },

  // Delete multiple keys by pattern
  async delPattern(pattern) {
    try {
      const keys = await redisClient.keys(pattern);
      if (keys.length > 0) {
        await redisClient.del(keys);
      }
      return true;
    } catch (error) {
      console.error('Redis delPattern error:', error.message);
      return false;
    }
  }
};

module.exports = {
  redisClient,
  connectRedis,
  cacheHelper
};
