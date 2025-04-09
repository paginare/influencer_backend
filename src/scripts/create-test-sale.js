const mongoose = require('mongoose');
const path = require('path');
const User = require(path.join(__dirname, '..', 'models', 'User'));
const Sale = require(path.join(__dirname, '..', 'models', 'Sale'));

async function createTestSale() {
  try {
    // Conectar ao MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/influencer-platform');
    console.log('Conectado ao MongoDB!');

    // Buscar o influencer "antonio duarte" existente
    const influencer = await User.findOne({ email: 'antonio@notifiquei.com.br' });

    if (!influencer) {
      console.error('Influencer não encontrado!');
      return;
    }

    console.log(`Encontrou influencer: ${influencer.name} (${influencer._id})`);

    // Buscar o manager do influencer
    let manager = null;
    if (influencer.manager) {
      manager = await User.findById(influencer.manager);
      console.log(`Manager encontrado: ${manager?.name} (${manager?._id})`);
    } else {
      console.log('Influencer não tem manager associado!');
    }

    // Criar uma venda de teste
    const sale = new Sale({
      influencer: influencer._id,
      manager: manager?._id,
      orderId: `TEST-ORDER-${Date.now()}`,
      saleValue: 100.00,
      commissionCalculated: true,
      influencerCommissionEarned: 10.00,
      managerCommissionEarned: manager ? 5.00 : 0,
      couponCodeUsed: influencer.couponCode,
      transactionDate: new Date(),
      processedViaWebhook: false
    });

    await sale.save();
    console.log(`Venda criada com sucesso! ID: ${sale._id}`);

    // Desconectar
    await mongoose.connection.close();
    console.log('Desconectado do MongoDB!');
  } catch (error) {
    console.error('Erro:', error);
  }
}

createTestSale(); 