const authService = require('../services/authService');
const { successResponse, errorResponse } = require('../utils/responseHandler');

/**
 * Auth Controller
 * Handle HTTP requests untuk authentication
 * Layer: Controller (HTTP Logic)
 */

class AuthController {
  /**
   * Register user baru
   * POST /api/auth/register
   */
  async register(req, res, next) {
    try {
      // [SEC-FIX-1] role is intentionally excluded — authService enforces 'staff' for all
      // public registrations. Only an Admin can assign elevated roles via /api/users.
      const { name, email, password } = req.body;

      const result = await authService.register({ name, email, password });

      return res.status(201).json(
        successResponse(result, 'User registered successfully', 201)
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Login user
   * POST /api/auth/login
   */
  async login(req, res, next) {
    try {
      const { email, password } = req.body;

      const result = await authService.login(email, password);

      return res.status(200).json(
        successResponse(result, 'Login successful')
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get user profile
   * GET /api/auth/profile
   */
  async getProfile(req, res, next) {
    try {
      const userId = req.user.id;

      const user = await authService.getUserProfile(userId);

      return res.status(200).json(
        successResponse(user, 'Profile retrieved successfully')
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update user profile
   * PUT /api/auth/profile
   */
  async updateProfile(req, res, next) {
    try {
      const userId = req.user.id;
      const updates = req.body;

      const user = await authService.updateProfile(userId, updates);

      return res.status(200).json(
        successResponse(user, 'Profile updated successfully')
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Logout user (optional - untuk invalidate token di Redis)
   * POST /api/auth/logout
   */
  async logout(req, res, next) {
    try {
      const userId = req.user.id;
      const token = req.headers.authorization?.split(' ')[1];

      await authService.logout(userId, token);

      return res.status(200).json(
        successResponse(null, 'Logout successful')
      );
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new AuthController();
