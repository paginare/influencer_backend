import { Response } from 'express';
import asyncHandler from '../utils/asyncHandler';
import { AuthRequest } from '../middlewares/authMiddleware';
import User, { IUser, UserRole } from '../models/User';
import Sale from '../models/Sale';
import { isValidObjectId } from 'mongoose';
import { sendWelcomeMessage } from '../services/whatsappService';

// @desc    Obter dados de vendas para o manager logado
// @route   GET /api/manager/sales
// @access  Private/Manager
const getManagerSalesData = asyncHandler(async (req: AuthRequest, res: Response) => {
    const managerId = req.user?._id;

    // Obter lista de influenciadores gerenciados por este manager
    const managedInfluencers = await User.find({ manager: managerId }).select('_id');
    const influencerIds = managedInfluencers.map(inf => inf._id);

    const now = new Date();
    
    // Semanal
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay()); // Início da semana (Domingo)
    startOfWeek.setHours(0, 0, 0, 0);
    
    const weeklySales = await Sale.aggregate([
        // Buscar vendas onde o influencer está na lista de influenciadores gerenciados
        { $match: { influencer: { $in: influencerIds }, createdAt: { $gte: startOfWeek } } },
        { $group: { 
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            sales: { $sum: '$saleValue' },
            commission: { $sum: '$managerCommissionEarned' }
        } },
        { $sort: { _id: 1 } },
        { $project: { _id: 0, date: '$_id', sales: 1, commission: 1 } }
    ]);

    // Mensal
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthlySales = await Sale.aggregate([
        // Buscar vendas onde o influencer está na lista de influenciadores gerenciados
        { $match: { influencer: { $in: influencerIds }, createdAt: { $gte: startOfMonth } } },
        { $group: { 
            _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } },
            sales: { $sum: '$saleValue' },
            commission: { $sum: '$managerCommissionEarned' }
        } },
        { $sort: { _id: 1 } },
        { $project: { _id: 0, date: '$_id', sales: 1, commission: 1 } }
    ]);
    
    // Totais (pode ser otimizado)
    const totalSalesData = await Sale.aggregate([
      // Buscar vendas onde o influencer está na lista de influenciadores gerenciados
      { $match: { influencer: { $in: influencerIds } } },
      { $group: { 
          _id: null,
          totalSales: { $sum: '$saleValue' },
          totalCommission: { $sum: '$managerCommissionEarned' }
      } }
    ]);

    // TODO: Calcular crescimento (growth)
    const growth = 0; // Placeholder

    res.json({
        weekly: weeklySales,
        monthly: monthlySales, // Simplificar: backend pode retornar só mensal, frontend formata
        totalSales: totalSalesData[0]?.totalSales || 0,
        totalCommission: totalSalesData[0]?.totalCommission || 0,
        growth: growth
    });
});

// @desc    Obter lista de influencers do manager logado
// @route   GET /api/manager/influencers
// @access  Private/Manager
const getManagerInfluencers = asyncHandler(async (req: AuthRequest, res: Response) => {
    const managerId = req.user?._id;
    
    // Usar manager como campo de busca
    const influencers = await User.find({ manager: managerId })
                                .select('name email couponCode status instagram notifications');
    
    const influencerData = await Promise.all(influencers.map(async (inf) => {
        const stats = await Sale.aggregate([
            { $match: { influencer: inf._id } },
            { $group: { 
                _id: null,
                sales: { $sum: '$saleValue' },
                commission: { $sum: '$influencerCommissionEarned' }
            } }
        ]);
        
        return {
            id: inf._id,
            name: inf.name,
            email: inf.email,
            coupon: inf.couponCode,
            status: inf.status,
            instagram: inf.instagram,
            notifications: inf.notifications,
            sales: stats[0]?.sales || 0,
            commission: stats[0]?.commission || 0,
            trend: "+0%" // Placeholder
        };
    }));

    res.json(influencerData);
});

// @desc    Criar um novo influencer para o manager logado
// @route   POST /api/manager/influencers
// @access  Private/Manager
const createManagerInfluencer = asyncHandler(async (req: AuthRequest, res: Response) => {
    const managerId = req.user?._id;
    const { name, email, whatsappNumber, coupon: couponCode } = req.body;

    if (!name || !email || !couponCode) {
        res.status(400);
        throw new Error('Nome, email e cupom são obrigatórios');
    }
    
    // Verificar se email ou cupom já existem
    const emailExists = await User.findOne({ email });
    if (emailExists) {
        res.status(400);
        throw new Error('Este email já está em uso');
    }
    const couponExists = await User.findOne({ couponCode });
    if (couponExists) {
        res.status(400);
        throw new Error('Este cupom já está em uso');
    }

    // TODO: Definir como a senha inicial será tratada.
    // Gerar uma senha aleatória ou pedir no formulário?
    const temporaryPassword = process.env.DEFAULT_INFLUENCER_PASSWORD || 'Senha@123'; // Use uma variável de ambiente ou um padrão seguro

    const influencer = await User.create({
        name,
        email,
        whatsappNumber,
        couponCode,
        role: UserRole.INFLUENCER,
        manager: managerId,
        password: temporaryPassword,
        status: 'Ativo'
    });

    if (influencer) {
        // --- Adicionar Envio de Mensagem de Boas-vindas --- 
        console.log(`[createManagerInfluencer] Checking conditions for welcome message for user ${influencer.email}`);
        console.log(`[createManagerInfluencer] Has WhatsApp: ${!!whatsappNumber}, WhatsApp Number: ${whatsappNumber}, Has Coupon: ${!!couponCode}, Coupon Code: ${couponCode}`);

        if (whatsappNumber && couponCode) { 
             console.log(`[createManagerInfluencer] Conditions MET. Attempting to send welcome message to ${whatsappNumber}`);
             try {
                 // Buscar o token e os templates do manager
                 const manager = await User.findById(managerId).select('tokenWhats messageTemplates name email'); // Incluir messageTemplates e name
                 if (!manager || !manager.tokenWhats) {
                     console.warn(`[createManagerInfluencer] Manager ${managerId} não encontrado ou não possui tokenWhats. Mensagem de boas-vindas não pode ser enviada.`);
                 } else {
                     console.log(`[createManagerInfluencer] Using manager's token: ${manager.tokenWhats ? '***' : 'N/A'}`);
                     
                     // Definir texto padrão
                     let welcomeMessageContent = `Olá ${name}! Bem-vindo(a) à nossa plataforma! Seu cupom é: *${couponCode}*. Boas vendas! Gestor: ${manager.name}`; 
                     
                     // Verificar se há template personalizado do manager
                     if (manager.messageTemplates?.welcome) {
                         console.log(`[createManagerInfluencer] Usando template de boas-vindas personalizado do manager ${manager.email}`);
                         welcomeMessageContent = manager.messageTemplates.welcome;
                     } else {
                         console.log(`[createManagerInfluencer] Usando template de boas-vindas padrão.`);
                     }
                     
                     // Substituir variáveis
                     welcomeMessageContent = welcomeMessageContent
                         .replace(/{nome}/g, name)
                         .replace(/{cupom}/g, couponCode)
                         .replace(/{gestor}/g, manager.name); // Adicionar variável {gestor}

                     // Passar o conteúdo final e o token do manager para a função de envio
                     await sendWelcomeMessage(
                         whatsappNumber, 
                         welcomeMessageContent, // Conteúdo processado
                         manager.tokenWhats
                     );
                     console.log(`[createManagerInfluencer] Welcome message function called successfully for ${whatsappNumber}.`);
                 }
             } catch (error) {
                 console.error(`[createManagerInfluencer] Error processing/sending welcome message for ${whatsappNumber}:`, error);
             }
        } else {
            console.log(`[createManagerInfluencer] Conditions NOT MET for sending welcome message.`);
        }
        // --- Fim do Envio --- 

        // Adicionar o influencer ao array do manager (importante!)
        await User.findByIdAndUpdate(managerId, { $addToSet: { influencers: influencer._id } });
        console.log(`[createManagerInfluencer] Influencer ${influencer._id} added to manager ${managerId}`);

        // Resposta formatada para o frontend
        res.status(201).json({
             id: influencer._id,
             name: influencer.name,
             email: influencer.email,
             coupon: influencer.couponCode,
             status: influencer.status,
             whatsappNumber: influencer.whatsappNumber,
             instagram: null, // Assumindo null inicialmente
             // Os dados de sales/commission/trend serão calculados no GET
             sales: 0,
             commission: 0,
             trend: "+0%"
        });
    } else {
        res.status(400);
        throw new Error('Dados inválidos para criar influencer');
    }
});

// @desc    Atualizar um influencer do manager logado
// @route   PUT /api/manager/influencers/:influencerId
// @access  Private/Manager
const updateManagerInfluencer = asyncHandler(async (req: AuthRequest, res: Response) => {
    const managerId = req.user?._id;
    const { influencerId } = req.params;
    const { name, email, phone, instagram, coupon, status } = req.body;

    if (!isValidObjectId(influencerId)) {
        res.status(400); throw new Error('ID de Influencer inválido');
    }

    const influencer = await User.findOne({ _id: influencerId, manager: managerId });

    if (!influencer) {
        res.status(404);
        throw new Error('Influencer não encontrado ou não pertence a este manager');
    }
    
    // Verificar disponibilidade do cupom se ele for alterado
    if (coupon && coupon !== influencer.couponCode) {
        const couponExists = await User.findOne({ couponCode: coupon, _id: { $ne: influencerId } });
        if (couponExists) {
            res.status(400);
            throw new Error('Este cupom já está em uso por outro usuário');
        }
        influencer.couponCode = coupon;
    }
    
    // Verificar disponibilidade do email se ele for alterado
    if (email && email !== influencer.email) {
        const emailExists = await User.findOne({ email: email, _id: { $ne: influencerId } });
        if (emailExists) {
            res.status(400);
            throw new Error('Este email já está em uso por outro usuário');
        }
        influencer.email = email;
    }

    influencer.name = name || influencer.name;
    influencer.whatsappNumber = phone || influencer.whatsappNumber;
    influencer.instagram = instagram || influencer.instagram;
    influencer.status = status || influencer.status;

    const updatedInfluencer = await influencer.save();

    // Retornar dados formatados
     res.json({
         id: updatedInfluencer._id,
         name: updatedInfluencer.name,
         email: updatedInfluencer.email,
         coupon: updatedInfluencer.couponCode,
         status: updatedInfluencer.status,
         phone: updatedInfluencer.whatsappNumber,
         instagram: updatedInfluencer.instagram,
         // TODO: Recalcular sales/commission/trend se necessário?
         sales: 0, // Placeholder
         commission: 0, // Placeholder
         trend: "+0%" // Placeholder
    });
});

// @desc    Deletar um influencer do manager logado
// @route   DELETE /api/manager/influencers/:influencerId
// @access  Private/Manager
const deleteManagerInfluencer = asyncHandler(async (req: AuthRequest, res: Response) => {
    const managerId = req.user?._id;
    const { influencerId } = req.params;
    
    if (!isValidObjectId(influencerId)) {
        res.status(400); throw new Error('ID de Influencer inválido');
    }

    const influencer = await User.findOne({ _id: influencerId, manager: managerId });

    if (!influencer) {
        res.status(404);
        throw new Error('Influencer não encontrado ou não pertence a este manager');
    }

    // Em vez de deletar, podemos marcar como inativo ou remover a associação
    // await User.findByIdAndDelete(influencerId);
    // Ou:
    // influencer.managerId = null; // Ou marcar status como "Removido"
    // await influencer.save();
    
    // Por enquanto, vamos deletar (pode ser perigoso)
    await User.deleteOne({ _id: influencerId });
    
    // Remover do array do manager (se aplicável)
    // await User.findByIdAndUpdate(managerId, { $pull: { influencers: influencerId } });

    res.status(204).send(); // No content
});

// @desc    Obter detalhes de um influencer específico do manager
// @route   GET /api/manager/influencers/:influencerId
// @access  Private/Manager
const getManagerInfluencerDetails = asyncHandler(async (req: AuthRequest, res: Response) => {
    const managerId = req.user?._id;
    const { influencerId } = req.params;

    if (!isValidObjectId(influencerId)) {
        res.status(400); throw new Error('ID de Influencer inválido');
    }

    const influencer = await User.findOne({ _id: influencerId, manager: managerId })
                             .select('name email couponCode status whatsappNumber instagram');

    if (!influencer) {
        res.status(404);
        throw new Error('Influencer não encontrado ou não pertence a este manager');
    }
    
     // TODO: Buscar dados de sales/commission/trend
     const stats = await Sale.aggregate([
            { $match: { influencer: influencer._id } },
            { $group: { 
                _id: null,
                sales: { $sum: '$saleValue' },
                commission: { $sum: '$influencerCommissionEarned' }
            } }
        ]);

    res.json({
        id: influencer._id,
        name: influencer.name,
        email: influencer.email,
        coupon: influencer.couponCode,
        status: influencer.status,
        whatsappNumber: influencer.whatsappNumber,
        instagram: influencer.instagram,
        sales: stats[0]?.sales || 0,
        commission: stats[0]?.commission || 0,
        trend: "+0%" // Placeholder
    });
});

// @desc    Atualizar configurações de notificação de um influencer
// @route   PUT /api/manager/influencers/:influencerId/notifications
// @access  Private/Manager
const updateInfluencerNotifications = asyncHandler(async (req: AuthRequest, res: Response) => {
    const managerId = req.user?._id;
    const { influencerId } = req.params;
    const { welcome, report, reminder, reportFrequency, reminderThreshold } = req.body;

    if (!isValidObjectId(influencerId)) {
        res.status(400); throw new Error('ID de Influencer inválido');
    }

    // Encontrar o influencer e garantir que pertence ao manager
    const influencer = await User.findOne({ _id: influencerId, manager: managerId });

    if (!influencer) {
        res.status(404);
        throw new Error('Influencer não encontrado ou não pertence a este manager');
    }
    
    // Atualizar as configurações de notificação
    influencer.notifications = {
        welcome: welcome !== undefined ? welcome : influencer.notifications.welcome,
        report: report !== undefined ? report : influencer.notifications.report,
        reminder: reminder !== undefined ? reminder : influencer.notifications.reminder,
        reportFrequency: reportFrequency || influencer.notifications.reportFrequency,
        reminderThreshold: reminderThreshold || influencer.notifications.reminderThreshold,
    };

    await influencer.save();

    res.json({ message: 'Configurações de notificação atualizadas', notifications: influencer.notifications });
});

export {
    getManagerSalesData,
    getManagerInfluencers,
    createManagerInfluencer,
    updateManagerInfluencer,
    deleteManagerInfluencer,
    getManagerInfluencerDetails,
    updateInfluencerNotifications
}; 