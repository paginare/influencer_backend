import express from 'express';
import {
  getUsers,
  getUserById,
  getUserSettings,
  updateUserSettings,
  updateMessageTemplate,
  createUser,
  updateUser,
  deleteUser,
  updateUserProfile,
  updateUserPassword
} from '../controllers/userController';
import { protect, admin } from '../middlewares/authMiddleware';

const router = express.Router();

// Routes for the currently logged-in user (require login, but not admin)
router.route('/me/profile')
  .put(protect, updateUserProfile);

router.route('/me/password')
  .put(protect, updateUserPassword);

// Route for user's own settings (get and update)
router.route('/me/settings')
  .get(protect, getUserSettings)
  .put(protect, updateUserSettings);

// New route for fetching user settings
router.route('/settings')
  .get(protect, getUserSettings);

// New route for updating a specific message template
router.route('/me/message-template')
    .put(protect, updateMessageTemplate);

// Admin-only routes below
router.use(protect);
router.use(admin);

router.route('/')
  .get(getUsers)     // GET /api/users - Get all users (with filters)
  .post(createUser);  // POST /api/users - Create a new user

router.route('/:id')
  .get(getUserById)   // GET /api/users/:id - Get a single user by ID
  .put(updateUser)    // PUT /api/users/:id - Update a user
  .delete(deleteUser); // DELETE /api/users/:id - Delete a user

export default router; 