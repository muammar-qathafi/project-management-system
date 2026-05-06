const Project = require('../models/project');

/**
 * Project Repository
 * Data access layer untuk project
 * Layer: Repository (Database Operations)
 */
class ProjectRepository {
  /**
   * Get all projects dengan pagination dan filter
   */
  async findAll({ page, limit, status, userId, userRole }) {
    const offset = (page - 1) * limit;
    const where = {};

    if (status) where.status = status;

    // Non-admin hanya bisa lihat project miliknya
    if (userRole !== 'admin') {
      where.owner_id = userId;
    }

    const { count, rows } = await Project.findAndCountAll({
      where,
      limit,
      offset,
      order: [['created_at', 'DESC']]
    });

    return { projects: rows, total: count };
  }

  /**
   * Get project by primary key
   */
  async findById(projectId) {
    return await Project.findByPk(projectId);
  }

  /**
   * Create new project
   */
  async create(projectData) {
    return await Project.create(projectData);
  }

  /**
   * Update project fields
   */
  async update(projectId, updates) {
    const project = await Project.findByPk(projectId);
    if (!project) return null;

    await project.update(updates);
    return project;
  }

  /**
   * Delete project
   */
  async delete(projectId) {
    const project = await Project.findByPk(projectId);
    if (!project) return false;

    await project.destroy();
    return true;
  }
}

module.exports = new ProjectRepository();
