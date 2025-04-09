import { Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Middleware para verificar o token de autenticação dos webhooks
 * Protege as rotas de webhook contra chamadas não autorizadas
 */
const verifyWebhookToken = (req: Request, res: Response, next: NextFunction) => {
  // Obter o token da requisição (do header, query ou body, conforme a implementação do cliente)
  const token = req.headers['webhook-token'] || req.query.token || req.body.token;
  
  // Obter o token configurado no ambiente
  const configuredToken = process.env.WEBHOOK_TOKEN;
  
  if (!configuredToken) {
    console.error('WEBHOOK_TOKEN não está definido nas variáveis de ambiente');
    return res.status(500).json({ message: 'Erro de configuração do servidor' });
  }
  
  if (!token) {
    return res.status(401).json({ message: 'Token de webhook não fornecido' });
  }
  
  // Comparar os tokens
  if (token !== configuredToken) {
    return res.status(401).json({ message: 'Token de webhook inválido' });
  }
  
  // Se chegou aqui, o token é válido
  next();
};

export { verifyWebhookToken }; 