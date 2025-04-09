import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

// URL e Token padrão/fallback das variáveis de ambiente
const DEFAULT_UAZAPI_BASE_URL = process.env.UAZAPI_URL || 'https://rs-aml.uazapi.com'; // Usar a URL correta
const FALLBACK_UAZAPI_TOKEN = process.env.UAZAPI_TOKEN; // Pode ser um token global ou de admin

/**
 * Envia uma mensagem de texto via WhatsApp usando um token e URL específicos.
 * @param to Número do destinatário
 * @param message Texto da mensagem
 * @param apiToken Token da instância UAZapi a ser usada
 * @param baseUrl URL base da API UAZapi a ser usada (opcional, usa fallback se não fornecido)
 * @returns objeto de resposta da API
 */
const sendTextMessage = async (
    to: string, 
    message: string, 
    apiToken: string | undefined, // Tornar token obrigatório ou com fallback claro
    baseUrl: string = DEFAULT_UAZAPI_BASE_URL // Usar a URL correta como padrão
) => {

  const tokenToSend = apiToken || FALLBACK_UAZAPI_TOKEN;

  if (!tokenToSend) {
      console.error('ERRO: Nenhum token UAZapi (específico ou fallback) disponível para enviar mensagem.');
      throw new Error('Configuração de token UAZapi ausente.');
  }
  if (!to || !message) {
    throw new Error('Destinatário e mensagem são obrigatórios');
  }

  try {
    const formattedNumber = to.replace(/\D/g, '');

    console.log(`[sendTextMessage] Enviando para: ${formattedNumber} via ${baseUrl} com token: ${tokenToSend ? '***' : 'N/A'}`);

    // Cria o cliente axios dinamicamente com o token e URL corretos
    // Corrigir endpoint para /send/text e simplificar payload
    const response = await axios.post(`${baseUrl}/send/text`, 
      {
          number: formattedNumber,
          text: message // Enviar o texto diretamente
      },
      {
          headers: {
              'token': tokenToSend,
              'Content-Type': 'application/json',
              'Accept': 'application/json' // Adicionar Accept header
          }
      }
    );
    
    console.log(`[sendTextMessage] Resposta da UAZapi para ${formattedNumber}:`, response.status, response.data);
    return response.data;
  } catch (error: any) {
    console.error(`Erro ao enviar mensagem WhatsApp para ${to} via ${baseUrl}:`, error.response?.data || error.message);
    // Re-lança o erro para que o chamador possa tratá-lo
    throw error; 
  }
};

/**
 * Envia uma mensagem de boas-vindas para um novo influenciador
 * @param to Número do WhatsApp do influenciador
 * @param name Nome do influenciador
 * @param couponCode Código do cupom do influenciador
 */
const sendWelcomeMessage = async (
  to: string, 
  messageContent: string, // <-- Receber conteúdo como parâmetro
  apiToken: string | undefined
) => {
  // Apenas chama sendTextMessage com o conteúdo fornecido
  return sendTextMessage(to, messageContent, apiToken);
};

/**
 * Envia um relatório de vendas para o influenciador
 * @param to Número do WhatsApp do influenciador
 * @param name Nome do influenciador
 * @param period Período do relatório (ex: "14/06/2023 a 21/06/2023")
 * @param salesCount Número de vendas no período
 * @param salesTotal Valor total das vendas no período
 * @param commission Valor total da comissão no período
 */
const sendSalesReport = async (
  to: string, 
  messageContent: string, // <-- Receber conteúdo como parâmetro
  apiToken: string | undefined 
) => {
  // Apenas chama sendTextMessage com o conteúdo fornecido
  return sendTextMessage(to, messageContent, apiToken);
};

/**
 * Envia notificação de nova venda para o influenciador
 * @param to Número do WhatsApp do influenciador
 * @param name Nome do influenciador
 * @param saleValue Valor da venda
 * @param estimatedCommission Comissão estimada
 */
const sendNewSaleNotification = async (
  to: string, 
  messageContent: string, // <-- Receber conteúdo como parâmetro
  apiToken: string | undefined
) => {
  // Apenas chama sendTextMessage com o conteúdo fornecido
  return sendTextMessage(to, messageContent, apiToken);
};

// Exports permanecem os mesmos
export { 
  sendTextMessage, 
  sendWelcomeMessage, 
  sendSalesReport, 
  sendNewSaleNotification 
};