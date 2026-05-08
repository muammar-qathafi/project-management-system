const redis = require('redis');
const logger = require('./logger');
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
  logger.info('Redis client connected');
});

redisClient.on('error', (err) => {
  logger.error({ err }, 'Redis client error');
});

// Connect to Redis
const connectRedis = async () => {
  try {
    await redisClient.connect();
  } catch (error) {
    logger.error({ err: error }, 'Failed to connect to Redis');
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
      logger.error({ err: error, key }, 'Redis set error');
      return false;
    }
  },

  // Get cache
  async get(key) {
    try {
      const data = await redisClient.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      logger.error({ err: error, key }, 'Redis get error');
      return null;
    }
  },

  // Delete cache
  async del(key) {
    try {
      await redisClient.del(key);
      return true;
    } catch (error) {
      logger.error({ err: error, key }, 'Redis del error');
      return false;
    }
  },

  // Delete multiple keys by pattern
  //
  // PERF FIX: Sebelumnya menggunakan KEYS yang bersifat O(n) blocking — satu perintah
  // KEYS menyebabkan Redis tidak bisa melayani request lain sampai scan selesai.
  // Di production dengan jutaan key, ini bisa membekukan Redis selama ratusan ms.
  //
  // Sekarang menggunakan SCAN iterator yang:
  //  1. Non-blocking — setiap iterasi hanya memproses ~COUNT key
  //  2. Aman di production keyspace yang besar
  //  3. Menghapus dalam batch 100 untuk menghindari payload DEL yang besar
  async delPattern(pattern) {
    try {
      const keys = [];
      for await (const key of redisClient.scanIterator({ MATCH: pattern, COUNT: 100 })) {
        keys.push(key);
      }
      if (keys.length > 0) {
        for (let i = 0; i < keys.length; i += 100) {
          await redisClient.del(keys.slice(i, i + 100));
        }
      }
      return true;
    } catch (error) {
      logger.error({ err: error, pattern }, 'Redis delPattern error');
      return false;
    }
  }
};

module.exports = {
  redisClient,
  connectRedis,
  cacheHelper
};
