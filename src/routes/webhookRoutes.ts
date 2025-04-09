import express from 'express';
import { processSaleWebhook, processShopifyWebhook, processCartPandaWebhook } from '../controllers/webhookController';
import { verifyWebhookToken } from '../middlewares/webhookAuthMiddleware';

const router = express.Router();

// Aplicar middleware de autenticação a todas as rotas de webhook
router.use(verifyWebhookToken as express.RequestHandler);

// Rota para processar webhook genérico de venda
router.post('/sale', processSaleWebhook);

// Rota para processar webhook da Shopify
router.post('/shopify', processShopifyWebhook);

// Rota para processar webhook da CartPanda
router.post('/cartpanda', processCartPandaWebhook);

export default router; 