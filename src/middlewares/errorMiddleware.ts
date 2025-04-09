import { Request, Response, NextFunction } from 'express';

// Middleware para tratar 404 (rotas não encontradas)
const notFound = (req: Request, res: Response, next: NextFunction) => {
  const error = new Error(`Rota não encontrada - ${req.originalUrl}`);
  res.status(404);
  next(error);
};

// Middleware de tratamento de erros customizado
const errorHandler = (err: Error, req: Request, res: Response, next: NextFunction) => {
  // Se o status ainda for 200, definir como 500
  const statusCode = res.statusCode === 200 ? 500 : res.statusCode;
  
  res.status(statusCode);
  res.json({
    message: err.message,
    stack: process.env.NODE_ENV === 'production' ? null : err.stack,
  });
};

export { notFound, errorHandler };