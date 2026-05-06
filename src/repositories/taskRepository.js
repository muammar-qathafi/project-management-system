const Task = require('../models/task');
const { Op } = require('sequelize');

/**
 * Task Repository
 * Data access layer untuk Task model
 * Layer: Repository (Data Access)
 */

class TaskRepository {
  /**
   * Find task by ID
   */
  async findById(taskId) {
    return await Task.findByPk(taskId, {
      include: [
        { association: 'subtasks' },
        { association: 'parent' }
      ]
    });
  }

  /**
   * Find all tasks dengan filters dan pagination
   */
  async findAll(filters = {}) {
    const { page = 1, limit = 10, status, priority, project_id } = filters;
    const offset = (page - 1) * limit;

    const where = {};
    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (project_id) where.project_id = project_id;

    const { count, rows } = await Task.findAndCountAll({
      where,
      limit,
      offset,
      order: [['created_at', 'DESC']]
    });

    return {
      tasks: rows,
      total: count
    };
  }

  /**
   * Find all tasks by project ID (untuk tree building)
   */
  async findByProject(projectId) {
    return await Task.findAll({
      where: { project_id: projectId },
      order: [['created_at', 'ASC']]
    });
  }

  /**
   * Find tasks by parent task ID
   */
  async findByParentId(parentId) {
    return await Task.findAll({
      where: { parent_task_id: parentId },
      order: [['created_at', 'ASC']]
    });
  }

  /**
   * Find overdue tasks (due_date < now AND status != completed)
   */
  async findOverdue() {
    return await Task.findAll({
      where: {
        due_date: {
          [Op.lt]: new Date()
        },
        status: {
          [Op.notIn]: ['closed', 'overdue']
        }
      }
    });
  }

  /**
   * Create new task
   */
  async create(taskData) {
    return await Task.create(taskData);
  }

  /**
   * Update task
   */
  async update(taskId, updates) {
    const task = await Task.findByPk(taskId);
    if (!task) return null;

    await task.update(updates);
    return task;
  }

  /**
   * Delete task
   */
  async delete(taskId) {
    const task = await Task.findByPk(taskId);
    if (!task) return false;

    await task.destroy();
    return true;
  }

  /**
   * Bulk update tasks (untuk batch operations)
   */
  async bulkUpdate(taskIds, updates) {
    return await Task.update(updates, {
      where: {
        id: {
          [Op.in]: taskIds
        }
      }
    });
  }

  /**
   * Find tasks by assigned user
   */
  async findByAssignedUser(userId, filters = {}) {
    const { status, priority, project_id } = filters;

    const where = { assigned_to: userId };
    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (project_id) where.project_id = project_id;

    return await Task.findAll({
      where,
      order: [['due_date', 'ASC']]
    });
  }

  /**
   * Count tasks by status untuk dashboard
   */
  async countByStatus(projectId) {
    const tasks = await Task.findAll({
      where: { project_id: projectId },
      attributes: [
        'status',
        [Task.sequelize.fn('COUNT', Task.sequelize.col('id')), 'count']
      ],
      group: ['status']
    });

    return tasks.reduce((acc, task) => {
      acc[task.status] = parseInt(task.get('count'));
      return acc;
    }, {});
  }
}

module.exports = new TaskRepository();
