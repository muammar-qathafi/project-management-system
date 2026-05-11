const projectRepository = require('../repositories/projectRepository');
const { cacheHelper } = require('../config/redis');
const User = require('../models/user');

/**
 * Project Service
 * Business logic untuk project management
 * Layer: Service (Business Logic)
 */

class ProjectService {
  /**
   * Invalidate semua cache yang berkaitan dengan project tertentu
   */
  async invalidateProjectCache(projectId) {
    await Promise.all([
      cacheHelper.delPattern('tasks:list:*'),
      cacheHelper.del(`tasks:tree:${projectId}`),
      cacheHelper.del(`tasks:tree:metadata:${projectId}`),
      cacheHelper.delPattern('tasks:tree:all:*')
    ]);
  }

  /**
   * Get all projects dengan pagination
   */
  async getAllProjects(filters) {
    const { page, limit, status, userId, userRole } = filters;
    return await projectRepository.findAll({ page, limit, status, userId, userRole });
  }

  /**
   * Get project by ID
   */
  async getProjectById(projectId) {
    const project = await projectRepository.findById(projectId);

    if (!project) {
      const error = new Error('Project not found');
      error.statusCode = 404;
      throw error;
    }

    return project;
  }

  /**
   * Create new project
   * owner_id harus user dengan role Manager (sesuai requirement)
   */
  async createProject(projectData) {
    // Validasi owner_id harus role manager
    if (projectData.owner_id) {
      const owner = await User.findByPk(projectData.owner_id);
      if (!owner) {
        const error = new Error('Assigned user not found');
        error.statusCode = 404;
        throw error;
      }
      if (owner.role !== 'manager') {
        const error = new Error('Project can only be assigned to a user with role Manager');
        error.statusCode = 400;
        throw error;
      }
    }

    return await projectRepository.create(projectData);
  }

  /**
   * Update project
   */
  async updateProject(projectId, updates) {
    const project = await projectRepository.update(projectId, updates);

    if (!project) {
      const error = new Error('Project not found');
      error.statusCode = 404;
      throw error;
    }

    await this.invalidateProjectCache(projectId);

    return project;
  }

  /**
   * Delete project
   */
  async deleteProject(projectId) {
    const deleted = await projectRepository.delete(projectId);

    if (!deleted) {
      const error = new Error('Project not found');
      error.statusCode = 404;
      throw error;
    }

    await this.invalidateProjectCache(projectId);

    return true;
  }
}

module.exports = new ProjectService();
