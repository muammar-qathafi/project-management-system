const express = require('express');
const router = express.Router();

const authController = require('../controllers/authController');

// Import middlewares
const { authenticateToken } = require('../middlewares/authMiddleware');
const { validateRegister, validateLogin } = require('../middlewares/validatorMiddleware');

/**
 * Auth Routes
 * Base path: /api/auth
 */

// Public routes
router.post('/register', validateRegister, authController.register);
router.post('/login', validateLogin, authController.login);

// Protected routes
router.get('/profile', authenticateToken, authController.getProfile);
router.put('/profile', authenticateToken, authController.updateProfile);
router.post('/logout', authenticateToken, authController.logout);

module.exports = router;

