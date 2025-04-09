import { Request, Response, NextFunction } from 'express';
import asyncHandler from '../utils/asyncHandler';
import Sale from '../models/Sale';
import CommissionTier from '../models/CommissionTier';
import CommissionPayment from '../models/CommissionPayment';
import { AuthRequest } from '../middlewares/authMiddleware';
import { processPendingCommissions, generateCommissionPayments } from '../services/commissionService';
import mongoose from 'mongoose';
import User from '../models/User';

// @desc    Criar uma nova faixa de comissão
// @route   POST /api/commissions/tiers
// @access  Private/Admin
const createCommissionTier = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { name, minSalesValue, maxSalesValue, commissionPercentage, appliesTo } = req.body;

  // Validação básica
  if (!name || minSalesValue === undefined || !commissionPercentage || !appliesTo) {
    res.status(400);
    throw new Error('Por favor, forneça todos os campos obrigatórios');
  }

  // Validação de valores
  if (minSalesValue < 0 || commissionPercentage < 0 || commissionPercentage > 100) {
    res.status(400);
    throw new Error('Valores inválidos: minSalesValue deve ser >= 0 e commissionPercentage entre 0 e 100');
  }

  // Validação de máximo (se fornecido)
  if (maxSalesValue !== undefined && maxSalesValue <= minSalesValue) {
    res.status(400);
    throw new Error('maxSalesValue deve ser maior que minSalesValue');
  }

  const tier = await CommissionTier.create({
    name,
    minSalesValue,
    maxSalesValue,
    commissionPercentage,
    appliesTo,
    isActive: true
  });

  res.status(201).json(tier);
});

// @desc    Listar todas as faixas de comissão
// @route   GET /api/commissions/tiers
// @access  Private/Admin/Manager
const getCommissionTiers = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { appliesTo, isActive } = req.query;
  
  let query: any = {};
  
  // Filtros opcionais
  if (appliesTo) query.appliesTo = appliesTo;
  if (isActive) query.isActive = isActive === 'true';
  
  const tiers = await CommissionTier.find(query).sort({ minSalesValue: 1 });
  
  res.json(tiers);
});

// @desc    Atualizar uma faixa de comissão
// @route   PUT /api/commissions/tiers/:id
// @access  Private/Admin
const updateCommissionTier = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { name, minSalesValue, maxSalesValue, commissionPercentage, isActive } = req.body;
  
  const tier = await CommissionTier.findById(req.params.id);
  
  if (!tier) {
    res.status(404);
    throw new Error('Faixa de comissão não encontrada');
  }
  
  // Atualizar os campos
  if (name) tier.name = name;
  if (minSalesValue !== undefined) tier.minSalesValue = minSalesValue;
  if (maxSalesValue !== undefined) tier.maxSalesValue = maxSalesValue;
  if (commissionPercentage !== undefined) tier.commissionPercentage = commissionPercentage;
  if (isActive !== undefined) tier.isActive = isActive;
  
  // Validação de valores
  if (tier.minSalesValue < 0 || tier.commissionPercentage < 0 || tier.commissionPercentage > 100) {
    res.status(400);
    throw new Error('Valores inválidos: minSalesValue deve ser >= 0 e commissionPercentage entre 0 e 100');
  }
  
  // Validação de máximo (se fornecido)
  if (tier.maxSalesValue !== undefined && tier.maxSalesValue <= tier.minSalesValue) {
    res.status(400);
    throw new Error('maxSalesValue deve ser maior que minSalesValue');
  }
  
  const updatedTier = await tier.save();
  
  res.json(updatedTier);
});

// @desc    Excluir uma faixa de comissão (desativar)
// @route   DELETE /api/commissions/tiers/:id
// @access  Private/Admin
const deleteCommissionTier = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const tier = await CommissionTier.findById(req.params.id);
  
  if (!tier) {
    res.status(404);
    throw new Error('Faixa de comissão não encontrada');
  }
  
  // Em vez de excluir, apenas marcamos como inativa
  tier.isActive = false;
  await tier.save();
  
  res.json({ message: 'Faixa de comissão desativada com sucesso' });
});

// @desc    Obter vendas por influenciador ou gerente
// @route   GET /api/commissions/sales
// @access  Private
const getSales = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user) {
    res.status(401);
    throw new Error('Não autorizado');
  }
  
  const { 
    startDate, 
    endDate, 
    influencerId, 
    managerId, 
    page = 1, 
    limit = 20 
  } = req.query;
  
  let query: any = {};
  
  // Filtros de data
  if (startDate || endDate) {
    query.transactionDate = {};
    if (startDate) query.transactionDate.$gte = new Date(startDate as string);
    if (endDate) query.transactionDate.$lte = new Date(endDate as string);
  }
  
  // Filtros de usuário baseados na função do usuário logado
  if (req.user.role === 'influencer') {
    // Influenciadores só podem ver suas próprias vendas
    query.influencer = req.user._id;
  } else if (req.user.role === 'manager') {
    // Gerentes podem ver vendas de seus influenciadores ou as próprias
    if (influencerId) {
      // Verificar se o influenciador pertence a este gerente
      if (req.user.influencers && req.user.influencers.includes(influencerId as any)) {
        query.influencer = influencerId;
      } else {
        res.status(403);
        throw new Error('Acesso negado: este influenciador não pertence a você');
      }
    } else {
      // Mostrar vendas de todos os influenciadores gerenciados
      query.manager = req.user._id;
    }
  } else if (req.user.role === 'admin') {
    // Admins podem filtrar por qualquer influenciador ou gerente
    if (influencerId) query.influencer = influencerId;
    if (managerId) query.manager = managerId;
  }
  
  // Cálculo de paginação
  const pageNum = parseInt(page as string, 10);
  const limitNum = parseInt(limit as string, 10);
  const skip = (pageNum - 1) * limitNum;
  
  // Buscar vendas com paginação
  const sales = await Sale.find(query)
    .populate('influencer', 'name email couponCode')
    .populate('manager', 'name email')
    .sort({ transactionDate: -1 })
    .skip(skip)
    .limit(limitNum);
  
  // Contar total para informação de paginação
  const totalSales = await Sale.countDocuments(query);
  
  res.json({
    sales,
    page: pageNum,
    pages: Math.ceil(totalSales / limitNum),
    total: totalSales
  });
});

// @desc    Processar comissões pendentes (job)
// @route   POST /api/commissions/process-pending
// @access  Private/Admin
const processCommissions = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const result = await processPendingCommissions();
  
  res.json({
    message: 'Processamento de comissões concluído',
    processedSales: result.processedSales,
    totalInfluencerCommission: result.totalInfluencerCommission,
    totalManagerCommission: result.totalManagerCommission
  });
});

// @desc    Gerar pagamentos para um período
// @route   POST /api/commissions/generate-payments
// @access  Private/Admin
const createCommissionPayments = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { startDate, endDate } = req.body;
  
  if (!startDate || !endDate) {
    res.status(400);
    throw new Error('Por favor, forneça datas de início e fim');
  }
  
  const periodStart = new Date(startDate);
  const periodEnd = new Date(endDate);
  
  if (isNaN(periodStart.getTime()) || isNaN(periodEnd.getTime())) {
    res.status(400);
    throw new Error('Datas inválidas');
  }
  
  if (periodEnd < periodStart) {
    res.status(400);
    throw new Error('A data final deve ser posterior à data inicial');
  }
  
  const result = await generateCommissionPayments(periodStart, periodEnd);
  
  res.status(201).json({
    message: 'Pagamentos de comissão gerados com sucesso',
    ...result
  });
});

// @desc    Listar pagamentos de comissão
// @route   GET /api/commissions/payments
// @access  Private
const getCommissionPayments = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user) {
    res.status(401);
    throw new Error('Não autorizado');
  }
  
  const { 
    status, 
    startDate, 
    endDate, 
    userId,
    page = 1, 
    limit = 20 
  } = req.query;
  
  let query: any = {};
  
  // Filtros de status
  if (status) query.status = status;
  
  // Filtros de data para o período de pagamento
  if (startDate || endDate) {
    query.paymentPeriodStart = {};
    query.paymentPeriodEnd = {};
    
    if (startDate) {
      const start = new Date(startDate as string);
      query.paymentPeriodStart.$gte = start;
    }
    
    if (endDate) {
      const end = new Date(endDate as string);
      query.paymentPeriodEnd.$lte = end;
    }
  }
  
  // Filtros baseados no papel do usuário
  if (req.user.role === 'influencer' || req.user.role === 'manager') {
    // Usuários normais só podem ver seus próprios pagamentos
    query.user = req.user._id;
  } else if (req.user.role === 'admin') {
    // Admins podem filtrar por qualquer usuário
    if (userId) query.user = userId;
  }
  
  // Cálculo de paginação
  const pageNum = parseInt(page as string, 10);
  const limitNum = parseInt(limit as string, 10);
  const skip = (pageNum - 1) * limitNum;
  
  // Buscar pagamentos com paginação
  const payments = await CommissionPayment.find(query)
    .populate('user', 'name email role')
    .sort({ calculationDate: -1 })
    .skip(skip)
    .limit(limitNum);
  
  // Contar total para informação de paginação
  const totalPayments = await CommissionPayment.countDocuments(query);
  
  res.json({
    payments,
    page: pageNum,
    pages: Math.ceil(totalPayments / limitNum),
    total: totalPayments
  });
});

// @desc    Atualizar status de pagamento
// @route   PUT /api/commissions/payments/:id
// @access  Private/Admin
const updatePaymentStatus = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { status, transactionId } = req.body;
  
  if (!status) {
    res.status(400);
    throw new Error('Por favor, forneça o status');
  }
  
  if (!['pending', 'paid', 'failed'].includes(status)) {
    res.status(400);
    throw new Error('Status inválido. Use: pending, paid ou failed');
  }
  
  const payment = await CommissionPayment.findById(req.params.id);
  
  if (!payment) {
    res.status(404);
    throw new Error('Pagamento não encontrado');
  }
  
  // Atualizar status
  payment.status = status as 'pending' | 'paid' | 'failed';
  
  // Se status for "paid", atualizar a data de pagamento e transactionId
  if (status === 'paid') {
    payment.paymentDate = new Date();
    if (transactionId) payment.transactionId = transactionId;
  }
  
  const updatedPayment = await payment.save();
  
  res.json(updatedPayment);
});

// @desc    Salvar (substituir) todas as faixas de comissão para um tipo de usuário (influencer ou manager)
// @route   PUT /api/commissions/tiers/bulk
// @access  Private/Admin
const saveCommissionTiersBulk = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { appliesTo, tiers } = req.body;

    if (!appliesTo || !['influencer', 'manager'].includes(appliesTo)) {
        res.status(400);
        throw new Error('Tipo de usuário (appliesTo) inválido ou não fornecido.');
    }

    if (!Array.isArray(tiers)) {
        res.status(400);
        throw new Error(`Formato inválido: "tiers" deve ser um array.`);
    }

    // Validação básica de cada tier no array
    for (const tier of tiers) {
        if (tier.minSalesValue === undefined || tier.commissionPercentage === undefined) {
            res.status(400);
            throw new Error('Cada tier deve ter pelo menos minSalesValue e commissionPercentage.');
        }
        // Adicione mais validações se necessário (tipos, ranges, etc.)
         if (typeof tier.minSalesValue !== 'number' || typeof tier.commissionPercentage !== 'number' ||
             (tier.maxSalesValue !== undefined && typeof tier.maxSalesValue !== 'number')) {
             res.status(400);
             throw new Error('Valores min/max/percentage devem ser números.');
         }
         if (tier.maxSalesValue !== undefined && tier.maxSalesValue <= tier.minSalesValue) {
             res.status(400);
             throw new Error(`Tier inválido: maxSalesValue (${tier.maxSalesValue}) deve ser maior que minSalesValue (${tier.minSalesValue}).`);
         }
    }

    // Iniciar transação para garantir atomicidade
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        // 1. Remover todas as faixas existentes para este tipo
        await CommissionTier.deleteMany({ appliesTo: appliesTo }, { session });

        // 2. Criar as novas faixas, gerando um nome para cada
        const newTiersData = tiers.map(tier => {
            let tierName;
            const formatCurrency = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

            if (tier.maxSalesValue !== undefined && tier.maxSalesValue !== null) {
                tierName = `Faixa ${formatCurrency(tier.minSalesValue)} a ${formatCurrency(tier.maxSalesValue)}`;
            } else {
                tierName = `Faixa acima de ${formatCurrency(tier.minSalesValue)}`;
            }

            return {
                ...tier,
                name: tierName, // Add generated name
                appliesTo: appliesTo,
                isActive: true // Sempre ativar ao salvar em bulk
            };
        });

        const createdTiers = await CommissionTier.insertMany(newTiersData, { session });

        // Commit da transação
        await session.commitTransaction();

        res.status(200).json(createdTiers);

    } catch (error) {
        // Abortar transação em caso de erro
        await session.abortTransaction();
        throw error; // Deixar o error handler padrão lidar com isso
    } finally {
        // Finalizar a sessão
        session.endSession();
    }
});

// @desc    Verificar se um código de cupom está disponível
// @route   GET /api/commissions/check?code=CODIGO
// @access  Private (Auth requerida via middleware na rota)
const checkCouponCodeAvailability = asyncHandler(async (req: Request, res: Response) => {
    const { code } = req.query;
    console.log(`[checkCouponAvailability] Recebido code: ${code}`);

    if (!code) {
        console.error('[checkCouponAvailability] Código não fornecido');
        res.status(400);
        throw new Error('Código do cupom não fornecido');
    }

    try {
      // Verifica se existe algum usuário com este código de cupom
      console.log(`[checkCouponAvailability] Buscando usuário com couponCode: ${code}`);
      const existingUser = await User.findOne({ couponCode: code as string });
      console.log('[checkCouponAvailability] Resultado de User.findOne:', existingUser);

      const isAvailable = !existingUser;
      console.log(`[checkCouponAvailability] Cupom está disponível? ${isAvailable}`);

      res.json({ available: isAvailable });
    } catch (dbError) {
        console.error('[checkCouponAvailability] Erro durante busca no DB:', dbError);
        res.status(500).json({ message: 'Erro interno ao verificar cupom' });
    }
});

export {
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
}; 