import express from 'express';
import { 
  createCommissionTier,
  getCommissionTiers,
  updateCommissionTier,
  deleteCommissionTier,
  saveCommissionTiersBulk,
  getSales,
  processCommissions,
  createCommissionPayments,
  getCommissionPayments,
  updatePaymentStatus,
  checkCouponCodeAvailability
} from '../controllers/commissionController';
import { protect, authorize } from '../middlewares/authMiddleware';
import { UserRole } from '../models/User';

const router = express.Router();

// Middleware de proteção em todas as rotas
router.use(protect as express.RequestHandler);

// Rota para salvar faixas em bulk (PUT)
router.route('/tiers/bulk')
  .put(authorize(UserRole.ADMIN) as express.RequestHandler, saveCommissionTiersBulk);

// Rotas individuais para faixas de comissão
router.route('/tiers')
  .post(authorize(UserRole.ADMIN) as express.RequestHandler, createCommissionTier)
  .get(authorize(UserRole.ADMIN, UserRole.MANAGER) as express.RequestHandler, getCommissionTiers);

router.route('/tiers/:id')
  .put(authorize(UserRole.ADMIN) as express.RequestHandler, updateCommissionTier)
  .delete(authorize(UserRole.ADMIN) as express.RequestHandler, deleteCommissionTier);

// Rotas para vendas
router.route('/sales')
  .get(getSales); // Acesso controlado no controller baseado no papel do usuário

// Rotas para processamento de comissões (apenas admin)
router.route('/process-pending')
  .post(authorize(UserRole.ADMIN) as express.RequestHandler, processCommissions);

router.route('/generate-payments')
  .post(authorize(UserRole.ADMIN) as express.RequestHandler, createCommissionPayments);

// Rotas para pagamentos
router.route('/payments')
  .get(getCommissionPayments); // Acesso controlado no controller

router.route('/payments/:id')
  .put(authorize(UserRole.ADMIN) as express.RequestHandler, updatePaymentStatus);

// Rota para verificar disponibilidade de cupom
router.get('/check', checkCouponCodeAvailability);

export default router; 