import express, { Response, Request } from 'express';
import { protect, admin, AuthRequest } from '../middlewares/authMiddleware';
import User, { IUser, UserRole } from '../models/User';
import Sale from '../models/Sale';
import CommissionTier from '../models/CommissionTier';
import CommissionPayment from '../models/CommissionPayment';
import mongoose, { Types } from 'mongoose';
import { getPerformanceOverviewStats, getPerformanceTimeline } from '../controllers/dashboardController';

const router = express.Router();

// @desc    Get admin dashboard stats
// @route   GET /api/dashboard/admin
// @access  Private (admin only)
const getAdminDashboardHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Verificar se o usuário é admin
    if (req.user?.role !== 'admin') {
      res.status(403).json({ message: 'Acesso negado' });
      return;
    }

    // Data atual
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    // Total de vendas do mês atual
    const monthlySales = await Sale.aggregate([
      { $match: { createdAt: { $gte: startOfMonth } } },
      { $group: {
          _id: null,
          count: { $sum: 1 },
          totalValue: { $sum: '$saleValue' },
          totalInfluencerCommission: { $sum: '$influencerCommissionEarned' },
          totalManagerCommission: { $sum: '$managerCommissionEarned' }
        }
      }
    ]);

    // Total de vendas do mês anterior (para comparação)
    const prevMonthSales = await Sale.aggregate([
      { $match: { 
          createdAt: { 
            $gte: startOfPrevMonth,
            $lt: startOfMonth 
          } 
        } 
      },
      { $group: {
          _id: null,
          count: { $sum: 1 },
          totalValue: { $sum: '$saleValue' }
        }
      }
    ]);

    // Contagem de usuários por tipo
    const userCounts = await User.aggregate([
      {
        $group: {
          _id: '$role',
          count: { $sum: 1 }
        }
      }
    ]);

    // Comissões pendentes
    const pendingCommissions = await CommissionPayment.aggregate([
      { $match: { status: 'pending' } },
      { $group: {
          _id: null,
          total: { $sum: '$commissionEarned' },
          count: { $sum: 1 }
        }
      }
    ]);

    // Preparar dados para retorno
    const currentMonthData = monthlySales[0] || { count: 0, totalValue: 0, totalInfluencerCommission: 0 };
    const prevMonthData = prevMonthSales[0] || { count: 0, totalValue: 0 };
    
    // Calcular variações percentuais
    const salesGrowth = prevMonthData.count > 0 
      ? ((currentMonthData.count - prevMonthData.count) / prevMonthData.count) * 100
      : 0;
    
    const revenueGrowth = prevMonthData.totalValue > 0
      ? ((currentMonthData.totalValue - prevMonthData.totalValue) / prevMonthData.totalValue) * 100
      : 0;

    // Estruturar contagens de usuários
    const userCountMap: Record<string, number> = {};
    userCounts.forEach(item => {
      userCountMap[item._id] = item.count;
    });

    res.json({
      sales: {
        current: currentMonthData.count,
        previous: prevMonthData.count,
        growth: salesGrowth,
        value: currentMonthData.totalValue
      },
      revenue: {
        current: currentMonthData.totalValue,
        previous: prevMonthData.totalValue,
        growth: revenueGrowth
      },
      commissions: {
        influencer: currentMonthData.totalInfluencerCommission || 0,
        manager: currentMonthData.totalManagerCommission || 0,
        pending: pendingCommissions[0]?.total || 0,
        pendingCount: pendingCommissions[0]?.count || 0
      },
      users: {
        influencers: userCountMap['influencer'] || 0,
        managers: userCountMap['manager'] || 0,
        admins: userCountMap['admin'] || 0,
        total: Object.values(userCountMap).reduce((sum, count) => sum + count, 0)
      }
    });
  } catch (error) {
    console.error('Erro ao obter estatísticas do dashboard admin:', error);
    res.status(500).json({ message: 'Erro ao obter estatísticas do dashboard' });
  }
};

router.get('/admin', protect, admin, getAdminDashboardHandler);

// @desc    Get manager dashboard stats
// @route   GET /api/dashboard/manager
// @access  Private (manager only)
const getManagerDashboardHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Verificar se o usuário é gerente
    if (req.user?.role !== 'manager') {
      res.status(403).json({ message: 'Acesso negado' });
      return;
    }

    const managerId = req.user._id;
    
    // Data atual
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    // Encontrar influenciadores gerenciados por este gerente
    const influencers = await User.find({ manager: managerId });
    const influencerIds = influencers.map(inf => inf._id);

    // Vendas do mês atual para influenciadores gerenciados
    const monthlySales = await Sale.aggregate([
      { 
        $match: { 
          influencer: { $in: influencerIds },
          createdAt: { $gte: startOfMonth } 
        } 
      },
      { 
        $group: {
          _id: null,
          count: { $sum: 1 },
          totalValue: { $sum: '$saleValue' },
          totalManagerCommission: { $sum: '$managerCommissionEarned' }
        }
      }
    ]);

    // Vendas do mês anterior (para comparação)
    const prevMonthSales = await Sale.aggregate([
      { 
        $match: { 
          influencer: { $in: influencerIds },
          createdAt: { 
            $gte: startOfPrevMonth,
            $lt: startOfMonth 
          } 
        } 
      },
      { 
        $group: {
          _id: null,
          count: { $sum: 1 },
          totalValue: { $sum: '$saleValue' },
          totalManagerCommission: { $sum: '$managerCommissionEarned' }
        }
      }
    ]);

    // Comissões pendentes
    const pendingCommissions = await CommissionPayment.aggregate([
      { 
        $match: { 
          userId: managerId,
          status: 'pending' 
        } 
      },
      { 
        $group: {
          _id: null,
          total: { $sum: '$commissionEarned' },
          count: { $sum: 1 }
        }
      }
    ]);

    // Desempenho de influenciadores (top 5)
    const influencerPerformance = await Sale.aggregate([
      { 
        $match: { 
          influencer: { $in: influencerIds },
          createdAt: { $gte: startOfMonth } 
        } 
      },
      {
        $group: {
          _id: '$influencer',
          sales: { $sum: 1 },
          totalValue: { $sum: '$saleValue' },
          totalCommission: { $sum: '$influencerCommissionEarned' }
        }
      },
      { $sort: { totalValue: -1 } },
      { $limit: 5 },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'influencer'
        }
      },
      { $unwind: '$influencer' },
      {
        $project: {
          _id: 0,
          influencerId: "$_id",
          name: "$influencer.name",
          email: "$influencer.email",
          totalSales: 1,
          totalCommission: 1,
        }
      }
    ]);

    // Preparar dados para retorno
    const currentMonthData = monthlySales[0] || { count: 0, totalValue: 0, totalManagerCommission: 0 };
    const prevMonthData = prevMonthSales[0] || { count: 0, totalValue: 0, totalManagerCommission: 0 };
    
    // Calcular variações percentuais
    const salesGrowth = prevMonthData.count > 0 
      ? ((currentMonthData.count - prevMonthData.count) / prevMonthData.count) * 100
      : 0;
    
    const revenueGrowth = prevMonthData.totalValue > 0
      ? ((currentMonthData.totalValue - prevMonthData.totalValue) / prevMonthData.totalValue) * 100
      : 0;

    const commissionGrowth = prevMonthData.totalManagerCommission > 0
      ? ((currentMonthData.totalManagerCommission - prevMonthData.totalManagerCommission) / prevMonthData.totalManagerCommission) * 100
      : 0;

    res.json({
      influencerCount: influencers.length,
      sales: {
        current: currentMonthData.count,
        previous: prevMonthData.count,
        growth: salesGrowth,
        value: currentMonthData.totalValue
      },
      revenue: {
        current: currentMonthData.totalValue,
        previous: prevMonthData.totalValue,
        growth: revenueGrowth
      },
      commissions: {
        current: currentMonthData.totalManagerCommission || 0,
        previous: prevMonthData.totalManagerCommission || 0,
        growth: commissionGrowth,
        pending: pendingCommissions[0]?.total || 0,
        pendingCount: pendingCommissions[0]?.count || 0
      },
      topInfluencers: influencerPerformance
    });
  } catch (error) {
    console.error('Erro ao obter estatísticas do dashboard gerente:', error);
    res.status(500).json({ message: 'Erro ao obter estatísticas do dashboard' });
  }
};

router.get('/manager', protect, getManagerDashboardHandler);

// @desc    Get influencer dashboard stats
// @route   GET /api/dashboard/influencer
// @access  Private (influencer only)
const getInfluencerDashboardHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Verificar se o usuário é influenciador
    if (req.user?.role !== 'influencer') {
      res.status(403).json({ message: 'Acesso negado' });
      return;
    }

    const influencerId = req.user._id;
    
    // Data atual
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    // Vendas do mês atual
    const monthlySales = await Sale.aggregate([
      { 
        $match: { 
          influencer: influencerId,
          createdAt: { $gte: startOfMonth } 
        } 
      },
      { 
        $group: {
          _id: null,
          count: { $sum: 1 },
          totalValue: { $sum: '$saleValue' },
          totalInfluencerCommission: { $sum: '$influencerCommissionEarned' }
        }
      }
    ]);

    // Vendas do mês anterior (para comparação)
    const prevMonthSales = await Sale.aggregate([
      { 
        $match: { 
          influencer: influencerId,
          createdAt: { 
            $gte: startOfPrevMonth,
            $lt: startOfMonth 
          } 
        } 
      },
      { 
        $group: {
          _id: null,
          count: { $sum: 1 },
          totalValue: { $sum: '$saleValue' },
          totalInfluencerCommission: { $sum: '$influencerCommissionEarned' }
        }
      }
    ]);

    // Comissões pendentes
    const pendingCommissions = await CommissionPayment.aggregate([
      { 
        $match: { 
          userId: influencerId,
          status: 'pending' 
        } 
      },
      { 
        $group: {
          _id: null,
          total: { $sum: '$commissionEarned' },
          count: { $sum: 1 }
        }
      }
    ]);

    // Recuperar informações do cupom
    const user = await User.findById(influencerId);
    const couponCode = user?.couponCode || '';

    // Última venda
    const lastSale = await Sale.findOne({ influencer: influencerId })
      .sort({ createdAt: -1 })
      .lean();

    // Preparar dados para retorno
    const currentMonthData = monthlySales[0] || { count: 0, totalValue: 0, totalInfluencerCommission: 0 };
    const prevMonthData = prevMonthSales[0] || { count: 0, totalValue: 0, totalInfluencerCommission: 0 };
    
    // Calcular variações percentuais
    const salesGrowth = prevMonthData.count > 0 
      ? ((currentMonthData.count - prevMonthData.count) / prevMonthData.count) * 100
      : 0;
    
    const revenueGrowth = prevMonthData.totalValue > 0
      ? ((currentMonthData.totalValue - prevMonthData.totalValue) / prevMonthData.totalValue) * 100
      : 0;

    const commissionGrowth = prevMonthData.totalInfluencerCommission > 0
      ? ((currentMonthData.totalInfluencerCommission - prevMonthData.totalInfluencerCommission) / prevMonthData.totalInfluencerCommission) * 100
      : 0;

    res.json({
      couponCode,
      sales: {
        current: currentMonthData.count,
        previous: prevMonthData.count,
        growth: salesGrowth,
        value: currentMonthData.totalValue,
        lastSale: {
          id: lastSale?._id,
          date: lastSale?.createdAt,
          amount: lastSale?.saleValue || 0,
        }
      },
      commissions: {
        current: currentMonthData.totalInfluencerCommission || 0,
        previous: prevMonthData.totalInfluencerCommission || 0,
        growth: commissionGrowth,
        pending: pendingCommissions[0]?.total || 0,
        pendingCount: pendingCommissions[0]?.count || 0
      }
    });
  } catch (error) {
    console.error('Erro ao obter estatísticas do dashboard influenciador:', error);
    res.status(500).json({ message: 'Erro ao obter estatísticas do dashboard' });
  }
};

router.get('/influencer', protect, getInfluencerDashboardHandler);

// @desc    Get pending commissions summary
// @route   GET /api/dashboard/pending-commissions
// @access  Private (admin only)
const getPendingCommissionsHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Verificar se o usuário é admin
    if (req.user?.role !== 'admin') {
      res.status(403).json({ message: 'Acesso negado' });
      return;
    }

    // Agregar comissões pendentes por usuário
    const pendingCommissions = await CommissionPayment.aggregate([
      { $match: { status: 'pending' } },
      {
        $group: {
          _id: '$userId',
          total: { $sum: '$commissionEarned' },
          count: { $sum: 1 }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'user'
        }
      },
      { $unwind: '$user' },
      {
        $project: {
          _id: 0,
          userId: '$_id',
          name: '$user.name',
          email: '$user.email',
          role: '$user.role',
          amount: '$total',
          count: '$count'
        }
      },
      { $sort: { amount: -1 } }
    ]);

    res.json(pendingCommissions);
  } catch (error) {
    console.error('Erro ao obter resumo de comissões pendentes:', error);
    res.status(500).json({ message: 'Erro ao obter resumo de comissões pendentes' });
  }
};

router.get('/pending-commissions', protect, admin, getPendingCommissionsHandler);

// @desc    Get Performance Overview Stats
// @route   GET /api/dashboard/performance-overview
// @access  Private/Admin
router.get('/performance-overview', protect, admin, getPerformanceOverviewStats);

// @desc    Get Performance Timeline Data
// @route   GET /api/dashboard/performance-timeline
// @access  Private/Admin
router.get('/performance-timeline', protect, admin, getPerformanceTimeline);

// @desc    Get sales chart data
// @route   GET /api/dashboard/sales-chart
// @access  Private
const getSalesChartHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { period = 'month' } = req.query;
    
    // Definir o filtro de data e grupo com base no período
    let match: any = {};
    let dateFormat: string;
    let groupField: any;
    let dateProjectionField = 'formattedDate';

    // Configurar o formato de data e agrupamento com base no período
    if (period === 'week') {
      const startOfWeek = new Date();
      startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
      startOfWeek.setHours(0, 0, 0, 0);
      
      match.createdAt = { $gte: startOfWeek };
      dateFormat = '%Y-%m-%d';
      groupField = `$${dateProjectionField}`;
    } else if (period === 'year') {
      const startOfYear = new Date(new Date().getFullYear(), 0, 1);
      match.createdAt = { $gte: startOfYear };
      dateFormat = '%Y-%m';
      groupField = { year: '$year', month: '$month' };
      dateProjectionField = 'yearMonth';
    } else {
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);
      
      match.createdAt = { $gte: startOfMonth };
      dateFormat = '%Y-%m-%d';
      groupField = `$${dateProjectionField}`;
    }
    
    // Adicionar filtro por usuário específico, se fornecido
    if (req.user?.role === 'manager') {
      // Obter lista de IDs de influenciadores gerenciados por este manager
      const managedInfluencers = await User.find({ manager: req.user._id }).select('_id');
      const influencerIds = managedInfluencers.map(inf => inf._id);
      
      if (influencerIds.length > 0) {
        match.influencer = { $in: influencerIds };
      }
    } else if (req.user?.role === 'influencer') {
      match.influencer = req.user._id;
    }

    // Agregação de vendas por data
    const salesByDate = await Sale.aggregate([
      { $match: match },
      { 
        $addFields: { 
          [dateProjectionField]: { 
             $dateToString: { 
                format: (period === 'year' ? '%Y-%m' : '%Y-%m-%d'), 
                date: '$createdAt' 
             } 
          },
          ...(period === 'year' ? { 
              year: { $year: "$createdAt" },
              month: { $month: "$createdAt" } 
          } : {})
        } 
      },
      {
        $group: {
          _id: groupField,
          totalSales: { $sum: '$saleValue' },
          totalValue: { $sum: '$saleValue' },
          influencerSales: { 
            $sum: { 
              $cond: [{ $gt: ['$influencerCommissionEarned', 0] }, '$saleValue', 0] 
            } 
          },
          managerSales: { 
            $sum: { 
              $cond: [{ $gt: ['$managerCommissionEarned', 0] }, '$saleValue', 0] 
            } 
          },
          dateForLabel: { $first: '$' + dateProjectionField } 
        }
      },
      { $sort: { '_id': 1 } }
    ]);
    
    // Transformar dados para o formato esperado pelo componente frontend
    const transformedData = salesByDate.map(item => {
      let label = '';
      const dateInfo = item.dateForLabel;

      // Formatar o rótulo com base no período e na chave de agrupamento (_id)
      try { // Add error handling for date parsing
        if (period === 'week') {
           // dateInfo should be 'YYYY-MM-DD'
           const date = new Date(dateInfo + 'T00:00:00Z'); // Add Z for UTC
           if (isNaN(date.getTime())) throw new Error('Invalid date format for week');
           const dayNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
           label = dayNames[date.getUTCDay()];
        } else if (period === 'year') {
           // dateInfo should be { year: YYYY, month: MM }
           if (typeof dateInfo !== 'object' || !dateInfo.month) throw new Error('Invalid date info for year');
           const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
           label = monthNames[dateInfo.month - 1]; // Month is 1-based
        } else { // month view (daily)
           // dateInfo should be 'YYYY-MM-DD'
           const date = new Date(dateInfo + 'T00:00:00Z'); // Add Z for UTC
           if (isNaN(date.getTime())) throw new Error('Invalid date format for month');
           label = `${date.getUTCDate()}/${date.getUTCMonth() + 1}`;
        }
      } catch (e: any) {
        console.error(`Error formatting label for period ${period}, dateInfo: ${JSON.stringify(dateInfo)}`, e.message);
        label = 'Erro'; // Fallback label
      }
      
      return {
        name: label,
        label: label,
        influencers: item.influencerSales || 0,
        managers: item.managerSales || 0,
        value: item.totalValue || 0,
      };
    });
    
    res.json(transformedData);
  } catch (error) {
    console.error('Erro ao obter dados do gráfico:', error);
    res.status(500).json({ message: 'Erro ao obter dados do gráfico' });
  }
};

router.get('/sales-chart', protect, getSalesChartHandler);

// @desc    Get influencer ranking by sales
// @route   GET /api/dashboard/influencer-ranking
// @access  Private
const getInfluencerRankingHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { period = 'month', limit = '10' } = req.query;
    const isManager = req.user?.role === 'manager';

    let matchDate: any = {};
    
    // Configurar o filtro de data com base no período
    if (period === 'week') {
      const startOfWeek = new Date();
      startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
      startOfWeek.setHours(0, 0, 0, 0);
      matchDate = { $gte: startOfWeek };
    } else if (period === 'year') {
      const startOfYear = new Date(new Date().getFullYear(), 0, 1);
      matchDate = { $gte: startOfYear };
    } else { // month (default)
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);
      matchDate = { $gte: startOfMonth };
    }
    
    // DEBUG: Exibir a data de filtragem
    console.log(`[getInfluencerRankingHandler] Filtrando vendas a partir de: ${new Date(matchDate.$gte).toISOString()}`);

    // Filtro adicional para gerentes (mostrar apenas seus influenciadores)
    let managedInfluencers: Types.ObjectId[] = [];
    if (isManager) {
      console.log(`[getInfluencerRankingHandler] Usuário é gerente (${req.user?._id}). Buscando influenciadores gerenciados...`);
      const manager = await User.findById(req.user?._id).populate('influencers');
      if (manager && manager.influencers && Array.isArray(manager.influencers)) {
        managedInfluencers = manager.influencers.map(inf => {
          // Converter para ObjectId se for string ou extrair ObjectId do objeto de usuário
          if (typeof inf === 'string') return new Types.ObjectId(inf);
          return (inf as any)._id; // Type assertion para resolver problemas de tipagem
        });
        console.log(`[getInfluencerRankingHandler] ${managedInfluencers.length} influenciadores encontrados para o gerente`);
      } else {
        console.log('[getInfluencerRankingHandler] Nenhum influenciador encontrado para o gerente');
        managedInfluencers = [];
      }
    }

    // Construir o filtro de busca
    const match: any = {
      createdAt: matchDate
    };
    
    // Apenas considerar vendas dos influenciadores gerenciados se for um gerente
    if (isManager && managedInfluencers.length > 0) {
      match.influencer = { $in: managedInfluencers };
    }
    
    // Verificar se existem vendas que correspondem ao filtro
    const salesCount = await Sale.countDocuments(match);
    console.log(`[getInfluencerRankingHandler] Total de vendas encontradas com o filtro: ${salesCount}`);

    // Verificar schema do documento de vendas para confirmar os campos
    const sampleSale = await Sale.findOne();
    console.log('[getInfluencerRankingHandler] Exemplo de venda:', 
                sampleSale ? JSON.stringify(sampleSale, null, 2) : 'Nenhuma venda encontrada');

    // Verifique o total de usuários com role = influencer
    const totalInfluencers = await User.countDocuments({ role: 'influencer' });
    console.log(`[getInfluencerRankingHandler] Total de influenciadores no sistema: ${totalInfluencers}`);
    
    // Se não houver vendas com o filtro aplicado, tente obter pelo menos os influenciadores que têm vendas
    let topInfluencers = [];
    
    if (salesCount > 0) {
      // Agregação para encontrar os influenciadores com maior valor de vendas
      topInfluencers = await Sale.aggregate([
        { $match: match },
        { $group: {
          _id: '$influencer',
          totalSales: { $sum: '$saleValue' },  // Corrigir para usar saleValue
          totalCommission: { $sum: '$influencerCommissionEarned' }  // Corrigir para usar influencerCommissionEarned
        }},
        { $sort: { totalSales: -1 } },
        { $limit: parseInt(limit as string) },
        { $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'influencer'
        }},
        { $unwind: '$influencer' },
        { $project: {
          _id: 0,
          influencerId: '$_id',
          name: '$influencer.name',
          email: '$influencer.email',
          instagram: '$influencer.instagram',
          avatar: '$influencer.avatar',
          couponCode: '$influencer.couponCode',
          totalSales: 1,
          totalCommission: 1,
          trend: { $literal: 0 } // Placeholder: calcular com base em dados históricos
        }}
      ]);
      
      console.log(`[getInfluencerRankingHandler] Influenciadores encontrados pela agregação: ${topInfluencers.length}`);
    } else {
      // Se não há vendas com o período selecionado, tente buscar todas as vendas
      console.log('[getInfluencerRankingHandler] Buscando influenciadores sem filtro de data');
      
      const anyMatch: any = {};
      if (isManager && managedInfluencers.length > 0) {
        anyMatch.influencer = { $in: managedInfluencers };
      }
      
      const anySales = await Sale.countDocuments(anyMatch);
      console.log(`[getInfluencerRankingHandler] Total de vendas na base (sem filtro de data): ${anySales}`);
      
      if (anySales > 0) {
        topInfluencers = await Sale.aggregate([
          { $match: anyMatch },
          { $group: {
            _id: '$influencer',
            totalSales: { $sum: '$saleValue' },
            totalCommission: { $sum: '$influencerCommissionEarned' }
          }},
          { $sort: { totalSales: -1 } },
          { $limit: parseInt(limit as string) },
          { $lookup: {
            from: 'users',
            localField: '_id',
            foreignField: '_id',
            as: 'influencer'
          }},
          { $unwind: '$influencer' },
          { $project: {
            _id: 0,
            influencerId: '$_id',
            name: '$influencer.name',
            email: '$influencer.email',
            instagram: '$influencer.instagram',
            avatar: '$influencer.avatar',
            couponCode: '$influencer.couponCode',
            totalSales: 1,
            totalCommission: 1,
            trend: { $literal: 0 }
          }}
        ]);
        
        console.log(`[getInfluencerRankingHandler] Influenciadores encontrados sem filtro de data: ${topInfluencers.length}`);
      }
    }
    
    // Se ainda não encontrou influenciadores, tentar buscar direto na coleção de usuários
    if (topInfluencers.length === 0) {
      console.log('[getInfluencerRankingHandler] Buscando influenciadores diretamente na coleção de usuários');
      
      const query: any = { role: 'influencer' };
      
      // Se for gerente, buscar apenas seus influenciadores
      if (isManager && managedInfluencers.length > 0) {
        query._id = { $in: managedInfluencers };
      }
      
      const influencers = await User.find(query)
        .limit(parseInt(limit as string))
        .select('_id name email couponCode instagram');
      
      console.log(`[getInfluencerRankingHandler] Influenciadores encontrados na coleção de usuários: ${influencers.length}`);
      
      // Formatar para o mesmo padrão dos resultados de agregação
      topInfluencers = influencers.map(inf => ({
        influencerId: inf._id,
        name: inf.name,
        email: inf.email,
        couponCode: inf.couponCode,
        instagram: inf.instagram,
        totalSales: 0,
        totalCommission: 0,
        trend: 0
      }));
    }

    // Adicione logs para a resposta final
    console.log(`[getInfluencerRankingHandler] Resposta final: ${JSON.stringify(topInfluencers)}`);
    
    res.json(topInfluencers);
    
  } catch (error) {
    console.error('Erro ao obter ranking de influenciadores:', error);
    res.status(500).json({ message: 'Erro ao obter ranking de influenciadores' });
  }
};

router.get('/influencer-ranking', protect, getInfluencerRankingHandler);

// @desc    Get manager ranking by sales
// @route   GET /api/dashboard/manager-ranking
// @access  Private
const getManagerRankingHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { period = 'month', limit = '10' } = req.query;
    const parsedLimit = parseInt(limit as string);

    let matchDate: any = {};

    // Configurar o filtro de data com base no período
    if (period === 'week') {
      const startOfWeek = new Date();
      startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
      startOfWeek.setHours(0, 0, 0, 0);
      matchDate = { $gte: startOfWeek };
    } else if (period === 'year') {
      const startOfYear = new Date(new Date().getFullYear(), 0, 1);
      matchDate = { $gte: startOfYear };
    } else { // month (default)
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);
      matchDate = { $gte: startOfMonth };
    }

    // DEBUG: Exibir a data de filtragem
    console.log(`[getManagerRankingHandler] Filtrando vendas a partir de: ${new Date(matchDate.$gte).toISOString()}`);

    // Verificar se existem vendas que correspondem ao filtro
    const match = {
      createdAt: matchDate,
      influencer: { $exists: true, $ne: null }
    };
    
    const salesCount = await Sale.countDocuments(match);
    console.log(`[getManagerRankingHandler] Total de vendas encontradas com o filtro: ${salesCount}`);

    // Verificar schema do documento de vendas para confirmar os campos
    const sampleSale = await Sale.findOne();
    console.log('[getManagerRankingHandler] Exemplo de venda:', 
                sampleSale ? JSON.stringify(sampleSale, null, 2) : 'Nenhuma venda encontrada');

    // Verifique o total de usuários com role = manager
    const totalManagers = await User.countDocuments({ role: 'manager' });
    console.log(`[getManagerRankingHandler] Total de gerentes no sistema: ${totalManagers}`);

    let managerPerformance = [];

    if (salesCount > 0) {
      // Aggregate sales data, grouping by manager from the linked influencer
      managerPerformance = await Sale.aggregate([
        // Match sales within the specified date range and that have an influencer linked
        { 
          $match: match
        },
        // Lookup the influencer to get their manager
        {
          $lookup: {
            from: 'users', 
            localField: 'influencer', 
            foreignField: '_id',
            as: 'influencerInfo'
          }
        },
        // Unwind the influencerInfo array (should only have one element)
        { $unwind: '$influencerInfo' },
        // Filter out sales where the influencer doesn't have a manager
        { $match: { 'influencerInfo.manager': { $exists: true, $ne: null } } },
        // Group by the manager found in the influencer's document
        {
          $group: {
            _id: '$influencerInfo.manager', // Group by Manager ID
            totalSales: { $sum: '$saleValue' },
            totalCommission: { $sum: '$managerCommissionEarned' }, // Sum manager's commission from these sales
            influencerSalesCount: { $addToSet: '$influencer' } // Collect unique influencer IDs contributing to this manager's total
          }
        },
        // Lookup the manager's details using the grouped _id (manager)
        {
          $lookup: {
            from: 'users', 
            localField: '_id',
            foreignField: '_id',
            as: 'managerInfo'
          }
        },
        { $unwind: '$managerInfo' }, // Unwind manager info
        // Project the final desired fields
        {
          $project: {
            _id: 0, // Exclude the default _id
            managerId: '$_id',
            name: '$managerInfo.name',
            email: '$managerInfo.email',
            totalSales: '$totalSales',
            totalCommission: '$totalCommission',
            influencerCount: { $size: '$influencerSalesCount' }, // Count the unique influencers
          }
        },
        // Sort by total sales descending
        { $sort: { totalSales: -1 } },
        // Limit the results
        { $limit: parsedLimit }
      ]);
      
      console.log(`[getManagerRankingHandler] Gerentes encontrados pela agregação: ${managerPerformance.length}`);
    } else {
      // Se não há vendas, buscar todos os gerentes (sem filtro de data)
      console.log('[getManagerRankingHandler] Buscando gerentes sem filtro de data');
      
      // Verificar se existem vendas para qualquer gerente
      const anySales = await Sale.countDocuments({ influencer: { $exists: true, $ne: null } });
      console.log(`[getManagerRankingHandler] Total de vendas na base: ${anySales}`);
      
      if (anySales > 0) {
        managerPerformance = await Sale.aggregate([
          { $lookup: {
            from: 'users', 
            localField: 'influencer', 
            foreignField: '_id',
            as: 'influencerInfo'
          }},
          { $unwind: '$influencerInfo' },
          { $match: { 'influencerInfo.manager': { $exists: true, $ne: null } } },
          { $group: {
            _id: '$influencerInfo.manager',
            totalSales: { $sum: '$saleValue' },
            totalCommission: { $sum: '$managerCommissionEarned' },
            influencerSalesCount: { $addToSet: '$influencer' }
          }},
          { $lookup: {
            from: 'users', 
            localField: '_id',
            foreignField: '_id',
            as: 'managerInfo'
          }},
          { $unwind: '$managerInfo' },
          { $project: {
            _id: 0,
            managerId: '$_id',
            name: '$managerInfo.name',
            email: '$managerInfo.email',
            totalSales: '$totalSales',
            totalCommission: '$totalCommission',
            influencerCount: { $size: '$influencerSalesCount' },
          }},
          { $sort: { totalSales: -1 } },
          { $limit: parsedLimit }
        ]);
        
        console.log(`[getManagerRankingHandler] Gerentes encontrados sem filtro de data: ${managerPerformance.length}`);
      }
    }

    // Se ainda não encontrou gerentes, tentar buscar direto na coleção de usuários
    if (managerPerformance.length === 0) {
      console.log('[getManagerRankingHandler] Buscando gerentes diretamente na coleção de usuários');
      
      const managers = await User.find({ role: 'manager' })
        .limit(parsedLimit)
        .select('_id name email');
      
      console.log(`[getManagerRankingHandler] Gerentes encontrados na coleção de usuários: ${managers.length}`);
      
      // Formatar para o mesmo padrão dos resultados de agregação
      managerPerformance = managers.map(manager => ({
        managerId: manager._id,
        name: manager.name,
        email: manager.email,
        totalSales: 0,
        totalCommission: 0,
        influencerCount: 0
      }));
    }

    // Adicione logs para a resposta final
    console.log(`[getManagerRankingHandler] Resposta final: ${JSON.stringify(managerPerformance)}`);

    res.json(managerPerformance);

  } catch (error) {
    console.error('Erro ao obter ranking de gerentes:', error);
    res.status(500).json({ message: 'Erro ao obter ranking de gerentes' });
  }
};

router.get('/manager-ranking', protect, getManagerRankingHandler);

export default router; 