const jwt = require('jsonwebtoken');
const userRepository = require('../repositories/userRepository');
const { cacheHelper } = require('../config/redis');

/**
 * Auth Service
 * Business logic untuk authentication & authorization
 * Layer: Service (Business Logic)
 */

class AuthService {
  /**
   * Register user baru
   */
  async register(userData) {
    // [SEC-FIX-1] Force role to 'staff' — public registration must never grant elevated
    // privileges regardless of what the caller sends in the request body.
    const safeUserData = { ...userData, role: 'staff' };

    // Check if email already exists
    const existingUser = await userRepository.findByEmail(safeUserData.email);
    if (existingUser) {
      const error = new Error('Email already registered');
      error.statusCode = 400;
      throw error;
    }

    // Create user (password akan di-hash di model hook)
    const user = await userRepository.create(safeUserData);

    // Generate JWT token
    const token = this.generateToken(user);

    return {
      user,
      token
    };
  }

  /**
   * Login user
   */
  async login(email, password) {
    // Find user by email
    const user = await userRepository.findByEmail(email);
    if (!user) {
      const error = new Error('Invalid email or password');
      error.statusCode = 401;
      throw error;
    }

    // Check if user is active
    if (!user.is_active) {
      const error = new Error('Account is deactivated');
      error.statusCode = 403;
      throw error;
    }

    // Validate password
    const isValidPassword = await user.validatePassword(password);
    if (!isValidPassword) {
      const error = new Error('Invalid email or password');
      error.statusCode = 401;
      throw error;
    }

    // Generate JWT token
    const token = this.generateToken(user);

    return {
      user,
      token
    };
  }

  /**
   * Get user profile
   */
  async getUserProfile(userId) {
    const user = await userRepository.findById(userId);
    if (!user) {
      const error = new Error('User not found');
      error.statusCode = 404;
      throw error;
    }

    return user;
  }

  /**
   * Update user profile
   */
  async updateProfile(userId, updates) {
    // Don't allow updating role or email through this endpoint
    delete updates.role;
    delete updates.email;

    const user = await userRepository.update(userId, updates);
    if (!user) {
      const error = new Error('User not found');
      error.statusCode = 404;
      throw error;
    }

    return user;
  }

  /**
   * Logout - invalidate token (store in Redis blacklist)
   */
  async logout(userId, token) {
    if (token) {
      // Store token in blacklist dengan TTL sesuai expiry token
      const decoded = jwt.decode(token);
      const ttl = decoded.exp - Math.floor(Date.now() / 1000);
      
      if (ttl > 0) {
        await cacheHelper.set(`blacklist:${token}`, true, ttl);
      }
    }

    return true;
  }

  /**
   * Generate JWT token
   */
  generateToken(user) {
    const payload = {
      id: user.id,
      email: user.email,
      role: user.role
    };

    // [SEC-FIX-2] Pin algorithm to HS256 to prevent algorithm confusion attacks
    return jwt.sign(payload, process.env.JWT_SECRET, {
      algorithm: 'HS256',
      expiresIn: process.env.JWT_EXPIRES_IN || '24h'
    });
  }

  /**
   * Verify token (untuk middleware)
   */
  verifyToken(token) {
    // [SEC-FIX-2] Algorithm pinned
    return jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
  }
}

module.exports = new AuthService();
