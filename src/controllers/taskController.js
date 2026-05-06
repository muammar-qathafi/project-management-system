const taskService = require('../services/taskService');
const { successResponse, errorResponse, paginationResponse } = require('../utils/responseHandler');

/**
 * Task Controller
 * Handle HTTP requests untuk task management
 * Layer: Controller (HTTP Logic)
 */

class TaskController {
  /**
   * Get all tasks dengan pagination dan caching
   * GET /api/tasks?page=1&limit=10
   */
  async getAllTasks(req, res, next) {
    try {
      const { page = 1, limit = 10, status, priority, project_id } = req.query;
      const userId = req.user.id;

      const result = await taskService.getAllTasks({
        page: parseInt(page),
        limit: parseInt(limit),
        status,
        priority,
        project_id,
        userId
      });

      return res.status(200).json(
        paginationResponse(
          result.tasks,
          page,
          limit,
          result.total,
          'Tasks retrieved successfully'
        )
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get tasks dalam tree structure (recursive)
   * GET /api/tasks/tree?project_id=1
   */
  async getTaskTree(req, res, next) {
    try {
      const { project_id } = req.query;
      const userId = req.user.id;

      if (!project_id) {
        return res.status(400).json(
          errorResponse('Project ID is required', 400)
        );
      }

      const result = await taskService.getTaskTree(parseInt(project_id), userId);

      return res.status(200).json(
        successResponse(result, 'Task tree retrieved successfully')
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get tasks tree dengan metadata lengkap
   * GET /api/tasks/tree/metadata?project_id=1
   */
  async getTaskTreeWithMetadata(req, res, next) {
    try {
      const { project_id } = req.query;
      const userId = req.user.id;

      if (!project_id) {
        return res.status(400).json(
          errorResponse('Project ID is required', 400)
        );
      }

      const result = await taskService.getTaskTreeWithMetadata(parseInt(project_id), userId);

      return res.status(200).json(
        successResponse(result, 'Task tree with metadata retrieved successfully')
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get all tasks tree (all projects)
   * GET /api/tasks/tree/all?status=pending&priority=high
   */
  async getAllTasksTree(req, res, next) {
    try {
      const { status, priority } = req.query;
      const userId = req.user.id;

      const result = await taskService.getAllTasksTree({ status, priority });

      return res.status(200).json(
        successResponse(result, 'All tasks tree retrieved successfully')
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Search task in tree
   * GET /api/tasks/tree/search?project_id=1&q=authentication
   */
  async searchTaskInTree(req, res, next) {
    try {
      const { project_id, q } = req.query;
      const userId = req.user.id;

      if (!project_id || !q) {
        return res.status(400).json(
          errorResponse('Project ID and search query are required', 400)
        );
      }

      const result = await taskService.searchTaskInTree(parseInt(project_id), q);

      if (!result) {
        return res.status(404).json(
          errorResponse('Task not found', 404)
        );
      }

      return res.status(200).json(
        successResponse(result, 'Task found in tree')
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get filtered task tree
   * GET /api/tasks/tree/filter?project_id=1&status=pending&priority=high
   */
  async getFilteredTaskTree(req, res, next) {
    try {
      const { project_id, status, priority, assigned_to } = req.query;
      const userId = req.user.id;

      if (!project_id) {
        return res.status(400).json(
          errorResponse('Project ID is required', 400)
        );
      }

      const result = await taskService.getFilteredTaskTree(
        parseInt(project_id), 
        { 
          status, 
          priority, 
          assigned_to: assigned_to ? parseInt(assigned_to) : undefined 
        }
      );

      return res.status(200).json(
        successResponse(result, 'Filtered task tree retrieved successfully')
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get task by ID
   * GET /api/tasks/:id
   */
  async getTaskById(req, res, next) {
    try {
      const taskId = parseInt(req.params.id);
      const userId = req.user.id;

      const task = await taskService.getTaskById(taskId, userId);

      return res.status(200).json(
        successResponse(task, 'Task retrieved successfully')
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Create new task
   * POST /api/tasks
   */
  async createTask(req, res, next) {
    try {
      const taskData = req.body;
      const createdBy = req.user.id;

      const task = await taskService.createTask({ ...taskData, created_by: createdBy });

      return res.status(201).json(
        successResponse(task, 'Task created successfully', 201)
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update task
   * PUT /api/tasks/:id
   */
  async updateTask(req, res, next) {
    try {
      const taskId = parseInt(req.params.id);
      const updates = req.body;
      const userId = req.user.id;

      const task = await taskService.updateTask(taskId, updates, userId);

      return res.status(200).json(
        successResponse(task, 'Task updated successfully')
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete task (cascade delete subtasks)
   * DELETE /api/tasks/:id
   */
  async deleteTask(req, res, next) {
    try {
      const taskId = parseInt(req.params.id);
      const userId = req.user.id;

      await taskService.deleteTask(taskId, userId);

      return res.status(200).json(
        successResponse(null, 'Task deleted successfully')
      );
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new TaskController();
