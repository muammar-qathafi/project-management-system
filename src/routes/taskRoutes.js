const express = require('express');
const router = express.Router();

const taskController = require('../controllers/taskController');
const { authenticateToken } = require('../middlewares/authMiddleware');
const {
  isAdmin,
  canCreateTask,
  canUpdateTask,
  canDeleteTask
} = require('../middlewares/roleMiddleware');
const {
  validateCreateTask,
  validateUpdateTask,
  validateId,
  validatePagination
} = require('../middlewares/validatorMiddleware');

/**
 * Task Routes
 * Base path: /api/tasks
 *
 * Otorisasi:
 *  GET    /               → Semua role (Admin semua task, Manager/User task miliknya)
 *  GET    /tree*          → Semua role
 *  GET    /tree/all       → Admin only
 *  POST   /               → Admin + Manager
 *  PUT    /:id            → Admin (semua task), Manager/User (task assigned ke mereka)
 *  DELETE /:id            → Admin (semua task), Manager (task assigned ke mereka)
 */

// ─── Tree endpoints (harus didefinisikan SEBELUM /:id) ───────────────────────

router.get('/tree/all', authenticateToken, isAdmin, taskController.getAllTasksTree);

router.get('/tree/metadata', authenticateToken, taskController.getTaskTreeWithMetadata);

router.get('/tree/search', authenticateToken, taskController.searchTaskInTree);

router.get('/tree/filter', authenticateToken, taskController.getFilteredTaskTree);

router.get('/tree', authenticateToken, taskController.getTaskTree);

// ─── Standard CRUD ───────────────────────────────────────────────────────────

router.get('/', authenticateToken, validatePagination, taskController.getAllTasks);

router.get('/:id', authenticateToken, validateId, taskController.getTaskById);

router.post('/', authenticateToken, canCreateTask, validateCreateTask, taskController.createTask);

// canUpdateTask: Admin lolos langsung; Manager/User dicek kepemilikan (assigned_to)
router.put('/:id', authenticateToken, validateId, canUpdateTask, validateUpdateTask, taskController.updateTask);

// canDeleteTask: Admin lolos langsung; Manager dicek kepemilikan; User ditolak
router.delete('/:id', authenticateToken, validateId, canDeleteTask, taskController.deleteTask);

module.exports = router;

