import cron from 'node-cron';
import User, { IUser } from '../models/User';
import Sale from '../models/Sale';
import { sendSalesReport } from '../services/whatsappService';
import { Types } from 'mongoose';

// Função para buscar vendas e calcular totais para um usuário e período
const getUserReportData = async (userId: Types.ObjectId, startDate: Date, endDate: Date) => {
  // Busca vendas para o período completo do relatório
  const periodSales = await Sale.find({
    influencer: userId, 
    createdAt: { $gte: startDate, $lt: endDate },
    commissionCalculated: true, 
  });

  const salesCount = periodSales.length;
  const salesTotal = periodSales.reduce((sum, sale) => sum + sale.saleValue, 0);
  const commission = periodSales.reduce((sum, sale) => sum + (sale.influencerCommissionEarned || 0), 0);

  // Calcular vendas apenas do dia atual (today)
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(); // Agora
  
  const todaySales = await Sale.find({
      influencer: userId,
      createdAt: { $gte: todayStart, $lt: todayEnd }, // Filtro para hoje
      commissionCalculated: true, 
  });
  
  const dailySalesTotal = todaySales.reduce((sum, sale) => sum + sale.saleValue, 0);

  // Retornar todos os dados calculados
  return { salesCount, salesTotal, commission, dailySalesTotal };
};

// Função principal que será executada pelo cron - LÓGICA ATUALIZADA
const sendScheduledReports = async () => {
  console.log(`[${new Date().toISOString()}] Executando tarefa agendada: Verificando relatórios para enviar...`);

  const today = new Date();
  today.setHours(0, 0, 0, 0); // Normaliza para o início do dia para comparações

  try {
    // 1. Buscar usuários que têm notificação de relatório ativa e número de WhatsApp
    const usersToSendReport = await User.find({
      'notifications.report': true,
      whatsappNumber: { $exists: true, $ne: null },
      role: 'influencer' // TODO: Adaptar se managers também recebem relatórios
      // Include the manager field to fetch their token later
    }).select('name whatsappNumber notifications manager');

    console.log(`[${new Date().toISOString()}] Encontrados ${usersToSendReport.length} usuários com relatórios ativos.`);

    for (const user of usersToSendReport) {
      const frequency = user.notifications.reportFrequency; // 'daily', 'weekly', 'bi-weekly', 'monthly'
      const lastSent = user.notifications.lastReportSentAt;
      let shouldSend = false;
      let nextReportDueDate: Date | null = null;
      let reportStartDate: Date | null = null;
      const reportEndDate = new Date(); // Relatório sempre até o momento atual

      // 2. Calcular quando o próximo relatório é devido
      if (!lastSent) {
        // Se nunca foi enviado, enviar hoje (primeiro relatório)
        shouldSend = true;
        // O período será desde o início dos tempos? Ou desde que ativou a notificação?
        // Vamos definir como o início do dia atual para simplificar o primeiro envio.
        reportStartDate = new Date(today);
        console.log(`[${user.name}] Primeiro relatório agendado para hoje.`);
      } else {
        const lastSentDate = new Date(lastSent);
        lastSentDate.setHours(0, 0, 0, 0); // Normaliza para comparação
        nextReportDueDate = new Date(lastSentDate);
        reportStartDate = new Date(lastSentDate); // Período começa após o último envio

        // Adiciona o intervalo da frequência para achar a próxima data
        switch (frequency) {
          case 'daily':
            nextReportDueDate.setDate(lastSentDate.getDate() + 1);
            break;
          case 'weekly':
            nextReportDueDate.setDate(lastSentDate.getDate() + 7);
            break;
          case 'bi-weekly': // Quinzenal
            nextReportDueDate.setDate(lastSentDate.getDate() + 14);
            break;
          case 'monthly':
            nextReportDueDate.setMonth(lastSentDate.getMonth() + 1);
            break;
          default:
            console.warn(`[${user.name}] Frequência de relatório desconhecida: ${frequency}. Pulando.`);
            continue; // Pula para o próximo usuário
        }
        
        // Verifica se a data de hoje é igual ou posterior à data devida
        if (today >= nextReportDueDate) {
          shouldSend = true;
          console.log(`[${user.name}] Relatório ${frequency} devido. Último envio: ${lastSentDate.toISOString()}, Próximo devido: ${nextReportDueDate.toISOString()}, Hoje: ${today.toISOString()}`);
        } else {
           // console.log(`[${user.name}] Relatório ${frequency} ainda não devido. Próximo devido: ${nextReportDueDate.toISOString()}`);
        }
      }

      // 3. Se deve enviar, gerar e enviar o relatório
      if (shouldSend && reportStartDate) {
         const periodLabel = `${reportStartDate.toLocaleDateString()} a ${reportEndDate.toLocaleDateString()}`;
         console.log(`[${user.name}] Preparando relatório ${frequency} para período ${reportStartDate.toISOString()} a ${reportEndDate.toISOString()}`);
        
        try {
          const reportData = await getUserReportData(user._id as Types.ObjectId, reportStartDate, reportEndDate);
          
          // --- Buscar Token, Nome e Template do Manager --- 
          let managerToken: string | undefined = undefined;
          let reportTemplate: string | undefined = undefined;
          let managerName: string = 'seu gestor'; // Default manager name

          if (user.manager) {
              // Fetch manager's token, name, and templates
              const manager = await User.findById(user.manager).select('tokenWhats messageTemplates name email'); 
              if (manager && manager.tokenWhats) {
                  managerToken = manager.tokenWhats;
                  managerName = manager.name; // Store manager name
                  reportTemplate = manager.messageTemplates?.report; // Get custom template if exists
                  console.log(`[${user.name}] Usando token do manager ${manager.email || user.manager}`);
              } else {
                  console.warn(`[${user.name}] Manager ${user.manager} não encontrado ou sem tokenWhats. Relatório não será enviado.`);
                  continue; 
              }
          } else {
               console.warn(`[${user.name}] Influencer não possui manager associado. Relatório não será enviado.`);
               continue; 
          }
          // --- Fim da Busca --- 

          // Definir texto padrão COMPLETO para relatório
          const defaultReportMessage = `Olá {nome}! 📊\n\nAqui está seu relatório de vendas para o período: *{periodo}*\n\nNúmero de vendas: *{vendas}*\nValor total em vendas: *R$ {valorTotal}*\nSua comissão: *R$ {comissao}*\n\nFale com {gestor} se tiver dúvidas.\nBoas vendas! 🚀`;

          // Usar template personalizado se existir, senão usar o padrão
          let reportMessageContent = reportTemplate || defaultReportMessage;

          if (reportTemplate) {
              console.log(`[${user.name}] Usando template de relatório personalizado do manager.`);
          } else {
              console.log(`[${user.name}] Usando template de relatório padrão.`);
          }

          // Substituir variáveis no conteúdo final
          reportMessageContent = reportMessageContent
              .replace(/{nome}/g, user.name)
              .replace(/{periodo}/g, periodLabel)
              .replace(/{vendas}/g, reportData.salesCount.toString())
              .replace(/{valorTotal}/g, reportData.salesTotal.toFixed(2))
              .replace(/{comissao}/g, reportData.commission.toFixed(2))
              .replace(/{valorDiario}/g, reportData.dailySalesTotal.toFixed(2))
              .replace(/{gestor}/g, managerName);

          // Passar APENAS o conteúdo final e o token
          await sendSalesReport(
            user.whatsappNumber!, 
            reportMessageContent, // Conteúdo processado
            managerToken // Token do manager
          );
          console.log(`[${user.name}] Relatório ${frequency} enviado.`);

          // 4. ATUALIZAR a data do último envio no banco!
          await User.updateOne({ _id: user._id }, { $set: { 'notifications.lastReportSentAt': new Date() } });
          console.log(`[${user.name}] Data de último envio atualizada para ${new Date().toISOString()}`);

        } catch (error) {
          console.error(`[${user.name}] Erro ao gerar/enviar relatório:`, error);
        }
      }
    }

    console.log(`[${new Date().toISOString()}] Tarefa agendada de relatórios concluída.`);

  } catch (error) {
    console.error(`[${new Date().toISOString()}] Erro geral na tarefa agendada de relatórios:`, error);
  }
};

// Agendar a tarefa para rodar todos os dias às 02:00 da manhã
// '0 2 * * *'   -> Roda às 02:00 todos os dias
console.log('Configurando agendador de relatórios...');
const scheduledTask = cron.schedule('0 2 * * *', sendScheduledReports, {
  scheduled: true,
  timezone: "America/Sao_Paulo" 
});

console.log(`Agendador de relatórios configurado para rodar diariamente às 02:00 (America/Sao_Paulo).`);

// Export both the task and the function for manual triggering
export { sendScheduledReports, scheduledTask }; 