const express = require('express');
const router = express.Router();

const userController = require('../controllers/userController');
const { authenticateToken } = require('../middlewares/authMiddleware');
const { isAdmin, isAdminOrSelf } = require('../middlewares/roleMiddleware');
const { validateRegister, validateId, validatePagination } = require('../middlewares/validatorMiddleware');

/**
 * User Routes
 * Base path: /api/users
 *
 * Otorisasi:
 *  GET    /          → Admin only
 *  GET    /:id       → Admin atau diri sendiri
 *  POST   /          → Admin only
 *  PUT    /:id       → Admin atau diri sendiri (admin saja yang bisa ubah role/status)
 *  DELETE /:id       → Admin only
 *  PATCH  /:id/status → Admin only
 */

router.get('/', authenticateToken, isAdmin, validatePagination, userController.getAllUsers);

router.get('/:id', authenticateToken, validateId, isAdminOrSelf, userController.getUserById);

router.post('/', authenticateToken, isAdmin, validateRegister, userController.createUser);

router.put('/:id', authenticateToken, validateId, isAdminOrSelf, userController.updateUser);

router.delete('/:id', authenticateToken, isAdmin, validateId, userController.deleteUser);

router.patch('/:id/status', authenticateToken, isAdmin, validateId, userController.updateUserStatus);

module.exports = router;
