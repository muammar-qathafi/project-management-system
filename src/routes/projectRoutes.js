const express = require('express');
const router = express.Router();

const projectController = require('../controllers/projectController');
const { authenticateToken } = require('../middlewares/authMiddleware');
const {
  isAdmin,
  canCreateProject,
  canUpdateProject,
  canDeleteProject
} = require('../middlewares/roleMiddleware');
const { validateId, validatePagination } = require('../middlewares/validatorMiddleware');
const { body } = require('express-validator');
const { handleValidationErrors } = require('../middlewares/validatorMiddleware');

/**
 * Project Routes
 * Base path: /api/projects
 *
 * Otorisasi:
 *  GET    /          → Semua role (Admin lihat semua, Manager/User lihat miliknya)
 *  GET    /:id       → Semua role (scope berlaku di service)
 *  POST   /          → Admin only
 *  PUT    /:id       → Admin + Manager
 *  DELETE /:id       → Admin only
 */

// Validasi project create/update
const validateProject = [
  body('name')
    .trim()
    .notEmpty().withMessage('Project name is required')
    .isLength({ min: 3 }).withMessage('Name must be at least 3 characters'),
  body('description').optional().trim(),
  body('status')
    .optional()
    .isIn(['planning', 'active', 'on_hold', 'completed', 'cancelled']).withMessage('Invalid status'),
  body('priority')
    .optional()
    .isIn(['low', 'medium', 'high']).withMessage('Invalid priority. Allowed: low, medium, high'),
  body('start_date').optional().isISO8601().withMessage('Invalid start date format'),
  body('end_date').optional().isISO8601().withMessage('Invalid end date format'),
  handleValidationErrors
];

router.get('/', authenticateToken, validatePagination, projectController.getAllProjects);

router.get('/:id', authenticateToken, validateId, projectController.getProjectById);

router.post('/', authenticateToken, canCreateProject, validateProject, projectController.createProject);

router.put('/:id', authenticateToken, validateId, canUpdateProject, validateProject, projectController.updateProject);

router.delete('/:id', authenticateToken, canDeleteProject, validateId, projectController.deleteProject);

module.exports = router;
