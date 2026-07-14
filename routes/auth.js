import { Router } from 'express';
import { authenticate } from '../middlewares/auth.js';
import { authRateLimiter } from '../middlewares/security.js';
import * as authController from '../controllers/authController.js';

const router = Router();

router.get('/login', authController.getLogin);
router.post('/login', authRateLimiter, authController.login);
router.get('/register', authController.getRegister);
router.post('/register', authController.register);
router.get('/verify-email/:token', authController.verifyEmail);
router.get('/forgot-password', authController.getForgotPassword);
router.post('/forgot-password', authController.forgotPassword);
router.get('/reset-password/:token', authController.getResetPassword);
router.post('/reset-password/:token', authController.resetPassword);
router.get('/logout', authenticate, authController.logout);
router.get('/profile', authenticate, authController.getProfile);
router.put('/profile', authenticate, authController.updateProfile);

export default router;
