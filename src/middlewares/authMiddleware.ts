import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import User, { IUser } from '../models/User'; // Adjust path as necessary
import dotenv from 'dotenv';

dotenv.config();

// Extend the Express Request interface to include the user property
export interface AuthRequest extends Request {
  user?: IUser;
}

export const protect = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    try {
      // Extrair token do cabeçalho
      token = req.headers.authorization.split(' ')[1];

      // Verificar token
      const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as jwt.JwtPayload;

      // Obter usuário do token
      const user = await User.findById(decoded.id).select('-password');

      if (!user) {
        res.status(401).json({ message: 'Não autorizado, usuário não encontrado' });
        return;
      }

      // Anexar usuário à requisição
      req.user = user;

      next();
    } catch (error) {
      console.error(error);
      res.status(401).json({ message: 'Não autorizado, token expirado ou inválido' });
      return;
    }
  }

  if (!token) {
    res.status(401).json({ message: 'Não autorizado, sem token' });
    return;
  }
};

export const admin = (req: AuthRequest, res: Response, next: NextFunction): void => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ message: 'Não autorizado, somente admin' });
  }
};

export const influencer = (req: AuthRequest, res: Response, next: NextFunction): void => {
  if (req.user && (req.user.role === 'influencer' || req.user.role === 'admin')) {
    next();
  } else {
    res.status(403).json({ message: 'Não autorizado, somente influenciador ou admin' });
  }
};

export const manager = (req: AuthRequest, res: Response, next: NextFunction): void => {
  if (req.user && (req.user.role === 'manager' || req.user.role === 'admin')) {
    next();
  } else {
    res.status(403).json({ message: 'Não autorizado, somente gerente ou admin' });
  }
};

// Middleware to authorize specific roles
const authorize = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: `User role ${req.user?.role} is not authorized to access this route` });
    }
    next();
  };
};

export { authorize }; 