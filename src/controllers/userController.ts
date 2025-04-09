import { Request, Response } from 'express';
import User, { IUser, UserRole } from '../models/User';
import asyncHandler from '../utils/asyncHandler';
import { AuthRequest } from '../middlewares/authMiddleware';
import mongoose, { Types } from 'mongoose';

// @desc    Get all users with filtering, pagination, and search
// @route   GET /api/users
// @access  Private/Admin
const getUsers = asyncHandler(async (req: AuthRequest, res: Response) => {
  const pageSize = parseInt(req.query.limit as string) || 10;
  const page = parseInt(req.query.page as string) || 1;
  const roleFilter = req.query.role as string;
  const statusFilter = req.query.status as string;
  const searchKeyword = req.query.search as string
    ? {
        $or: [
          { name: { $regex: req.query.search as string, $options: 'i' } }, // Case-insensitive search for name
          { email: { $regex: req.query.search as string, $options: 'i' } }, // Case-insensitive search for email
          { couponCode: { $regex: req.query.search as string, $options: 'i' } }, // Case-insensitive search for coupon
        ],
      }
    : {};

  const query: any = { ...searchKeyword };

  if (roleFilter) {
    query.role = roleFilter;
  }

  if (statusFilter) {
    // Assuming status is stored as string 'active'/'inactive' or boolean
    query.isActive = statusFilter.toLowerCase() === 'active'; // Adjust if status is stored differently
  }

  // Ensure only admins can see other admins
  if (req.user?.role !== UserRole.ADMIN) {
    query.role = { $ne: UserRole.ADMIN };
  }

  const count = await User.countDocuments(query);
  const users = await User.find(query)
    .limit(pageSize)
    .skip(pageSize * (page - 1))
    .populate('manager', 'name email') // Populate manager details for influencers
    .sort({ createdAt: -1 }); // Sort by creation date, newest first

  res.json({
    users,
    page,
    pages: Math.ceil(count / pageSize),
    total: count,
  });
});

// @desc    Get user by ID
// @route   GET /api/users/:id
// @access  Private/Admin
const getUserById = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    res.status(400);
    throw new Error('Invalid user ID format');
  }
  
  const user = await User.findById(req.params.id)
                      .populate('manager', 'name email')
                      .populate('influencers', 'name email');

  if (user) {
    // Check if req.user exists and has an _id before accessing
    const requestingUserId = (req.user?._id as Types.ObjectId)?.toString();
    const targetUserId = (user._id as Types.ObjectId)?.toString();

    if (req.user?.role === UserRole.ADMIN || (requestingUserId && targetUserId && requestingUserId === targetUserId)) {
        res.json(user);
    } else {
        res.status(403);
        throw new Error('Not authorized to view this user');
    }
  } else {
    res.status(404);
    throw new Error('User not found');
  }
});

// @desc    Get settings for the logged-in user
// @route   GET /api/users/settings
// @access  Private
const getUserSettings = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user?._id;

  if (!userId) {
    res.status(401);
    throw new Error('Not authorized, user ID not found in token');
  }

  const user = await User.findById(userId).select('notifications');

  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }

  res.json(user.notifications || {});
});

// @desc    Create a new user (by Admin)
// @route   POST /api/users
// @access  Private/Admin
const createUser = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { name, email, password, role, managerId, couponCode, whatsappNumber, isActive } = req.body;

  if (!name || !email || !password || !role) {
    res.status(400);
    throw new Error('Please provide name, email, password, and role');
  }

  const userExists = await User.findOne({ email });
  if (userExists) {
    res.status(400);
    throw new Error('User with this email already exists');
  }

  if (role === UserRole.INFLUENCER) {
    if (!managerId) {
        res.status(400);
        throw new Error('Influencer must have a managerId');
    }
    if (couponCode) {
        const couponExists = await User.findOne({ couponCode });
        if (couponExists) {
            res.status(400);
            throw new Error('Coupon code already in use');
        }
    }
  }

  const user = new User({
    name,
    email,
    password, // Password will be hashed by the pre-save hook in the User model
    role,
    manager: role === UserRole.INFLUENCER ? managerId : undefined,
    couponCode: role === UserRole.INFLUENCER ? couponCode : undefined,
    whatsappNumber,
    isActive: isActive !== undefined ? isActive : true, // Default to active if not provided
  });

  const createdUser = await user.save();

  // If an influencer was created, add them to their manager's list
  if (createdUser.role === UserRole.INFLUENCER && managerId) {
    await User.findByIdAndUpdate(managerId, { $addToSet: { influencers: createdUser._id } });
  }

  res.status(201).json(createdUser);
});

// @desc    Update user profile (by Admin or Self)
// @route   PUT /api/users/:id
// @access  Private/Admin or Self
const updateUser = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    res.status(400);
    throw new Error('Invalid user ID format');
  }

  // Fetch user using findById, which returns IUser | null
  const user: IUser | null = await User.findById(req.params.id);

  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }

  // Check authorization: Admin can update anyone, others can only update themselves
  const requestingUserId = (req.user?._id as Types.ObjectId)?.toString();
  const targetUserId = (user._id as Types.ObjectId)?.toString();

  if (req.user?.role !== UserRole.ADMIN && (!requestingUserId || !targetUserId || requestingUserId !== targetUserId)) {
    res.status(403);
    throw new Error('Not authorized to update this user');
  }

  // Fields that can be updated
  user.name = req.body.name || user.name;
  user.email = req.body.email || user.email;
  // Safely update optional whatsappNumber
  if (req.body.whatsappNumber !== undefined) {
    user.whatsappNumber = req.body.whatsappNumber;
  }
  // Update isActive (assuming it exists on the model)
  if (req.body.isActive !== undefined) {
      // Cast to IUser to satisfy typescript if isActive is defined in the interface
      (user as any).isActive = req.body.isActive; 
  }

  // Only admin can change role, manager, couponCode
  if (req.user?.role === UserRole.ADMIN) {
    const oldRole = user.role;
    const newRole = req.body.role || user.role;
    const oldManagerId = user.manager;
    const newManagerId = req.body.managerId; // Manager ID for influencers

    // Role change logic
    if (newRole !== oldRole) {
        // TODO: Add logic if changing roles requires cleanup (e.g., removing from manager list)
        user.role = newRole;
        // Clear manager/influencer specific fields if role changes away from influencer/manager
        if (newRole !== UserRole.INFLUENCER) {
            user.manager = undefined;
            user.couponCode = undefined;
        }
        if (newRole !== UserRole.MANAGER) {
            // Cast to IUser to ensure influencers property access is safe
            (user as IUser).influencers = [];
        }
    }

    // Manager change logic (only if role is/becomes influencer)
    if (user.role === UserRole.INFLUENCER) {
        if (req.body.couponCode !== undefined) {
          user.couponCode = req.body.couponCode;
        }
        if (newManagerId && newManagerId.toString() !== (oldManagerId as Types.ObjectId)?.toString()) {
            // Remove from old manager's list
            if (oldManagerId) {
                await User.findByIdAndUpdate(oldManagerId, { $pull: { influencers: user._id } });
            }
            // Add to new manager's list
            await User.findByIdAndUpdate(newManagerId, { $addToSet: { influencers: user._id } });
            user.manager = new Types.ObjectId(newManagerId);
        } else if (!newManagerId && oldManagerId) {
            // Remove manager association
             await User.findByIdAndUpdate(oldManagerId, { $pull: { influencers: user._id } });
             user.manager = undefined;
        }
    }
  }

  // Update password if provided
  if (req.body.password) {
    user.password = req.body.password; // Pre-save hook will hash it
  }

  const updatedUser: IUser = await user.save(); // Ensure save returns IUser

  // Return a subset of fields, or populate as needed
  res.json({
    _id: updatedUser._id,
    name: updatedUser.name,
    email: updatedUser.email,
    role: updatedUser.role,
    isActive: (updatedUser as any).isActive, // Cast if necessary
    whatsappNumber: updatedUser.whatsappNumber,
    couponCode: updatedUser.couponCode,
    // manager: updatedUser.manager, // Avoid sending populated potentially large objects unless needed
    // influencers: updatedUser.influencers,
    createdAt: updatedUser.createdAt,
  });
});

// @desc    Delete user
// @route   DELETE /api/users/:id
// @access  Private/Admin
const deleteUser = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    res.status(400);
    throw new Error('Invalid user ID format');
  }

  const user: IUser | null = await User.findById(req.params.id);

  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }

  // Prevent deleting the user themselves
  const requestingUserId = (req.user?._id as Types.ObjectId)?.toString();
  const targetUserId = (user._id as Types.ObjectId)?.toString();
  if (requestingUserId && targetUserId && requestingUserId === targetUserId) {
    res.status(400);
    throw new Error('Cannot delete yourself');
  }

  // TODO: Add more sophisticated cleanup logic...

  const userIdToDelete = user._id;
  const userRole = user.role;
  const managerId = user.manager;
  const influencerIds = user.influencers;

  await User.deleteOne({ _id: userIdToDelete });

  // Remove influencer from their manager's list if applicable
  if (userRole === UserRole.INFLUENCER && managerId) {
      await User.findByIdAndUpdate(managerId, { $pull: { influencers: userIdToDelete } });
  }
  
  // Remove manager reference from their influencers if applicable
  if (userRole === UserRole.MANAGER && influencerIds && influencerIds.length > 0) {
      await User.updateMany({ _id: { $in: influencerIds } }, { $unset: { manager: "" } });
  }

  res.status(204).send(); // No content on successful deletion
});

/**
 * @desc    Update current logged-in user profile
 * @route   PUT /api/users/me/profile
 * @access  Private
 */
const updateUserProfile = asyncHandler(async (req: AuthRequest, res: Response) => {
    console.log("[updateUserProfile] Entered");
    console.log("[updateUserProfile] Request Body:", req.body);
    console.log("[updateUserProfile] User from token:", req.user?._id);

    if (!req.user?._id) {
        res.status(401);
        throw new Error('Usuário não autenticado na requisição');
    }

    // req.user should be available from protect middleware
    const user = await User.findById(req.user._id);
    console.log("[updateUserProfile] User found in DB:", !!user);

    if (user) {
        console.log(`[updateUserProfile] Current Name: ${user.name}, New Name: ${req.body.name}`);
        console.log(`[updateUserProfile] Current Email: ${user.email}, New Email: ${req.body.email}`);
        
        // Check for email uniqueness if email is being changed
        if (req.body.email && req.body.email !== user.email) {
            const existingUserWithEmail = await User.findOne({ email: req.body.email });
            // Ensure IDs are treated as ObjectIds before comparing strings
            if (existingUserWithEmail && 
                (existingUserWithEmail._id as Types.ObjectId).toString() !== (user._id as Types.ObjectId).toString()) {
                res.status(400);
                 console.log("[updateUserProfile] Error: Email already exists");
                throw new Error('Este email já está em uso por outra conta.');
            }
        }

        user.name = req.body.name || user.name;
        user.email = req.body.email || user.email;
        // Add other fields if necessary (e.g., whatsappNumber)

        try {
            console.log("[updateUserProfile] Attempting to save...");
            const updatedUser = await user.save();
            console.log("[updateUserProfile] Save successful");
            res.json({
                _id: updatedUser._id,
                name: updatedUser.name,
                email: updatedUser.email,
                role: updatedUser.role,
                // Include other fields as needed
            });
        } catch (error) {
            console.error("[updateUserProfile] Error during save:", error);
            // Rethrow for asyncHandler to handle
            throw error; 
        }
    } else {
        res.status(404);
        console.log("[updateUserProfile] Error: User not found in DB");
        throw new Error('Usuário não encontrado');
    }
});

/**
 * @desc    Update current logged-in user password
 * @route   PUT /api/users/me/password
 * @access  Private
 */
const updateUserPassword = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { currentPassword, newPassword } = req.body;

    // Basic validation
    if (!currentPassword || !newPassword || newPassword.length < 6) {
        res.status(400);
        throw new Error('Senha atual e nova senha (mínimo 6 caracteres) são obrigatórias.');
    }

    const user = await User.findById(req.user?._id).select('+password'); // Select password explicitly

    // Need to fetch user with password selected
    if (!user || !user.password) {
      res.status(404);
      throw new Error('Usuário não encontrado ou dados incompletos.');
    }

    if (await user.comparePassword(currentPassword)) { // Corrected method name
        user.password = newPassword; // The pre-save hook in the User model should handle hashing
        await user.save();
        res.json({ message: 'Senha atualizada com sucesso' });
    } else { // Password did not match or user not found initially (though covered above)
        res.status(401); // Unauthorized
        throw new Error('Senha atual inválida');
    }
});

/**
 * @desc    Update notification settings for the current logged-in user
 * @route   PUT /api/users/me/settings
 * @access  Private
 */
const updateUserSettings = asyncHandler(async (req: AuthRequest, res: Response) => {
    if (!req.user?._id) {
        res.status(401);
        throw new Error('Usuário não autenticado');
    }

    const user = await User.findById(req.user._id);

    if (!user) {
        res.status(404);
        throw new Error('Usuário não encontrado');
    }

    const newSettings = req.body.notifications;

    // Validate that newSettings is an object
    if (typeof newSettings !== 'object' || newSettings === null) {
        res.status(400);
        throw new Error('Formato inválido para configurações de notificação. É esperado um objeto.');
    }

    // TODO: Add specific validation for fields inside newSettings if needed
    // Example: Check if reportFrequency is one of the allowed values
    // if (newSettings.reportFrequency && !['daily', 'weekly', 'bi-weekly', 'monthly'].includes(newSettings.reportFrequency)) { ... }

    // Merge new settings with existing ones
    const currentNotifications = user.notifications || {};
    user.notifications = {
        ...currentNotifications,
        ...newSettings
    };

    try {
        const updatedUser = await user.save();
        res.json(updatedUser.notifications); // Return only the updated settings
    } catch (error) {
        console.error("[updateUserSettings] Error during save:", error);
        throw error; // Let asyncHandler handle it
    }
});

/**
 * @desc    Update a specific message template for the current logged-in user
 * @route   PUT /api/users/me/message-template
 * @access  Private
 */
const updateMessageTemplate = asyncHandler(async (req: AuthRequest, res: Response) => {
    if (!req.user?._id) {
        res.status(401);
        throw new Error('Usuário não autenticado');
    }

    const { type, content } = req.body;

    // Validate input
    if (!type || !['welcome', 'report', 'reminder'].includes(type)) {
        res.status(400);
        throw new Error('Tipo de mensagem inválido ou ausente. Use: welcome, report, ou reminder.');
    }
    if (content === undefined || content === null) {
        res.status(400);
        throw new Error('Conteúdo da mensagem ausente.');
    }
    // Validate content type (should be string)
    if (typeof content !== 'string') {
         res.status(400);
         throw new Error('Conteúdo da mensagem deve ser uma string.');
    }

    const user = await User.findById(req.user._id);

    if (!user) {
        res.status(404);
        throw new Error('Usuário não encontrado');
    }

    // Ensure messageTemplates object exists
    if (!user.messageTemplates) {
        user.messageTemplates = {};
    }

    // Update the specific template type
    user.messageTemplates[type as 'welcome' | 'report' | 'reminder'] = content;
    // Mark the path as modified for Mongoose
    user.markModified('messageTemplates'); 

    try {
        const updatedUser = await user.save();
        // Return the updated template or the whole templates object
        res.json({
            type: type,
            content: updatedUser.messageTemplates?.[type as keyof IUser['messageTemplates']] || '' 
        }); 
    } catch (error) {
        console.error("[updateMessageTemplate] Error during save:", error);
        throw error; // Let asyncHandler handle it
    }
});

export {
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
}; 