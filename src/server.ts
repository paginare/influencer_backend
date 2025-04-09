import express, { Express, Request, Response } from 'express';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import connectDB from './config/db'; // Import the DB connection function
import authRoutes from './routes/authRoutes';
import webhookRoutes from './routes/webhookRoutes';
import commissionRoutes from './routes/commissionRoutes';
import dashboardRoutes from './routes/dashboardRoutes';
import userRoutes from './routes/userRoutes'; // Import user routes
import managerRoutes from './routes/managerRoutes'; // <-- Importar as novas rotas
import whatsappRoutes from './routes/whatsappRoutes'; // <-- Importar
import debugRoutes from './routes/debugRoutes'; // <-- Import debug routes
// import { errorHandler, notFound } from './middlewares/errorMiddleware'; // Temporarily commented out
import cors from 'cors'; // Instalaremos isso a seguir
import jwt from 'jsonwebtoken';

// Import the scheduler to initialize the cron job
import './jobs/reportScheduler';

dotenv.config();
connectDB(); // Connect to MongoDB

const app: Express = express();
const port = process.env.PORT || 3001; // Default to 3001 if PORT not set in .env

// Middleware para CORS e parsing do body
app.use(cors());
app.use(express.json());

app.get('/', (req: Request, res: Response) => {
  res.send('Influencer Hub Backend is running!');
});

// Define the handler function separately - RESTORED LOGIC WITH TYPE GUARD
const checkTokenHandler = (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ 
      status: 'error', 
      message: 'Token não fornecido ou formato inválido',
      expected: 'Bearer <token>'
    });
  }
  
  const token = authHeader.split(' ')[1];
  const jwtSecret = process.env.JWT_SECRET;

  // Explicitly check if JWT_SECRET is defined
  if (!jwtSecret) {
    console.error('FATAL ERROR: JWT_SECRET is not defined in environment variables.');
    return res.status(500).json({ 
      status: 'error', 
      message: 'Erro interno do servidor: configuração de segurança ausente.'
    });
  }
  
  try {
    // Use the validated jwtSecret
    const decoded = jwt.verify(token, jwtSecret);
    return res.json({ 
      status: 'success', 
      message: 'Token válido', 
      decoded 
    });
  } catch (error: any) {
    return res.status(401).json({ 
      status: 'error', 
      message: 'Token inválido',
      error: error.message
    });
  }
};

// Rota de teste para verificar token - COMENTADA TEMPORARIAMENTE DEVIDO A ERRO DE TIPO
/*
app.get('/api/check-token', checkTokenHandler);
*/

// Rotas da API
app.use('/api/auth', authRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/commissions', commissionRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/users', userRoutes); // Mount user routes
app.use('/api/manager', managerRoutes); // <-- Registrar as novas rotas
app.use('/api/whatsapp', whatsappRoutes); // <-- Registrar
app.use('/api/debug', debugRoutes); // Mount debug routes (Consider removing/protecting in production)

// Rota de teste para o endpoint de desconexão do WhatsApp
app.post('/api/test-disconnect', (req, res) => {
  res.json({ success: true, message: 'Rota de teste funcionando!' });
});

// TODO: Add other routes (auth, users, influencers, etc.)

// Custom Error Handler Middleware - Temporarily commented out
// app.use(notFound);
// app.use(errorHandler);

app.listen(port, () => {
  console.log(`[server]: Server is running at http://localhost:${port}`);
});

export default app; // Export for potential testing 