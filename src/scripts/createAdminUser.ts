/**
 * Script para criar um usuário administrador inicial
 * 
 * Este script cria um usuário administrador no sistema para permitir o primeiro acesso.
 * 
 * Para executar: npx ts-node src/scripts/createAdminUser.ts
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User, { UserRole } from '../models/User';

// Carregar variáveis de ambiente
dotenv.config();

// Configurações do administrador
const adminUser = {
  name: 'Administrador',
  email: 'admin@example.com',
  password: 'admin123', // Em ambiente de produção, use uma senha forte
  role: UserRole.ADMIN,
  whatsappNumber: '5511999999999' // Opcional
};

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

// Criar usuário administrador
async function createAdminUser() {
  try {
    // Verificar se já existe um admin
    const existingAdmin = await User.findOne({ role: UserRole.ADMIN });
    
    if (existingAdmin) {
      console.log('Um administrador já existe no sistema:');
      console.log(`Nome: ${existingAdmin.name}`);
      console.log(`Email: ${existingAdmin.email}`);
      return;
    }
    
    // Criar novo administrador
    console.log('Criando usuário administrador...');
    const admin = await User.create(adminUser);
    
    console.log('Administrador criado com sucesso!');
    console.log('Detalhes:');
    console.log(`ID: ${admin._id}`);
    console.log(`Nome: ${admin.name}`);
    console.log(`Email: ${admin.email}`);
    console.log(`Senha: ${adminUser.password} (altere após o primeiro login)`);
    
  } catch (error) {
    console.error('Erro ao criar administrador:', error);
  } finally {
    // Fechar conexão
    await mongoose.disconnect();
    console.log('Desconectado do MongoDB');
  }
}

// Executar a criação do administrador
async function run() {
  const connected = await connectToDatabase();
  if (connected) {
    await createAdminUser();
  }
}

run(); 