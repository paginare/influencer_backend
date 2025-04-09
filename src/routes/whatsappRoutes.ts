import express from 'express';
import {
  getWhatsappStatus,
  initiateWhatsappInstance,
  connectWhatsappInstance,
  getDetailedWhatsappStatus,
  disconnectWhatsappInstance
} from '../controllers/whatsappController';
import { protect, manager } from '../middlewares/authMiddleware';

const router = express.Router();

// Todas as rotas aqui exigem que o usuário seja um manager autenticado
router.use(protect);
router.use(manager);

// Rota para obter status da conexão
router.get('/status', getWhatsappStatus);

// Rota para iniciar a instância
router.post('/initiate', initiateWhatsappInstance);

// Rota para conectar instância existente e obter QR
router.post('/connect', connectWhatsappInstance);

// Rota para obter status detalhado da instância
router.get('/detailed-status', getDetailedWhatsappStatus);

// Nova rota para desconectar usando um nome diferente
router.post('/logout', disconnectWhatsappInstance);

export default router; 