import SaleModel, { ISale } from '../models/Sale';
import UserModel, { IUser } from '../models/User';
import CommissionTier from '../models/CommissionTier';
import CommissionPayment from '../models/CommissionPayment';
import { sendSalesReport } from './whatsappService';
import { Types } from 'mongoose';

/**
 * Calcula a comissão para uma venda baseada nas faixas de comissão e tipo de usuário
 * @param saleValue Valor da venda
 * @param role Tipo de usuário (influencer ou manager)
 * @returns Valor da comissão calculada
 */
const calculateCommissionForSale = async (saleValue: number, role: 'influencer' | 'manager') => {
  const tiers = await CommissionTier.find({ 
    appliesTo: role, 
    isActive: true,
    minSalesValue: { $lte: saleValue }
  }).sort({ minSalesValue: -1 });

  if (tiers.length === 0) return 0;

  const applicableTier = tiers[0];
  return saleValue * (applicableTier.commissionPercentage / 100);
};

/**
 * Processa todas as vendas pendentes de cálculo de comissão
 * @returns Objeto com o número de vendas processadas e comissões calculadas
 */
const processPendingCommissions = async () => {
  const pendingSales = await SaleModel.find({ commissionCalculated: false });
  
  let totalProcessed = 0;
  let totalInfluencerCommission = 0;
  let totalManagerCommission = 0;
  
  for (const sale of pendingSales) {
    // Calcular comissão do influenciador
    const influencerCommission = await calculateCommissionForSale(sale.saleValue, 'influencer');
    
    // Calcular comissão do manager (se existir)
    let managerCommission = 0;
    if (sale.manager) {
      managerCommission = await calculateCommissionForSale(sale.saleValue, 'manager');
    }
    
    // Atualizar a venda com os valores calculados
    await SaleModel.findByIdAndUpdate(sale._id, {
      commissionCalculated: true,
      influencerCommissionEarned: influencerCommission,
      managerCommissionEarned: managerCommission
    });
    
    totalProcessed++;
    totalInfluencerCommission += influencerCommission;
    totalManagerCommission += managerCommission;
  }
  
  return {
    processedSales: totalProcessed,
    totalInfluencerCommission,
    totalManagerCommission
  };
};

/**
 * Gera pagamentos de comissão para um período específico
 * @param periodStart Data de início do período
 * @param periodEnd Data de fim do período
 * @returns Objeto com informações dos pagamentos gerados
 */
const generateCommissionPayments = async (periodStart: Date, periodEnd: Date) => {
  // Garantir que todas as vendas do período tenham comissões calculadas
  const uncalculatedSales = await SaleModel.countDocuments({
    transactionDate: { $gte: periodStart, $lte: periodEnd },
    commissionCalculated: false
  });
  
  if (uncalculatedSales > 0) {
    await processPendingCommissions();
  }
  
  // Buscar todas as vendas do período que já têm comissões calculadas
  const sales = await SaleModel.find({
    transactionDate: { $gte: periodStart, $lte: periodEnd },
    commissionCalculated: true
  }).populate<{ influencer: IUser, manager?: IUser }>('influencer').populate<{ influencer: IUser, manager?: IUser }>('manager');
  
  // Mapear vendas por influenciador e manager using ISale
  const influencerSalesMap = new Map<string, (ISale & { influencer: IUser, manager?: IUser })[]>();
  const managerSalesMap = new Map<string, (ISale & { influencer: IUser, manager?: IUser })[]>();
  
  for (const sale of sales) {
    // Agrupar vendas por influenciador (com type assertion)
    const influencerIdStr = (sale.influencer?._id as Types.ObjectId)?.toString();
    if (influencerIdStr) { 
        if (!influencerSalesMap.has(influencerIdStr)) {
          influencerSalesMap.set(influencerIdStr, []);
        }
        influencerSalesMap.get(influencerIdStr)!.push(sale);
    }
    
    // Agrupar vendas por gerente (com type assertion)
    const managerIdStr = (sale.manager?._id as Types.ObjectId)?.toString();
    if (managerIdStr) {
        if (!managerSalesMap.has(managerIdStr)) {
          managerSalesMap.set(managerIdStr, []);
        }
        managerSalesMap.get(managerIdStr)!.push(sale);
    }
  }
  
  // Gerar pagamentos para influenciadores
  const influencerPayments = [];
  for (const [influencerId, influencerSales] of influencerSalesMap.entries()) {
    const influencer = await UserModel.findById(influencerId);
    if (!influencer) continue;
    
    // Add explicit types to reduce parameters
    const totalSalesValue = influencerSales.reduce((sum: number, sale: ISale) => sum + sale.saleValue, 0);
    const totalCommission = influencerSales.reduce((sum: number, sale: ISale) => sum + (sale.influencerCommissionEarned || 0), 0);
    
    const payment = await CommissionPayment.create({
      user: influencerId,
      roleAtPayment: 'influencer',
      sales: influencerSales.map((sale: ISale) => sale._id as Types.ObjectId),
      totalSalesValue,
      commissionEarned: totalCommission,
      paymentPeriodStart: periodStart,
      paymentPeriodEnd: periodEnd,
      calculationDate: new Date(),
      status: 'pending'
    });
    
    influencerPayments.push(payment);
    
    // Enviar relatório via WhatsApp, se o influenciador tiver número cadastrado
    if (influencer.whatsappNumber) {
      try {
        // Buscar token do manager do influencer
        let managerToken: string | undefined = undefined;
        if (influencer.manager) {
            const manager = await UserModel.findById(influencer.manager).select('tokenWhats email');
            if (manager && manager.tokenWhats) {
                managerToken = manager.tokenWhats;
                console.log(`[generateCommissionPayments Influencer] Usando token do manager ${manager.email || influencer.manager}`);
            } else {
                 console.warn(`[generateCommissionPayments Influencer] Manager ${influencer.manager} não encontrado ou sem token para enviar relatório ao influencer ${influencer.email}`);
            }
        } else {
            console.warn(`[generateCommissionPayments Influencer] Influencer ${influencer.email} sem manager associado para enviar relatório.`);
        }

        // Só envia se tiver token do manager
        if (managerToken) {
            const periodFormatted = `${periodStart.toLocaleDateString()} a ${periodEnd.toLocaleDateString()}`;
            
            // Criar mensagem de relatório de vendas
            const reportMessage = `Olá ${influencer.name}!\n\nAqui está seu relatório de vendas do período ${periodFormatted}:\n\nVendas realizadas: ${influencerSales.length}\nValor total: R$ ${totalSalesValue.toFixed(2)}\nComissão: R$ ${totalCommission.toFixed(2)}\n\nContinue o ótimo trabalho!`;
            
            await sendSalesReport(
              influencer.whatsappNumber,
              reportMessage,
              managerToken // Passar token do manager
            );
        } 
      } catch (error) {
        console.error(`Erro ao enviar relatório para influenciador ${influencerId}:`, error);
      }
    }
  }
  
  // Gerar pagamentos para gerentes
  const managerPayments = [];
  for (const [managerId, managerSales] of managerSalesMap.entries()) {
    const manager = await UserModel.findById(managerId);
    if (!manager) continue;
    
    // Add explicit types to reduce parameters
    const totalSalesValue = managerSales.reduce((sum: number, sale: ISale) => sum + sale.saleValue, 0);
    const totalCommission = managerSales.reduce((sum: number, sale: ISale) => sum + (sale.managerCommissionEarned || 0), 0);
    
    const payment = await CommissionPayment.create({
      user: managerId,
      roleAtPayment: 'manager',
      sales: managerSales.map((sale: ISale) => sale._id as Types.ObjectId),
      totalSalesValue,
      commissionEarned: totalCommission,
      paymentPeriodStart: periodStart,
      paymentPeriodEnd: periodEnd,
      calculationDate: new Date(),
      status: 'pending'
    });
    
    managerPayments.push(payment);
  }
  
  return {
    periodStart,
    periodEnd,
    totalSales: sales.length,
    influencerPayments: influencerPayments.length,
    managerPayments: managerPayments.length,
    totalCommissionValue: [
      ...influencerPayments,
      ...managerPayments
    ].reduce((sum, payment) => sum + payment.commissionEarned, 0)
  };
};

export {
  calculateCommissionForSale,
  processPendingCommissions,
  generateCommissionPayments
}; 