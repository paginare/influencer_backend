// simulateSaleAndReport.js
require('dotenv').config(); // Carrega variáveis do .env
const axios = require('axios');

// --- Configurações ---
const API_URL = process.env.API_URL || 'http://localhost:3001';
const WEBHOOK_TOKEN = process.env.WEBHOOK_TOKEN; // Token para validar o webhook
const ADMIN_AUTH_TOKEN = process.env.ADMIN_AUTH_TOKEN; // Token JWT de um admin
const COUPON_CODE_TO_TEST = 'antonio10';
// --------------------

if (!WEBHOOK_TOKEN || !ADMIN_AUTH_TOKEN) {
    console.error('ERRO: WEBHOOK_TOKEN e ADMIN_AUTH_TOKEN precisam estar definidos no .env ou no ambiente.');
    process.exit(1);
}

// 1. Função para Simular a Venda via Webhook
async function simulateSale(couponCode) {
    console.log(`\n--- 1. Simulando Venda com Cupom: ${couponCode} ---`);
    const mockShopifyOrder = {
        id: `SIM-${Date.now()}`, // ID único para simulação
        total_price: "250.00", // Valor da venda simulada
        discount_codes: [
            { code: couponCode, amount: "25.00", type: "percentage" }
        ],
        customer: { first_name: "Cliente", last_name: "Simulado", email: `simulado_${Date.now()}@example.com` },
        created_at: new Date().toISOString()
    };

    try {
        const response = await axios.post(
            `${API_URL}/api/webhooks/shopify`,
            mockShopifyOrder,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'webhook-token': WEBHOOK_TOKEN // Header de validação do webhook
                }
            }
        );
        console.log('Resposta do Webhook (/api/webhooks/shopify):', response.status, response.data);
        if (response.data?.processed === false) {
             console.warn('Atenção: Webhook processado, mas a venda pode não ter sido registrada (verifique logs do backend).');
        } else if (response.data?.saleId) {
            console.log(`Venda simulada registrada com ID: ${response.data.saleId}`);
        }
        return true; // Indica sucesso na chamada
    } catch (error) {
        console.error('Erro ao simular venda via webhook:', error.response?.data || error.message);
        return false; // Indica falha
    }
}

// 2. Função para Triggerar Geração de Pagamento (e envio de relatório)
async function triggerCommissionAndReport(startDate, endDate) {
    console.log(`\n--- 2. Triggerando Geração de Pagamento/Relatório para ${startDate.toISOString().split('T')[0]} a ${endDate.toISOString().split('T')[0]} ---`);

    try {
        const response = await axios.post(
            `${API_URL}/api/commissions/generate-payments`,
            {
                startDate: startDate.toISOString(), // Envia como string ISO
                endDate: endDate.toISOString()      // Envia como string ISO
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${ADMIN_AUTH_TOKEN}` // Header de autenticação do Admin
                }
            }
        );
        console.log('Resposta da Geração de Pagamentos (/api/commissions/generate-payments):', response.status, response.data);
        console.log('Relatório de vendas deve ter sido enviado se a comissão foi processada.');
        return true;
    } catch (error) {
        console.error('Erro ao triggerar geração de pagamento/relatório:', error.response?.data || error.message);
        return false;
    }
}

// --- Execução Principal ---
async function runSimulation() {
    const saleSuccess = await simulateSale(COUPON_CODE_TO_TEST);

    if (saleSuccess) {
        console.log('\nVenda simulada com sucesso. Aguardando um pouco antes de gerar relatório...');
        // Pequeno delay para garantir que a venda seja processada no DB antes de gerar o pagamento
        await new Promise(resolve => setTimeout(resolve, 2000)); // Espera 2 segundos

        // Definir período para incluir hoje
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);

        await triggerCommissionAndReport(todayStart, todayEnd);
    } else {
        console.error('\nSimulação da venda falhou. Geração de relatório não será executada.');
    }

    console.log('\n--- Simulação Concluída ---');
}

runSimulation();