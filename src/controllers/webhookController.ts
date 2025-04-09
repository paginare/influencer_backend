import { Request, Response, NextFunction } from 'express';
import asyncHandler from '../utils/asyncHandler';
import User from '../models/User';
import Sale from '../models/Sale';
import CommissionTier from '../models/CommissionTier';
import { sendNewSaleNotification } from '../services/whatsappService';

// Função auxiliar para calcular comissão baseada no valor da venda e nas faixas de comissão
const calculateCommission = async (saleValue: number, role: 'influencer' | 'manager') => {
  // Buscar todas as faixas de comissão ativas para o tipo de usuário
  const tiers = await CommissionTier.find({ 
    appliesTo: role, 
    isActive: true,
    minSalesValue: { $lte: saleValue }
  }).sort({ minSalesValue: -1 }); // Ordena do maior para o menor

  // Se não há faixas, retorna comissão zero
  if (tiers.length === 0) return 0;

  // A primeira faixa (maior valor mínimo que ainda é <= ao valor da venda)
  const applicableTier = tiers[0];

  // Calcular comissão com base na porcentagem da faixa
  return saleValue * (applicableTier.commissionPercentage / 100);
};

// @desc    Processar webhook de venda da Shopify
// @route   POST /api/webhooks/shopify
// @access  Public (mas deve ser verificado por token)
const processShopifyWebhook = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  try {
    console.log('Recebido webhook da Shopify', JSON.stringify(req.body).substring(0, 200) + '...');
    
    // Verificar se o webhook está no formato esperado (com objeto order)
    if (!req.body.order) {
      console.log('Formato incorreto do webhook: objeto order não encontrado');
      res.status(400);
      throw new Error('Formato incorreto do webhook da Shopify. Objeto order não encontrado.');
    }
    
    // Dados recebidos da Shopify dentro do objeto order
    const { 
      id: shopifyOrderId, 
      total_price: totalPrice,
      current_total_price: currentTotalPrice, // Alternativa para o valor total
      discount_codes,
      customer,
      line_items,
      created_at: orderCreatedAt,
      order_number: orderNumber,
      name: orderName
    } = req.body.order;

    // Log para debug
    console.log(`Processando webhook da Shopify para pedido #${shopifyOrderId || orderNumber || orderName}`);

    // Validação básica - usar shopifyOrderId ou alternativas
    const finalOrderId = shopifyOrderId || orderNumber || orderName;
    const finalTotalPrice = totalPrice || currentTotalPrice;
    
    if (!finalOrderId || !finalTotalPrice) {
      console.log('Dados incompletos:', { finalOrderId, finalTotalPrice });
      res.status(400);
      throw new Error('Dados da venda incompletos. Necessário ID do pedido e valor total.');
    }
    
    // 1. Verificar se a venda já foi registrada (evitar duplicação)
    const existingSale = await Sale.findOne({ orderId: finalOrderId.toString() });
    if (existingSale) {
      return res.status(200).json({ 
        message: 'Venda já processada anteriormente', 
        saleId: existingSale._id 
      });
    }
    
    // 2. Verificar se o pedido tem código de cupom
    if (!discount_codes || discount_codes.length === 0) {
      // Sem cupom, retornar sem erro mas não registrar como venda de influenciador
      return res.status(200).json({ 
        message: 'Pedido sem código de cupom de influenciador',
        processed: false
      });
    }
    
    // Obter o primeiro código de cupom (caso tenha múltiplos)
    const couponCode = discount_codes[0].code;
    
    // 3. Localizar o influenciador pelo código do cupom
    const influencer = await User.findOne({ couponCode });
    if (!influencer) {
      // Cupom não corresponde a nenhum influenciador
      return res.status(200).json({ 
        message: `Nenhum influenciador encontrado com o cupom ${couponCode}`,
        processed: false
      });
    }
    
    // 4. Obter o gerente do influenciador
    const manager = influencer.manager 
      ? await User.findById(influencer.manager) 
      : null;
    
    // 5. Calcular comissões
    const orderValue = parseFloat(finalTotalPrice);
    const influencerCommission = await calculateCommission(orderValue, 'influencer');
    const managerCommission = manager ? await calculateCommission(orderValue, 'manager') : 0;
    
    // 6. Registrar a venda
    const newSale = await Sale.create({
      influencer: influencer._id,
      manager: manager ? manager._id : undefined,
      orderId: finalOrderId.toString(),
      saleValue: orderValue,
      commissionCalculated: true, // Já calculamos a comissão no webhook
      influencerCommissionEarned: influencerCommission,
      managerCommissionEarned: managerCommission,
      couponCodeUsed: couponCode,
      transactionDate: new Date(orderCreatedAt || Date.now()),
      processedViaWebhook: true
    });

    // 7. Enviar notificação WhatsApp para o influenciador se ele tiver número cadastrado
    if (influencer.whatsappNumber) {
      try {
        // Buscar o token, nome e templates do manager
        let managerToken: string | undefined = undefined;
        let newSaleTemplate: string | undefined = undefined;
        let managerName: string = 'seu gestor';

        if (influencer.manager) {
            const manager = await User.findById(influencer.manager).select('tokenWhats messageTemplates name email');
            if (manager && manager.tokenWhats) {
                managerToken = manager.tokenWhats;
                managerName = manager.name;
                newSaleTemplate = manager.messageTemplates?.newSale; // Usar newSale (precisa adicionar ao model)
                console.log(`[webhookShopify] Usando token do manager ${manager.email}`);
            } else {
                console.warn(`[webhookShopify] Manager ${influencer.manager} não encontrado ou sem token para notificação de venda.`);
            }
        } else {
             console.warn(`[webhookShopify] Influencer ${influencer.email} sem manager associado para notificação de venda.`);
        }

        // Só envia se tiver token do manager
        if (managerToken) {
            // Definir texto padrão
            let notificationContent = `🎉 Nova venda! Olá ${influencer.name}, venda de R$ ${orderValue.toFixed(2)} registrada. Comissão estimada: R$ ${influencerCommission.toFixed(2)}. Gestor: ${managerName}`;
            
            // Usar template personalizado
            if (newSaleTemplate) {
                console.log(`[webhookShopify] Usando template newSale personalizado do manager.`);
                notificationContent = newSaleTemplate;
            } else {
                 console.log(`[webhookShopify] Usando template newSale padrão.`);
            }
            
            // Substituir variáveis
            notificationContent = notificationContent
                .replace(/{nome}/g, influencer.name)
                .replace(/{valorVenda}/g, orderValue.toFixed(2))
                .replace(/{comissaoEstimada}/g, influencerCommission.toFixed(2))
                .replace(/{gestor}/g, managerName);

             await sendNewSaleNotification(
                influencer.whatsappNumber,
                notificationContent, // Conteúdo processado
                managerToken
            );
             console.log(`[webhookShopify] Notificação de venda enviada para ${influencer.name}`);
        }
      } catch (notificationError) {
        console.error(`[webhookShopify] Erro ao enviar notificação de venda para ${influencer.name}:`, notificationError);
      }
    }
    
    // 8. Enviar resposta de sucesso
    res.status(201).json({
      message: 'Venda registrada com sucesso',
      saleId: newSale._id,
      orderId: finalOrderId,
      influencerId: influencer._id,
      influencerName: influencer.name,
      managerId: manager ? manager._id : null,
      managerName: manager ? manager.name : null,
      orderValue,
      influencerCommission,
      managerCommission
    });
  } catch (error) {
    console.error('Erro no processamento do webhook Shopify:', error);
    next(error);
  }
});

// @desc    Processar webhook de venda da CartPanda
// @route   POST /api/webhooks/cartpanda
// @access  Public (mas deve ser verificado por token)
const processCartPandaWebhook = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  try {
    console.log('Recebido webhook da CartPanda', JSON.stringify(req.body).substring(0, 200) + '...');
    
    // Verificar se o webhook está no formato esperado (com objeto order e evento order.paid)
    if (!req.body.order || req.body.event !== 'order.paid') {
      console.log('Formato incorreto do webhook ou evento não é order.paid:', 
        JSON.stringify({ event: req.body.event, hasOrder: !!req.body.order }).substring(0, 100));
      res.status(400);
      throw new Error('Formato incorreto do webhook da CartPanda. Evento não é order.paid ou objeto order não encontrado.');
    }
    
    // Dados recebidos da CartPanda dentro do objeto order
    const { 
      id: cartPandaOrderId, 
      order_number: orderNumber,
      number: orderNumber2,
      name: orderName,
      total_price: totalPrice,
      discount_codes,
      processed_at: orderCreatedAt,
      created_at: orderCreatedAt2,
    } = req.body.order;

    // Log para debug
    console.log(`Processando webhook da CartPanda para pedido #${cartPandaOrderId || orderNumber || orderNumber2 || orderName}`);

    // Validação básica - usar cartPandaOrderId ou alternativas
    const finalOrderId = cartPandaOrderId || orderNumber || orderNumber2 || orderName;
    
    // Obter o valor total - CartPanda pode enviar o valor em diferentes formatos
    let finalTotalPrice = totalPrice;
    if (typeof finalTotalPrice === 'string') {
      finalTotalPrice = parseFloat(finalTotalPrice.replace(/[^\d.-]/g, ''));
    }
    
    if (!finalOrderId || finalTotalPrice === undefined || isNaN(finalTotalPrice)) {
      console.log('Dados incompletos:', { finalOrderId, finalTotalPrice });
      res.status(400);
      throw new Error('Dados da venda incompletos. Necessário ID do pedido e valor total.');
    }
    
    // 1. Verificar se a venda já foi registrada (evitar duplicação)
    const existingSale = await Sale.findOne({ orderId: finalOrderId.toString() });
    if (existingSale) {
      return res.status(200).json({ 
        message: 'Venda já processada anteriormente', 
        saleId: existingSale._id 
      });
    }
    
    // 2. Extrair o código de cupom - CartPanda usa formato diferente
    // No exemplo da payload, o discount_codes é uma string direta, não um array de objetos
    let couponCode: string | null = null;
    
    if (discount_codes) {
      if (typeof discount_codes === 'string') {
        // Formato direto como string (ex: "lais15")
        couponCode = discount_codes.trim();
      } else if (Array.isArray(discount_codes) && discount_codes.length > 0) {
        // Se for um array de objetos como na Shopify
        if (typeof discount_codes[0] === 'object' && discount_codes[0].code) {
          couponCode = discount_codes[0].code;
        } else if (typeof discount_codes[0] === 'string') {
          couponCode = discount_codes[0];
        }
      } else if (typeof discount_codes === 'object' && discount_codes.code) {
        // Se for um objeto único com propriedade code
        couponCode = discount_codes.code;
      }
    }
    
    console.log(`Cupom encontrado: ${couponCode}`);
    
    if (!couponCode) {
      // Sem cupom, retornar sem erro mas não registrar como venda de influenciador
      return res.status(200).json({ 
        message: 'Pedido sem código de cupom de influenciador',
        processed: false
      });
    }
    
    // 3. Localizar o influenciador pelo código do cupom
    const influencer = await User.findOne({ couponCode });
    if (!influencer) {
      // Cupom não corresponde a nenhum influenciador
      return res.status(200).json({ 
        message: `Nenhum influenciador encontrado com o cupom ${couponCode}`,
        processed: false
      });
    }
    
    // 4. Obter o gerente do influenciador
    const manager = influencer.manager 
      ? await User.findById(influencer.manager) 
      : null;
    
    // 5. Calcular comissões
    const orderValue = parseFloat(finalTotalPrice.toString());
    const influencerCommission = await calculateCommission(orderValue, 'influencer');
    const managerCommission = manager ? await calculateCommission(orderValue, 'manager') : 0;
    
    // 6. Registrar a venda
    const newSale = await Sale.create({
      influencer: influencer._id,
      manager: manager ? manager._id : undefined,
      orderId: finalOrderId.toString(),
      saleValue: orderValue,
      commissionCalculated: true, // Já calculamos a comissão no webhook
      influencerCommissionEarned: influencerCommission,
      managerCommissionEarned: managerCommission,
      couponCodeUsed: couponCode,
      transactionDate: new Date(orderCreatedAt || orderCreatedAt2 || Date.now()),
      processedViaWebhook: true
    });

    // 7. Enviar notificação WhatsApp para o influenciador se ele tiver número cadastrado
    if (influencer.whatsappNumber) {
      try {
        // Buscar o token, nome e templates do manager
        let managerToken: string | undefined = undefined;
        let newSaleTemplate: string | undefined = undefined;
        let managerName: string = 'seu gestor';

        if (influencer.manager) {
            const manager = await User.findById(influencer.manager).select('tokenWhats messageTemplates name email');
            if (manager && manager.tokenWhats) {
                managerToken = manager.tokenWhats;
                managerName = manager.name;
                newSaleTemplate = manager.messageTemplates?.newSale;
                console.log(`[webhookCartPanda] Usando token do manager ${manager.email}`);
            } else {
                console.warn(`[webhookCartPanda] Manager ${influencer.manager} não encontrado ou sem token para notificação de venda.`);
            }
        } else {
             console.warn(`[webhookCartPanda] Influencer ${influencer.email} sem manager associado para notificação de venda.`);
        }

        // Só envia se tiver token do manager
        if (managerToken) {
            // Definir texto padrão
            let notificationContent = `🎉 Nova venda! Olá ${influencer.name}, venda de R$ ${orderValue.toFixed(2)} registrada. Comissão estimada: R$ ${influencerCommission.toFixed(2)}. Gestor: ${managerName}`;
            
            // Usar template personalizado
            if (newSaleTemplate) {
                console.log(`[webhookCartPanda] Usando template newSale personalizado do manager.`);
                notificationContent = newSaleTemplate;
            } else {
                 console.log(`[webhookCartPanda] Usando template newSale padrão.`);
            }
            
            // Substituir variáveis
            notificationContent = notificationContent
                .replace(/{nome}/g, influencer.name)
                .replace(/{valorVenda}/g, orderValue.toFixed(2))
                .replace(/{comissaoEstimada}/g, influencerCommission.toFixed(2))
                .replace(/{gestor}/g, managerName);

             await sendNewSaleNotification(
                influencer.whatsappNumber,
                notificationContent, // Conteúdo processado
                managerToken
            );
             console.log(`[webhookCartPanda] Notificação de venda enviada para ${influencer.name}`);
        }
      } catch (notificationError) {
        console.error(`[webhookCartPanda] Erro ao enviar notificação de venda para ${influencer.name}:`, notificationError);
      }
    }
    
    // 8. Enviar resposta de sucesso
    res.status(201).json({
      message: 'Venda registrada com sucesso',
      saleId: newSale._id,
      orderId: finalOrderId,
      influencerId: influencer._id,
      influencerName: influencer.name,
      managerId: manager ? manager._id : null,
      managerName: manager ? manager.name : null,
      orderValue,
      influencerCommission,
      managerCommission
    });
  } catch (error) {
    console.error('Erro no processamento do webhook CartPanda:', error);
    next(error);
  }
});

// Manter a função original para compatibilidade
const processSaleWebhook = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { 
    orderId, 
    orderValue, 
    couponCode, 
    customerData 
  } = req.body;

  // Validação básica
  if (!orderId || !orderValue || !couponCode) {
    res.status(400);
    throw new Error('Dados da venda incompletos. Necessário orderId, orderValue e couponCode.');
  }

  try {
    // 1. Verificar se a venda já foi registrada (evitar duplicação)
    const existingSale = await Sale.findOne({ orderId });
    if (existingSale) {
      return res.status(200).json({ 
        message: 'Venda já processada anteriormente', 
        saleId: existingSale._id 
      });
    }
    
    // 2. Localizar o influenciador pelo código do cupom
    const influencer = await User.findOne({ couponCode });
    if (!influencer) {
      res.status(400);
      throw new Error(`Nenhum influenciador encontrado com o cupom ${couponCode}`);
    }
    
    // 3. Obter o gerente do influenciador
    const manager = influencer.manager 
      ? await User.findById(influencer.manager) 
      : null;
    
    // 4. Calcular comissões estimadas
    const influencerCommission = await calculateCommission(orderValue, 'influencer');
    const managerCommission = manager ? await calculateCommission(orderValue, 'manager') : 0;
    
    // 5. Registrar a venda
    const newSale = await Sale.create({
      influencer: influencer._id,
      manager: manager ? manager._id : undefined,
      orderId,
      saleValue: orderValue,
      commissionCalculated: true, // Agora já calculamos a comissão
      influencerCommissionEarned: influencerCommission,
      managerCommissionEarned: managerCommission,
      couponCodeUsed: couponCode,
      transactionDate: new Date(),
      processedViaWebhook: true
    });

    // 6. Enviar notificação ao influenciador (se tiver WhatsApp)
    if (influencer.whatsappNumber) {
        try {
            // Buscar token, nome e templates do manager
            let managerToken: string | undefined = undefined;
            let newSaleTemplate: string | undefined = undefined;
            let managerName: string = 'seu gestor';

            if (influencer.manager) {
                const manager = await User.findById(influencer.manager).select('tokenWhats messageTemplates name email');
                if (manager && manager.tokenWhats) {
                    managerToken = manager.tokenWhats;
                    managerName = manager.name;
                    newSaleTemplate = manager.messageTemplates?.newSale; // Usar newSale
                    console.log(`[processSaleWebhook] Usando token do manager ${manager.email}`);
                } else {
                    console.warn(`[processSaleWebhook] Manager ${influencer.manager} não encontrado ou sem token para notificação de venda.`);
                }
            } else {
                console.warn(`[processSaleWebhook] Influencer ${influencer.email} sem manager associado para notificação de venda.`);
            }

            // Só envia se tiver token do manager
            if (managerToken) {
                // Definir texto padrão
                let notificationContent = `🎉 Nova venda! Olá ${influencer.name}, venda de R$ ${orderValue.toFixed(2)} registrada. Comissão estimada: R$ ${influencerCommission.toFixed(2)}. Gestor: ${managerName}`;
                
                // Usar template personalizado
                if (newSaleTemplate) {
                    console.log(`[processSaleWebhook] Usando template newSale personalizado do manager.`);
                    notificationContent = newSaleTemplate;
                } else {
                    console.log(`[processSaleWebhook] Usando template newSale padrão.`);
                }
                
                // Substituir variáveis
                notificationContent = notificationContent
                    .replace(/{nome}/g, influencer.name)
                    .replace(/{valorVenda}/g, orderValue.toFixed(2))
                    .replace(/{comissaoEstimada}/g, influencerCommission.toFixed(2))
                    .replace(/{gestor}/g, managerName);

                await sendNewSaleNotification(
                    influencer.whatsappNumber,
                    notificationContent, // Conteúdo processado
                    managerToken
                );
                 console.log(`[processSaleWebhook] Notificação de venda enviada para ${influencer.name}`);
            }
        } catch (notificationError) {
            console.error(`[processSaleWebhook] Erro ao enviar notificação de venda para ${influencer.name}:`, notificationError);
        }
    }
    
    // 7. Responder ao webhook
    res.status(201).json({
      message: 'Venda registrada com sucesso',
      saleId: newSale._id,
      influencerId: influencer._id,
      managerId: manager ? manager._id : null,
      influencerCommission,
      managerCommission
    });
  } catch (error) {
    // No caso de erro não identificado, o asyncHandler já capturará
    // e o errorHandler retornará o erro formatado
    next(error); 
  }
});

export { processSaleWebhook, processShopifyWebhook, processCartPandaWebhook }; 