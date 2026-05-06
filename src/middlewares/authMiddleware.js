const jwt = require('jsonwebtoken');
const { cacheHelper } = require('../config/redis');
const { errorResponse } = require('../utils/responseHandler');

/**
 * Middleware untuk verifikasi JWT token
 * Melindungi route yang membutuhkan autentikasi
 */
const authenticateToken = async (req, res, next) => {
  try {
    // Get token from header
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json(
        errorResponse('Access token required', 401)
      );
    }

    // Cek apakah token sudah di-blacklist (logout sebelumnya)
    const isBlacklisted = await cacheHelper.get(`blacklist:${token}`);
    if (isBlacklisted) {
      return res.status(401).json(
        errorResponse('Token has been invalidated. Please login again.', 401)
      );
    }

    // Verify token
    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
      if (err) {
        return res.status(403).json(
          errorResponse('Invalid or expired token', 403)
        );
      }

      // Attach user info ke request object
      req.user = {
        id: decoded.id,
        email: decoded.email,
        role: decoded.role
      };

      next();
    });
  } catch (error) {
    return res.status(500).json(
      errorResponse('Authentication error', 500)
    );
  }
};

/**
 * Optional authentication - tidak wajib login
 */
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
      const isBlacklisted = await cacheHelper.get(`blacklist:${token}`);
      if (!isBlacklisted) {
        jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
          if (!err) {
            req.user = {
              id: decoded.id,
              email: decoded.email,
              role: decoded.role
            };
          }
        });
      }
    }

    next();
  } catch (error) {
    next();
  }
};

module.exports = {
  authenticateToken,
  optionalAuth
};
