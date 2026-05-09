const express = require('express');
const router = express.Router();
const { rateLimit } = require('express-rate-limit');

const authController = require('../controllers/authController');

// Import middlewares
const { authenticateToken } = require('../middlewares/authMiddleware');
const { validateRegister, validateLogin } = require('../middlewares/validatorMiddleware');

/**
 * Auth Routes
 * Base path: /api/auth
 */

// Rate limiter untuk login — mencegah brute-force
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 menit
  max: 10,                   // maks 10 percobaan per IP per window
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Terlalu banyak percobaan login. Coba lagi dalam 15 menit.',
    statusCode: 429
  },
  skipSuccessfulRequests: true, // hanya hitung request yang gagal
});

// Rate limiter untuk register — mencegah spam akun
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 jam
  max: 5,                    // maks 5 registrasi per IP per jam
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Terlalu banyak permintaan registrasi. Coba lagi dalam 1 jam.',
    statusCode: 429
  },
});

// Public routes
router.post('/register', registerLimiter, validateRegister, authController.register);
router.post('/login', loginLimiter, validateLogin, authController.login);

// Protected routes
router.get('/profile', authenticateToken, authController.getProfile);
router.put('/profile', authenticateToken, authController.updateProfile);
router.post('/logout', authenticateToken, authController.logout);

module.exports = router;

