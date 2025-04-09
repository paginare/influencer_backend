import { Request, Response, NextFunction } from 'express';
import User, { IUser, UserRole } from '../models/User';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { AuthRequest } from '../middlewares/authMiddleware';
import asyncHandler from '../utils/asyncHandler';
import { Types } from 'mongoose';
import { sendWelcomeMessage } from '../services/whatsappService';

dotenv.config();

// Helper function to generate JWT
const generateToken = (id: string) => {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error('JWT_SECRET is not defined in .env file');
  }
  return jwt.sign({ id }, jwtSecret, {
    expiresIn: '30d', // Token expires in 30 days
  });
};

// @desc    Register a new user (potentially first admin, or managers/influencers by admin/manager)
// @route   POST /api/auth/register
// @access  Public (for first admin), Private/Admin/Manager later
const registerUser = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { name, email, password, role, managerId, couponCode, whatsappNumber } = req.body;

  // Basic validation
  if (!name || !email || !password || !role) {
    res.status(400);
    throw new Error('Please provide name, email, password, and role');
  }

  const userExists = await User.findOne({ email });
  if (userExists) {
    res.status(400);
    throw new Error('User already exists');
  }

  if (role === UserRole.INFLUENCER && !managerId) {
      res.status(400);
      throw new Error('Influencer must have a managerId');
  }

  // Se for influenciador, verifica se o cupom já existe
  if (role === UserRole.INFLUENCER && couponCode) {
    const couponExists = await User.findOne({ couponCode });
    if (couponExists) {
      res.status(400);
      throw new Error('Este código de cupom já está em uso. Por favor, escolha outro.');
    }
  }

  const user = await User.create({
    name,
    email,
    password,
    role,
    manager: role === UserRole.INFLUENCER ? managerId : undefined,
    couponCode: role === UserRole.INFLUENCER ? couponCode : undefined,
    whatsappNumber,
  });

  if (user) {
    if (role === UserRole.INFLUENCER && managerId) {
        await User.findByIdAndUpdate(managerId, { $addToSet: { influencers: user._id } });
    }

    console.log(`[registerUser] Checking conditions for welcome message for user ${user.email}`);
    console.log(`[registerUser] Role: ${role}, Has WhatsApp: ${!!whatsappNumber}, WhatsApp Number: ${whatsappNumber}, Has Coupon: ${!!couponCode}, Coupon Code: ${couponCode}`);

    // Se for um influenciador com número de WhatsApp e cupom, envie uma mensagem de boas-vindas
    if (role === UserRole.INFLUENCER && whatsappNumber && couponCode) {
      console.log(`[registerUser] Conditions MET. Attempting to send welcome message to ${whatsappNumber}`);
      try {
        // Criar mensagem de boas-vindas com template simples
        const welcomeMessage = `Olá ${name}! Bem-vindo ao nosso programa de influenciadores. Seu código de cupom é ${couponCode}. Use-o para compartilhar com seus seguidores.`;
        
        await sendWelcomeMessage(whatsappNumber, welcomeMessage, undefined);
        console.log(`[registerUser] Welcome message function called successfully for ${whatsappNumber}.`);
      } catch (error) {
        // Log detailed error from whatsappService
        console.error(`[registerUser] Error calling sendWelcomeMessage for ${whatsappNumber}:`, error);
      }
    } else {
        console.log(`[registerUser] Conditions NOT MET for sending welcome message.`);
    }

    res.status(201).json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      token: generateToken((user._id as Types.ObjectId).toString()),
    });
  } else {
    res.status(400);
    throw new Error('Invalid user data');
  }
});

// @desc    Authenticate user & get token (Login)
// @route   POST /api/auth/login
// @access  Public
const loginUser = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400);
    throw new Error('Please provide email and password');
  }

  const user = await User.findOne({ email }).select('+password');

  if (user && (await user.comparePassword(password))) {
    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      token: generateToken((user._id as Types.ObjectId).toString()),
    });
  } else {
    res.status(401);
    throw new Error('Invalid email or password');
  }
});

// @desc    Get user profile
// @route   GET /api/auth/profile
// @access  Private
const getUserProfile = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.user) {
      res.json({
          _id: req.user._id,
          name: req.user.name,
          email: req.user.email,
          role: req.user.role,
          whatsappNumber: req.user.whatsappNumber,
          couponCode: req.user.couponCode,
          manager: req.user.manager,
          influencers: req.user.influencers,
          createdAt: req.user.createdAt,
      });
  } else {
      res.status(404);
      throw new Error('User not found'); // Should not happen if protect middleware works
  }
});

// TODO: Add forgotPassword, resetPassword controllers

export { registerUser, loginUser, getUserProfile }; 