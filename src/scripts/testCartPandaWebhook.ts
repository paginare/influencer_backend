/**
 * Script para testar o endpoint de webhook da CartPanda
 * 
 * Este script envia uma requisição de teste para o endpoint do webhook da CartPanda
 * simulando um evento de pagamento de pedido.
 * 
 * Para executar: npx ts-node src/scripts/testCartPandaWebhook.ts
 */

import axios from 'axios';
import dotenv from 'dotenv';

// Carregar variáveis de ambiente
dotenv.config();

// URL do webhook e token de autenticação
const WEBHOOK_URL = process.env.API_URL ? `${process.env.API_URL}/api/webhooks/cartpanda` : 'http://localhost:5000/api/webhooks/cartpanda';
const WEBHOOK_TOKEN = process.env.WEBHOOK_TOKEN || 'seu_token_de_webhook';

// Payload de exemplo da CartPanda (baseado na documentação)
const webhookPayload = {
  event: "order.paid",
  order: {
    id: 34488130,
    shop_id: 131416,
    order_number: "316360",
    number: 316360,
    name: "#316360",
    subtotal_price: 189,
    total_discounts: 28.35,
    total_price: 160.65,
    discount_codes: "antonio10",  // Cupom de influenciador para teste
    email: "cliente@example.com",
    phone: "+5511999999999",
    processed_at: "2025-04-09 15:48:33",
    created_at: "2025-04-09 15:48:33",
    updated_at: "2025-04-09 15:48:45",
    payment_status: 3,
    payment_gateway: "cartpanda_pay",
    payment_type: "cc",
    line_items: [
      {
        id: 40595172,
        order_id: 34488130,
        product_id: 11581669,
        price: 189,
        quantity: 1,
        sku: "1candy1oleo",
        title: "KIT ROSA CANDY COM CLAREADOR ÍNTIMO + ÓLEO",
        vendor: "Rosa Selvagem Brasil"
      }
    ],
    customer: {
      id: 76781449,
      first_name: "Cliente",
      last_name: "Teste",
      email: "cliente@example.com",
      phone: "+5511999999999",
      full_name: "Cliente Teste"
    }
  },
  webhook: {
    id: 1178708,
    endpoint: "https://api.example.com/webhook",
    shop_id: 131416
  }
};

// Função para enviar o webhook
async function sendWebhook() {
  console.log(`Enviando webhook para: ${WEBHOOK_URL}`);
  
  try {
    // Enviar requisição POST para o endpoint do webhook
    const response = await axios.post(WEBHOOK_URL, webhookPayload, {
      headers: {
        'Content-Type': 'application/json',
        'webhook-token': WEBHOOK_TOKEN
      }
    });
    
    // Exibir resposta
    console.log('Resposta:');
    console.log(`Status: ${response.status}`);
    console.log('Dados:');
    console.log(JSON.stringify(response.data, null, 2));
  } catch (error: any) {
    console.error('Erro ao enviar webhook:');
    if (error.response) {
      // O servidor respondeu com um status de erro
      console.error(`Status: ${error.response.status}`);
      console.error('Dados:');
      console.error(JSON.stringify(error.response.data, null, 2));
    } else if (error.request) {
      // A requisição foi feita mas não houve resposta
      console.error('Sem resposta do servidor');
    } else {
      // Ocorreu um erro ao configurar a requisição
      console.error(`Erro: ${error.message}`);
    }
  }
}

// Executar o envio do webhook
sendWebhook(); 