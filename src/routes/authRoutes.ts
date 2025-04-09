import express from 'express';
import {
  registerUser,
  loginUser,
  getUserProfile,
} from '../controllers/authController';
import { protect } from '../middlewares/authMiddleware'; // Import protect middleware

const router = express.Router();

// Public routes
router.post('/register', registerUser);
router.post('/login', loginUser);

// Private routes (require authentication)
router.get('/profile', protect, getUserProfile);

// TODO: Add routes for password reset, etc.

export default router; 