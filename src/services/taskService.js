const taskRepository = require('../repositories/taskRepository');
const { cacheHelper } = require('../config/redis');
const { publishDelayed, publishToQueue, PROCESSING_QUEUE } = require('../config/rabbitmq');
const { sendEmail, emailTemplates } = require('../config/mailer');
const User = require('../models/user');
const { 
  buildTaskTree, 
  buildTaskTreeWithMetadata,
  getDescendantIds, 
  validateNoCircularReference,
  getTreeStatistics,
  searchInTree,
  filterTree
} = require('../utils/treeHelper');

/**
 * Task Service
 * Business logic untuk task management
 * Includes: Recursive tree logic & Cache invalidation
 * Layer: Service (Business Logic)
 */

class TaskService {
  /**
   * Get all tasks dengan pagination dan caching
   */
  async getAllTasks(filters) {
    const { page, limit, status, priority, project_id, userId } = filters;

    // Sertakan project_id sebagai prefix key agar invalidation hanya menyentuh
    // cache untuk project yang bersangkutan, bukan seluruh tasks:list:*
    const cacheKey = `tasks:list:${filters.project_id || 'all'}:${JSON.stringify(filters)}`;

    // Try to get from cache
    const cached = await cacheHelper.get(cacheKey);
    if (cached) {
      console.log('Cache hit for tasks');
      return cached;
    }

    // Get from database
    const result = await taskRepository.findAll(filters);

    // Cache result
    await cacheHelper.set(cacheKey, result, 300); // 5 minutes

    return result;
  }

  /**
   * Get tasks dalam tree structure (recursive) - OPTIMIZED
   * Menggunakan algoritma O(n) untuk build tree
   * Support untuk semua level (unlimited depth)
   */
  async getTaskTree(projectId, userId) {
    const cacheKey = `tasks:tree:${projectId}`;

    // Try cache first
    const cached = await cacheHelper.get(cacheKey);
    if (cached) {
      console.log('✓ Cache hit for task tree');
      return cached;
    }

    console.log('✗ Cache miss - Building task tree from database');

    // Get all tasks for project (flat array)
    const tasks = await taskRepository.findByProject(projectId);

    if (!tasks || tasks.length === 0) {
      return {
        tree: [],
        statistics: {
          total_tasks: 0,
          max_depth: 0,
          leaf_nodes: 0,
          branch_nodes: 0
        }
      };
    }

    // Build hierarchical tree dengan O(n) complexity
    const tree = buildTaskTree(tasks);

    // Get statistics
    const statistics = getTreeStatistics(tree);

    const result = {
      tree,
      statistics,
      project_id: projectId,
      total_count: tasks.length,
      generated_at: new Date().toISOString()
    };

    // Cache tree structure
    await cacheHelper.set(cacheKey, result, 600); // 10 minutes

    console.log(`✓ Task tree built: ${tasks.length} tasks, ${statistics.max_depth} levels`);

    return result;
  }

  /**
   * Get tasks tree dengan metadata lengkap (depth, counts, dll)
   */
  async getTaskTreeWithMetadata(projectId, userId) {
    const cacheKey = `tasks:tree:metadata:${projectId}`;

    // Try cache
    const cached = await cacheHelper.get(cacheKey);
    if (cached) {
      console.log('✓ Cache hit for task tree with metadata');
      return cached;
    }

    // Get all tasks
    const tasks = await taskRepository.findByProject(projectId);

    if (!tasks || tasks.length === 0) {
      return {
        tree: [],
        statistics: { total_tasks: 0, max_depth: 0 }
      };
    }

    // Build tree dengan metadata
    const tree = buildTaskTreeWithMetadata(tasks);
    const statistics = getTreeStatistics(tree);

    const result = {
      tree,
      statistics,
      project_id: projectId,
      generated_at: new Date().toISOString()
    };

    // Cache
    await cacheHelper.set(cacheKey, result, 600);

    return result;
  }

  /**
   * Get complete task tree untuk ALL projects (admin view)
   */
  async getAllTasksTree(filters = {}) {
    const { status, priority } = filters;
    const cacheKey = `tasks:tree:all:${JSON.stringify(filters)}`;

    // Try cache
    const cached = await cacheHelper.get(cacheKey);
    if (cached) {
      console.log('✓ Cache hit for all tasks tree');
      return cached;
    }

    // Get all tasks with filters
    // PERF NOTE: limit di-cap di 5000 untuk mencegah alokasi memori yang tidak
    // terkendali. Untuk dataset lebih besar, gunakan pagination per-project.
    const MAX_TREE_LIMIT = 5000;
    const tasks = await taskRepository.findAll({
      page: 1,
      limit: MAX_TREE_LIMIT,
      status,
      priority
    });

    if (!tasks || !tasks.tasks || tasks.tasks.length === 0) {
      return { tree: [], statistics: { total_tasks: 0 } };
    }

    if (tasks.total > MAX_TREE_LIMIT) {
      console.warn(`[getAllTasksTree] Total tasks (${tasks.total}) melebihi limit ${MAX_TREE_LIMIT}. Tree mungkin tidak lengkap.`);
    }

    // Build tree
    const tree = buildTaskTree(tasks.tasks);
    const statistics = getTreeStatistics(tree);

    const result = {
      tree,
      statistics,
      total_count: tasks.total,
      generated_at: new Date().toISOString()
    };

    // Cache
    await cacheHelper.set(cacheKey, result, 300);

    return result;
  }

  /**
   * Search task in tree structure
   */
  async searchTaskInTree(projectId, searchTerm) {
    // Get tree
    const { tree } = await this.getTaskTree(projectId);

    // Search
    const result = searchInTree(tree, searchTerm);

    return result;
  }

  /**
   * Filter task tree by condition
   */
  async getFilteredTaskTree(projectId, filterOptions) {
    const { status, priority, assigned_to } = filterOptions;

    // Get full tree
    const { tree } = await this.getTaskTree(projectId);

    // Apply filter
    const filteredTree = filterTree(tree, (task) => {
      let matches = true;
      
      if (status && task.status !== status) matches = false;
      if (priority && task.priority !== priority) matches = false;
      if (assigned_to && task.assigned_to !== assigned_to) matches = false;
      
      return matches;
    });

    const statistics = getTreeStatistics(filteredTree);

    return {
      tree: filteredTree,
      statistics,
      filters: filterOptions,
      generated_at: new Date().toISOString()
    };
  }

  /**
   * Get task by ID
   */
  async getTaskById(taskId, userId) {
    const cacheKey = `task:${taskId}`;

    // Try cache
    const cached = await cacheHelper.get(cacheKey);
    if (cached) {
      console.log('Cache hit for task:', taskId);
      return cached;
    }

    const task = await taskRepository.findById(taskId);
    if (!task) {
      const error = new Error('Task not found');
      error.statusCode = 404;
      throw error;
    }

    // Cache single task
    await cacheHelper.set(cacheKey, task);

    return task;
  }

  /**
   * Create new task
   */
  async createTask(taskData) {
    // Validate parent task exists (if provided)
    if (taskData.parent_task_id) {
      const parentTask = await taskRepository.findById(taskData.parent_task_id);
      if (!parentTask) {
        const error = new Error('Parent task not found');
        error.statusCode = 404;
        throw error;
      }

      // Ensure parent task is in same project
      if (parentTask.project_id !== taskData.project_id) {
        const error = new Error('Parent task must be in the same project');
        error.statusCode = 400;
        throw error;
      }
    }

    // Create task
    const task = await taskRepository.create(taskData);

    // Invalidate cache
    await this.invalidateTaskCache(task.project_id);

    // Jadwalkan overdue check menggunakan delayed message
    // Pesan akan tiba di worker tepat saat due_date tiba
    if (task.due_date) {
      const delayMs = new Date(task.due_date).getTime() - Date.now();
      if (delayMs > 0) {
        await publishDelayed(
          { type: 'task_overdue_check', task_id: task.id },
          delayMs
        );
      } else {
        // Due date sudah lewat — kirim langsung ke processing queue
        await publishToQueue(PROCESSING_QUEUE, {
          type: 'task_overdue_check',
          task_id: task.id
        });
      }
    }

    // Kirim email notifikasi jika task langsung di-assign saat dibuat
    if (task.assigned_to) {
      await this._sendAssignmentEmail(task, taskData.created_by);
    }

    return task;
  }

  /**
   * Update task
   */
  async updateTask(taskId, updates, userId) {
    const task = await taskRepository.findById(taskId);
    if (!task) {
      const error = new Error('Task not found');
      error.statusCode = 404;
      throw error;
    }

    // Validate circular reference jika update parent_task_id
    if (updates.parent_task_id !== undefined) {
      const allTasks = await taskRepository.findByProject(task.project_id);
      const isValid = validateNoCircularReference(allTasks, taskId, updates.parent_task_id);
      
      if (!isValid) {
        const error = new Error('Circular reference detected');
        error.statusCode = 400;
        throw error;
      }
    }

    // Update task
    const updatedTask = await taskRepository.update(taskId, updates);

    // Write-through: tulis langsung hasil update ke cache single-task
    // sehingga GET /tasks/:id langsung mendapat data terbaru tanpa query DB
    await cacheHelper.set(`task:${taskId}`, updatedTask, 300);

    // Invalidate semua tree/list cache yang terpengaruh
    await this.invalidateTaskCache(task.project_id);

    // Kirim email jika assigned_to diubah (baru pertama kali atau diganti)
    const assigneeChanged =
      updates.assigned_to !== undefined &&
      updates.assigned_to !== null &&
      updates.assigned_to !== task.assigned_to;

    if (assigneeChanged) {
      await this._sendAssignmentEmail(updatedTask, userId);
    }

    // Jika due_date diubah, jadwalkan ulang overdue check
    if (updates.due_date) {
      const delayMs = new Date(updates.due_date).getTime() - Date.now();
      if (delayMs > 0) {
        await publishDelayed(
          { type: 'task_overdue_check', task_id: taskId },
          delayMs
        );
      } else {
        await publishToQueue(PROCESSING_QUEUE, {
          type: 'task_overdue_check',
          task_id: taskId
        });
      }
    }

    return updatedTask;
  }

  /**
   * Delete task (cascade delete subtasks)
   */
  async deleteTask(taskId, userId) {
    const task = await taskRepository.findById(taskId);
    if (!task) {
      const error = new Error('Task not found');
      error.statusCode = 404;
      throw error;
    }

    // Get all subtask IDs (recursive)
    const allTasks = await taskRepository.findByProject(task.project_id);
    const descendantIds = getDescendantIds(allTasks, taskId);

    // Delete all subtasks first (cascade) — parallelkan agar tidak serial O(n) round-trips
    await Promise.all(descendantIds.map(id => taskRepository.delete(id)));

    // Delete main task
    await taskRepository.delete(taskId);

    // Hapus cache single-task untuk task utama dan semua descendant-nya
    const allDeletedIds = [taskId, ...descendantIds];
    await Promise.all(allDeletedIds.map(id => cacheHelper.del(`task:${id}`)));

    // Invalidate semua tree/list cache yang terpengaruh
    await this.invalidateTaskCache(task.project_id);

    return true;
  }

  /**
   * Kirim email notifikasi task assignment.
   * assignerId adalah ID user yang melakukan assign (opsional).
   */
  async _sendAssignmentEmail(task, assignerId = null) {
    try {
      const assignee = await User.findByPk(task.assigned_to);
      if (!assignee) return;

      const assigner = assignerId ? await User.findByPk(assignerId) : null;

      const { subject, text, html } = emailTemplates.taskAssigned(task, assignee, assigner);
      await sendEmail({ to: assignee.email, subject, text, html });

      console.log(`[Mail] Assignment email sent → ${assignee.email} (task #${task.id})`);
    } catch (err) {
      // Email gagal tidak boleh menghentikan flow utama
      console.error('[Mail] Failed to send assignment email:', err.message);
    }
  }

  /**
   * Cache Invalidation Strategy
   *
   * Dipanggil setiap Create / Update / Delete task.
   * Menghapus semua key cache yang datanya mungkin sudah stale:
   *
   *  tasks:list:{projectId}:* — list cache hanya untuk project ini (bukan semua project)
   *  tasks:list:all:*         — cross-project list cache (admin view)
   *  tasks:tree:{id}          — basic tree untuk project ini
   *  tasks:tree:metadata:{id} — tree + metadata untuk project ini
   *  tasks:tree:all:*         — tree lintas-project (admin view, semua filter)
   *
   * Catatan: single-task cache (task:{id}) TIDAK dihapus di sini;
   * updateTask menanganinya dengan write-through,
   * deleteTask menanganinya secara eksplisit.
   */
  async invalidateTaskCache(projectId) {
    await Promise.all([
      // Hanya list cache untuk project ini — tidak menyentuh project lain
      cacheHelper.delPattern(`tasks:list:${projectId}:*`),
      // Cross-project admin list cache
      cacheHelper.delPattern(`tasks:list:all:*`),
      // Basic tree untuk project ini
      cacheHelper.del(`tasks:tree:${projectId}`),
      // Tree + metadata untuk project ini
      cacheHelper.del(`tasks:tree:metadata:${projectId}`),
      // Semua variant all-projects tree (tidak mengandung project_id di key)
      cacheHelper.delPattern(`tasks:tree:all:*`),
    ]);

    console.log(`✓ Cache invalidated for project: ${projectId}`);
  }

  /**
   * Check and update overdue tasks
   * Called by RabbitMQ worker
   */
  async checkOverdueTasks() {
    const overdueTasks = await taskRepository.findOverdue();

    for (const task of overdueTasks) {
      // Update status to overdue
      await taskRepository.update(task.id, { status: 'overdue' });

      // Send notification (via RabbitMQ or direct email)
      await publishToQueue('task_notification_queue', {
        type: 'task_overdue',
        task_id: task.id,
        assigned_to: task.assigned_to
      });

      // Invalidate cache
      await this.invalidateTaskCache(task.project_id, task.id);
    }

    return overdueTasks.length;
  }
}

module.exports = new TaskService();
