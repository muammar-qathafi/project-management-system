const { body, param, query, validationResult } = require('express-validator');
const { errorResponse } = require('../utils/responseHandler');

/**
 * Middleware untuk handle validation errors
 */
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    return res.status(400).json(
      errorResponse('Validation failed', 400, errors.array())
    );
  }
  
  next();
};

/**
 * Validation rules untuk berbagai entities
 */

// User registration validation
const validateRegister = [
  body('name')
    .trim()
    .notEmpty().withMessage('Name is required')
    .isLength({ min: 3 }).withMessage('Name must be at least 3 characters'),
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Invalid email format')
    .normalizeEmail(),
  body('password')
    .notEmpty().withMessage('Password is required')
    .isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('role')
    .optional()
    .isIn(['admin', 'manager', 'user']).withMessage('Invalid role'),
  handleValidationErrors
];

// User login validation
const validateLogin = [
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Invalid email format')
    .normalizeEmail(),
  body('password')
    .notEmpty().withMessage('Password is required'),
  handleValidationErrors
];

// Task creation validation
const validateCreateTask = [
  body('title')
    .trim()
    .notEmpty().withMessage('Title is required')
    .isLength({ min: 3 }).withMessage('Title must be at least 3 characters'),
  body('description')
    .optional()
    .trim(),
  body('status')
    .optional()
    .toLowerCase()
    .isIn(['open', 'working', 'closed', 'overdue']).withMessage('Invalid status. Allowed: open, working, closed, overdue'),
  body('priority')
    .optional()
    .isIn(['low', 'medium', 'high']).withMessage('Invalid priority'),
  body('due_date')
    .optional()
    .isISO8601().withMessage('Invalid date format'),
  body('parent_task_id')
    .optional()
    .isInt().withMessage('Parent task ID must be an integer'),
  body('project_id')
    .notEmpty().withMessage('Project ID is required')
    .isInt().withMessage('Project ID must be an integer'),
  handleValidationErrors
];

// Task update validation
const validateUpdateTask = [
  body('title')
    .optional()
    .trim()
    .isLength({ min: 3 }).withMessage('Title must be at least 3 characters'),
  body('description')
    .optional()
    .trim(),
  body('status')
    .optional()
    .toLowerCase()
    .isIn(['open', 'working', 'closed', 'overdue']).withMessage('Invalid status. Allowed: open, working, closed, overdue'),
  body('priority')
    .optional()
    .isIn(['low', 'medium', 'high']).withMessage('Invalid priority'),
  body('due_date')
    .optional()
    .isISO8601().withMessage('Invalid date format'),
  handleValidationErrors
];

// ID param validation
const validateId = [
  param('id')
    .isInt().withMessage('ID must be an integer'),
  handleValidationErrors
];

// Pagination validation
const validatePagination = [
  query('page')
    .optional()
    .isInt({ min: 1 }).withMessage('Page must be at least 1'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  handleValidationErrors
];

module.exports = {
  handleValidationErrors,
  validateRegister,
  validateLogin,
  validateCreateTask,
  validateUpdateTask,
  validateId,
  validatePagination
};
