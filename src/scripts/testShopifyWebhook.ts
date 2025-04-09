/**
 * Script para testar o webhook da Shopify
 * 
 * Este script simula uma requisição de webhook da Shopify para testar a funcionalidade
 * de processamento de vendas e comissões sem precisar configurar uma loja Shopify real.
 * 
 * Para executar: npx ts-node src/scripts/testShopifyWebhook.ts
 */

import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

// Configurações
const API_URL = process.env.API_URL || 'http://localhost:3001';
const WEBHOOK_TOKEN = process.env.WEBHOOK_TOKEN || 'YOUR_WEBHOOK_SECRET_TOKEN_HERE';
const COUPON_CODE = process.argv[2] || 'TESTE10'; // Você pode passar o cupom como argumento ou usar o padrão

// Dados simulados de um pedido da Shopify
const mockShopifyOrder = {
  id: `TEST-${Date.now()}`,
  total_price: "150.00",
  discount_codes: [
    {
      code: COUPON_CODE,
      amount: "15.00",
      type: "percentage"
    }
  ],
  customer: {
    first_name: "Cliente",
    last_name: "Teste",
    email: "cliente.teste@example.com"
  },
  line_items: [
    {
      title: "Produto de Teste",
      quantity: 1,
      price: "150.00"
    }
  ],
  created_at: new Date().toISOString()
};

// Função para enviar a requisição de teste
async function sendTestWebhook() {
  try {
    console.log(`Enviando webhook de teste com cupom: ${COUPON_CODE}`);
    
    const response = await axios.post(
      `${API_URL}/api/webhooks/shopify`, 
      mockShopifyOrder,
      {
        headers: {
          'Content-Type': 'application/json',
          'webhook-token': WEBHOOK_TOKEN
        }
      }
    );
    
    console.log('Resposta do servidor:');
    console.log(JSON.stringify(response.data, null, 2));
    
    if (response.data.processed === false) {
      console.log('\nATENÇÃO: A venda não foi processada. Verifique se:');
      console.log('1. O código do cupom existe no sistema');
      console.log('2. O cupom está associado a um influenciador');
    } else if (response.data.saleId) {
      console.log('\nSucesso! A venda foi registrada com ID:', response.data.saleId);
      console.log(`Comissão do influenciador: R$ ${response.data.influencerCommission.toFixed(2)}`);
      if (response.data.managerCommission > 0) {
        console.log(`Comissão do gestor: R$ ${response.data.managerCommission.toFixed(2)}`);
      }
    }
    
  } catch (error: any) {
    console.error('Erro ao enviar webhook de teste:');
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.error('Resposta:', error.response.data);
    } else if (error.request) {
      console.error('Nenhuma resposta recebida. O servidor está rodando?');
      console.error(error.message);
    } else {
      console.error('Erro na configuração da requisição:', error.message);
    }
    console.error('Erro completo:', error);
  }
}

// Executar o teste
sendTestWebhook(); 