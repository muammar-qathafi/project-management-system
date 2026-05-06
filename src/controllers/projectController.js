const projectService = require('../services/projectService');
const { successResponse, errorResponse, paginationResponse } = require('../utils/responseHandler');

/**
 * Project Controller
 * Handle HTTP requests untuk project management
 * Layer: Controller (HTTP Logic)
 */

class ProjectController {
  /**
   * Get all projects
   * GET /api/projects
   */
  async getAllProjects(req, res, next) {
    try {
      const { page = 1, limit = 10, status } = req.query;
      const userId = req.user.id;
      const userRole = req.user.role;

      const result = await projectService.getAllProjects({
        page: parseInt(page),
        limit: parseInt(limit),
        status,
        userId,
        userRole
      });

      return res.status(200).json(
        paginationResponse(
          result.projects,
          page,
          limit,
          result.total,
          'Projects retrieved successfully'
        )
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get project by ID
   * GET /api/projects/:id
   */
  async getProjectById(req, res, next) {
    try {
      const projectId = parseInt(req.params.id);
      const userId = req.user.id;

      const project = await projectService.getProjectById(projectId, userId);

      return res.status(200).json(
        successResponse(project, 'Project retrieved successfully')
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Create new project
   * POST /api/projects
   */
  async createProject(req, res, next) {
    try {
      const projectData = req.body;
      const ownerId = req.user.id;

      const project = await projectService.createProject({ ...projectData, owner_id: ownerId });

      return res.status(201).json(
        successResponse(project, 'Project created successfully', 201)
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update project
   * PUT /api/projects/:id
   */
  async updateProject(req, res, next) {
    try {
      const projectId = parseInt(req.params.id);
      const updates = req.body;
      const userId = req.user.id;

      const project = await projectService.updateProject(projectId, updates, userId);

      return res.status(200).json(
        successResponse(project, 'Project updated successfully')
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete project
   * DELETE /api/projects/:id
   */
  async deleteProject(req, res, next) {
    try {
      const projectId = parseInt(req.params.id);
      const userId = req.user.id;

      await projectService.deleteProject(projectId, userId);

      return res.status(200).json(
        successResponse(null, 'Project deleted successfully')
      );
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new ProjectController();
