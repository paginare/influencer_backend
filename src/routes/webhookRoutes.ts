import express from 'express';
import { processSaleWebhook, processShopifyWebhook, processCartPandaWebhook } from '../controllers/webhookController';
import { verifyWebhookToken } from '../middlewares/webhookAuthMiddleware';

const router = express.Router();

// Rota para processar webhook genérico de venda (com autenticação)
router.post('/sale', verifyWebhookToken as express.RequestHandler, processSaleWebhook);

// Rotas para processar webhooks de plataformas (sem verificação de token)
router.post('/shopify', processShopifyWebhook);
router.post('/cartpanda', processCartPandaWebhook);

export default router; 