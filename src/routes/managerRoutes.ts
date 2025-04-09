import express from 'express';
import {
  getManagerSalesData,
  getManagerInfluencers,
  createManagerInfluencer,
  updateManagerInfluencer,
  deleteManagerInfluencer,
  getManagerInfluencerDetails,
  updateInfluencerNotifications
} from '../controllers/managerController'; // Criaremos este controller a seguir
import { protect, manager } from '../middlewares/authMiddleware';

const router = express.Router();

// Todas as rotas aqui exigem que o usuário seja um manager autenticado
router.use(protect);
router.use(manager);

// Rota para obter dados de vendas do manager logado
router.get('/sales', getManagerSalesData);

// Rotas para gerenciar os influencers do manager logado
router.route('/influencers')
  .get(getManagerInfluencers) // GET /api/manager/influencers
  .post(createManagerInfluencer); // POST /api/manager/influencers

router.route('/influencers/:influencerId')
  .get(getManagerInfluencerDetails) // GET /api/manager/influencers/:id
  .put(updateManagerInfluencer) // PUT /api/manager/influencers/:id
  .delete(deleteManagerInfluencer); // DELETE /api/manager/influencers/:id

// Rota para atualizar configurações de notificação
router.put('/influencers/:influencerId/notifications', updateInfluencerNotifications);

export default router; 