/**
 * Script para criar usuários de teste (gerente e influenciador)
 * 
 * Este script cria um gerente e um influenciador para testar o sistema
 * 
 * Para executar: npx ts-node src/scripts/createTestUsers.ts
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User, { UserRole } from '../models/User';
import CommissionTier from '../models/CommissionTier';
import { sendWelcomeMessage } from '../services/whatsappService';

// Carregar variáveis de ambiente
dotenv.config();

// Configurações de usuários de teste
const testManager = {
  name: 'Gerente Teste',
  email: 'gerente@example.com',
  password: 'senha123',
  role: UserRole.MANAGER,
  whatsappNumber: '5511999999998' // Opcional
};

const testInfluencer = {
  name: 'Influencer Teste',
  email: 'influencer@example.com',
  password: 'senha123',
  role: UserRole.INFLUENCER,
  couponCode: 'TESTE10',
  whatsappNumber: '5511999999997' // Opcional
};

// Configurações de faixas de comissão de teste
const commissionTiers = [
  // Faixas para influenciadores
  {
    name: 'Bronze - Influenciador',
    minSalesValue: 0,
    maxSalesValue: 1000,
    commissionPercentage: 10,
    appliesTo: 'influencer',
    isActive: true
  },
  {
    name: 'Prata - Influenciador',
    minSalesValue: 1000.01,
    maxSalesValue: 5000,
    commissionPercentage: 15,
    appliesTo: 'influencer',
    isActive: true
  },
  {
    name: 'Ouro - Influenciador',
    minSalesValue: 5000.01,
    commissionPercentage: 20,
    appliesTo: 'influencer',
    isActive: true
  },
  // Faixas para gerentes
  {
    name: 'Bronze - Gerente',
    minSalesValue: 0,
    maxSalesValue: 5000,
    commissionPercentage: 2,
    appliesTo: 'manager',
    isActive: true
  },
  {
    name: 'Prata - Gerente',
    minSalesValue: 5000.01,
    maxSalesValue: 20000,
    commissionPercentage: 3,
    appliesTo: 'manager',
    isActive: true
  },
  {
    name: 'Ouro - Gerente',
    minSalesValue: 20000.01,
    commissionPercentage: 5,
    appliesTo: 'manager',
    isActive: true
  }
];

// Conexão com o MongoDB
async function connectToDatabase() {
  const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/influencer_hub';
  
  try {
    console.log('Conectando ao MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('Conectado ao MongoDB com sucesso!');
    return true;
  } catch (error) {
    console.error('Erro ao conectar ao MongoDB:', error);
    return false;
  }
}

// Criar faixas de comissão
async function createCommissionTiers() {
  console.log('Verificando faixas de comissão existentes...');
  const existingTiersCount = await CommissionTier.countDocuments();
  
  if (existingTiersCount > 0) {
    console.log(`${existingTiersCount} faixas de comissão já existem no sistema.`);
    return;
  }
  
  console.log('Criando faixas de comissão...');
  for (const tier of commissionTiers) {
    await CommissionTier.create(tier);
  }
  
  console.log(`${commissionTiers.length} faixas de comissão criadas com sucesso!`);
}

// Criar usuários de teste
async function createTestUsers() {
  try {
    // 1. Verificar se o gerente já existe
    let manager = await User.findOne({ email: testManager.email });
    
    if (!manager) {
      console.log('Criando usuário gerente...');
      manager = await User.create(testManager);
      console.log(`Gerente criado com sucesso! ID: ${manager._id}`);
    } else {
      console.log(`Gerente já existe! ID: ${manager._id}`);
    }
    
    // 2. Verificar se o influenciador já existe
    const existingInfluencer = await User.findOne({ 
      $or: [
        { email: testInfluencer.email },
        { couponCode: testInfluencer.couponCode }
      ]
    });
    
    if (existingInfluencer) {
      console.log('Influenciador já existe:');
      console.log(`ID: ${existingInfluencer._id}`);
      console.log(`Nome: ${existingInfluencer.name}`);
      console.log(`Email: ${existingInfluencer.email}`);
      console.log(`Cupom: ${existingInfluencer.couponCode}`);
      return;
    }
    
    // 3. Criar influenciador associado ao gerente
    console.log('Criando usuário influenciador...');
    const influencer = await User.create({
      ...testInfluencer,
      manager: manager._id
    });
    
    // 4. Atualizar o gerente para incluir o influenciador
    await User.findByIdAndUpdate(manager._id, {
      $addToSet: { influencers: influencer._id }
    });
    
    console.log('Influenciador criado com sucesso!');
    console.log('Detalhes:');
    console.log(`ID: ${influencer._id}`);
    console.log(`Nome: ${influencer.name}`);
    console.log(`Email: ${influencer.email}`);
    console.log(`Cupom: ${influencer.couponCode}`);
    console.log(`Gerente: ${manager.name} (${manager._id})`);
    
    // 5. Enviar mensagem de boas-vindas via WhatsApp (se configurado)
    if (process.env.UAZAPI_TOKEN && influencer.whatsappNumber) {
      try {
        console.log('Enviando mensagem de boas-vindas por WhatsApp...');
        // Criar mensagem de boas-vindas com template simples
        const welcomeMessage = `Olá ${influencer.name}! Bem-vindo ao nosso programa de influenciadores. Seu código de cupom é ${influencer.couponCode || 'CUPOM_NAO_DEFINIDO'}. Use-o para compartilhar com seus seguidores.`;
        
        await sendWelcomeMessage(
          influencer.whatsappNumber,
          welcomeMessage,
          undefined 
        );
        console.log('Mensagem de boas-vindas enviada com sucesso!');
      } catch (error) {
        console.error('Erro ao enviar mensagem de boas-vindas:', error);
      }
    } else {
      console.log('Token da Uazapi não configurado ou número de WhatsApp não fornecido.');
      console.log('Mensagem de boas-vindas não enviada.');
    }
    
  } catch (error) {
    console.error('Erro ao criar usuários de teste:', error);
  }
}

// Executar a criação
async function run() {
  const connected = await connectToDatabase();
  if (connected) {
    await createCommissionTiers();
    await createTestUsers();
    
    // Fechar conexão
    await mongoose.disconnect();
    console.log('Desconectado do MongoDB');
  }
}

run(); 