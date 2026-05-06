const User = require('../models/user');

/**
 * User Repository
 * Data access layer untuk User model
 * Layer: Repository (Data Access)
 */

class UserRepository {
  /**
   * Find user by ID
   */
  async findById(userId) {
    return await User.findByPk(userId);
  }

  /**
   * Find user by email
   */
  async findByEmail(email) {
    return await User.findOne({ where: { email } });
  }

  /**
   * Create new user
   */
  async create(userData) {
    return await User.create(userData);
  }

  /**
   * Update user
   */
  async update(userId, updates) {
    const user = await User.findByPk(userId);
    if (!user) return null;

    await user.update(updates);
    return user;
  }

  /**
   * Delete user
   */
  async delete(userId) {
    const user = await User.findByPk(userId);
    if (!user) return false;

    await user.destroy();
    return true;
  }

  /**
   * Find all users dengan filter
   */
  async findAll(filters = {}) {
    const { page = 1, limit = 10, role, is_active } = filters;
    const offset = (page - 1) * limit;

    const where = {};
    if (role) where.role = role;
    if (is_active !== undefined) where.is_active = is_active;

    const { count, rows } = await User.findAndCountAll({
      where,
      limit,
      offset,
      order: [['created_at', 'DESC']]
    });

    return {
      users: rows,
      total: count
    };
  }

  /**
   * Update user status (activate/deactivate)
   */
  async updateStatus(userId, isActive) {
    const user = await User.findByPk(userId);
    if (!user) return null;

    await user.update({ is_active: isActive });
    return user;
  }
}

module.exports = new UserRepository();
