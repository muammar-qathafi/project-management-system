const projectRepository = require('../repositories/projectRepository');
const { cacheHelper } = require('../config/redis');

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
   */
  async createProject(projectData) {
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
