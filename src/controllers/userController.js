const userRepository = require('../repositories/userRepository');
const { successResponse, errorResponse, paginationResponse } = require('../utils/responseHandler');

/**
 * User Controller
 * Admin-only CRUD untuk manajemen user
 * Layer: Controller (HTTP Logic)
 */

class UserController {
  /**
   * Get all users (Admin only)
   * GET /api/users?page=1&limit=10&role=manager
   */
  async getAllUsers(req, res, next) {
    try {
      const { page = 1, limit = 10, role, is_active } = req.query;

      const result = await userRepository.findAll({
        page: parseInt(page),
        limit: parseInt(limit),
        role,
        is_active: is_active !== undefined ? is_active === 'true' : undefined
      });

      return res.status(200).json(
        paginationResponse(result.users, page, limit, result.total, 'Users retrieved successfully')
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get user by ID (Admin atau diri sendiri)
   * GET /api/users/:id
   */
  async getUserById(req, res, next) {
    try {
      const userId = parseInt(req.params.id);

      const user = await userRepository.findById(userId);
      if (!user) {
        return res.status(404).json(errorResponse('User not found', 404));
      }

      // Hilangkan password dari response
      const { password, ...userWithoutPassword } = user.toJSON();

      return res.status(200).json(
        successResponse(userWithoutPassword, 'User retrieved successfully')
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Create user baru (Admin only)
   * POST /api/users
   */
  async createUser(req, res, next) {
    try {
      const { name, email, password, role = 'staff' } = req.body;

      // Cek apakah email sudah dipakai
      const existingUser = await userRepository.findByEmail(email);
      if (existingUser) {
        return res.status(409).json(errorResponse('Email already in use', 409));
      }

      const user = await userRepository.create({ name, email, password, role });

      const { password: _, ...userWithoutPassword } = user.toJSON();

      return res.status(201).json(
        successResponse(userWithoutPassword, 'User created successfully', 201)
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update user (Admin atau diri sendiri)
   * PUT /api/users/:id
   */
  async updateUser(req, res, next) {
    try {
      const userId = parseInt(req.params.id);
      const { name, email, password, role, is_active } = req.body;

      const user = await userRepository.findById(userId);
      if (!user) {
        return res.status(404).json(errorResponse('User not found', 404));
      }

      // Non-admin tidak boleh mengubah role atau status aktif diri sendiri
      if (req.user.role !== 'admin') {
        if (role !== undefined || is_active !== undefined) {
          return res.status(403).json(
            errorResponse('Only admin can change role or account status.', 403)
          );
        }
      }

      const updates = {};
      if (name !== undefined) updates.name = name;
      if (email !== undefined) {
        // Cek kalau email baru sudah dipakai user lain
        const existing = await userRepository.findByEmail(email);
        if (existing && existing.id !== userId) {
          return res.status(409).json(errorResponse('Email already in use', 409));
        }
        updates.email = email;
      }
      if (password !== undefined) updates.password = password;
      if (role !== undefined) updates.role = role;
      if (is_active !== undefined) updates.is_active = is_active;

      const updated = await userRepository.update(userId, updates);

      const { password: _, ...userWithoutPassword } = updated.toJSON();

      return res.status(200).json(
        successResponse(userWithoutPassword, 'User updated successfully')
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete user (Admin only)
   * DELETE /api/users/:id
   */
  async deleteUser(req, res, next) {
    try {
      const userId = parseInt(req.params.id);

      // Cegah admin menghapus dirinya sendiri
      if (userId === req.user.id) {
        return res.status(400).json(errorResponse('Cannot delete your own account', 400));
      }

      const deleted = await userRepository.delete(userId);
      if (!deleted) {
        return res.status(404).json(errorResponse('User not found', 404));
      }

      return res.status(200).json(
        successResponse(null, 'User deleted successfully')
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Toggle status aktif user (Admin only)
   * PATCH /api/users/:id/status
   */
  async updateUserStatus(req, res, next) {
    try {
      const userId = parseInt(req.params.id);
      const { is_active } = req.body;

      if (typeof is_active !== 'boolean') {
        return res.status(400).json(errorResponse('is_active must be a boolean', 400));
      }

      const user = await userRepository.updateStatus(userId, is_active);
      if (!user) {
        return res.status(404).json(errorResponse('User not found', 404));
      }

      const { password, ...userWithoutPassword } = user.toJSON();

      return res.status(200).json(
        successResponse(userWithoutPassword, `User ${is_active ? 'activated' : 'deactivated'} successfully`)
      );
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new UserController();
