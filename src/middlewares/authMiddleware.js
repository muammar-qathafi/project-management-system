const jwt = require('jsonwebtoken');
const { promisify } = require('util');
const { redisClient, cacheHelper } = require('../config/redis');
const userRepository = require('../repositories/userRepository');
const { errorResponse } = require('../utils/responseHandler');

// Promisified jwt.verify for clean async/await usage
const jwtVerify = promisify(jwt.verify);

// TTL (seconds) for the role/status cache — limits max lag after a role/status change in DB
const ROLE_CACHE_TTL = 300; // 5 minutes

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

    // [SEC-FIX-1] Fail-closed blacklist check — use redisClient directly so a Redis
    // connection error is catchable. cacheHelper.get() silently returns null on error
    // which would bypass the blacklist (fail-open). Deny the request when the blacklist
    // cannot be verified.
    try {
      const isBlacklisted = await redisClient.get(`blacklist:${token}`);
      if (isBlacklisted) {
        return res.status(401).json(
          errorResponse('Token has been invalidated. Please login again.', 401)
        );
      }
    } catch (redisError) {
      return res.status(503).json(
        errorResponse('Service temporarily unavailable. Please try again.', 503)
      );
    }

    // [SEC-FIX-2] Verify token with algorithm pinned to HS256.
    // Without this, an attacker could forge tokens using alg:none or an RS256 downgrade.
    let decoded;
    try {
      decoded = await jwtVerify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    } catch (err) {
      return res.status(403).json(
        errorResponse('Invalid or expired token', 403)
      );
    }

    // [SEC-FIX-3] Re-validate role and active status from DB (cached in Redis).
    // Trusting role from the JWT payload alone allows a stale-JWT privilege escalation:
    // a demoted admin could keep admin rights for up to 24 h (token lifetime).
    // The cache limits the lag to ROLE_CACHE_TTL seconds after a role/status change.
    const cacheKey = `user:auth:${decoded.id}`;
    let userInfo = await cacheHelper.get(cacheKey);

    if (!userInfo) {
      const user = await userRepository.findById(decoded.id);
      if (!user) {
        return res.status(401).json(
          errorResponse('Account not found', 401)
        );
      }
      userInfo = { role: user.role, isActive: user.is_active };
      await cacheHelper.set(cacheKey, userInfo, ROLE_CACHE_TTL);
    }

    if (!userInfo.isActive) {
      return res.status(401).json(
        errorResponse('Account is deactivated', 401)
      );
    }

    // Attach user info — role is sourced from DB, not the JWT payload
    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: userInfo.role
    };

    next();
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
      try {
        // For optional auth, Redis errors are non-fatal — treat as "not blacklisted"
        const isBlacklisted = await redisClient.get(`blacklist:${token}`).catch(() => null);
        if (!isBlacklisted) {
          // [SEC-FIX-2] Algorithm pinned here as well
          const decoded = await jwtVerify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });

          // [SEC-FIX-3] Re-validate from DB/cache
          const cacheKey = `user:auth:${decoded.id}`;
          let userInfo = await cacheHelper.get(cacheKey);

          if (!userInfo) {
            const user = await userRepository.findById(decoded.id);
            if (user && user.is_active) {
              userInfo = { role: user.role, isActive: user.is_active };
              await cacheHelper.set(cacheKey, userInfo, ROLE_CACHE_TTL);
            }
          }

          if (userInfo && userInfo.isActive) {
            req.user = {
              id: decoded.id,
              email: decoded.email,
              role: userInfo.role
            };
          }
        }
      } catch (e) {
        // Token invalid or service error — proceed without auth for optional routes
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
