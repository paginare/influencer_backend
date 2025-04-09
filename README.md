# Influencer Dashboard - Backend

API de gerenciamento para o sistema de influenciadores, incluindo processamento de webhooks, cálculo de comissões e notificações WhatsApp.

## Tecnologias

- Node.js
- Express
- TypeScript
- MongoDB
- Mongoose

## Estrutura do Projeto

- `/config` - Configurações do banco de dados e outras configurações
- `/controllers` - Controladores para as rotas da API
- `/middlewares` - Middlewares para autenticação, validação, etc.
- `/models` - Modelos do Mongoose
- `/routes` - Rotas da API
- `/scripts` - Scripts utilitários
- `/services` - Serviços para lógica de negócios
- `/utils` - Funções utilitárias

## Endpoints principais

- `/api/auth` - Autenticação e gerenciamento de usuários
- `/api/webhooks` - Recebimento de webhooks de plataformas externas (Shopify, CartPanda)
- `/api/dashboard` - Dados para o dashboard
- `/api/commissions` - Gerenciamento de comissões

## Funcionalidades

- Processamento de webhooks (Shopify, CartPanda)
- Cálculo de comissões para influenciadores e gerentes
- Envio de notificações WhatsApp para vendas, relatórios, etc.
- Gerenciamento de usuários (influenciadores, gerentes, admins)
- API para dashboard de análise de vendas

## Instalação

```bash
# Instalar dependências
npm install

# Configurar variáveis de ambiente
# Crie um arquivo .env baseado no .env.example

# Executar em modo de desenvolvimento
npm run dev

# Compilar TypeScript
npm run build

# Executar versão compilada
npm start
```

## Webhooks

O sistema suporta webhooks das seguintes plataformas:
- Shopify: `/api/webhooks/shopify`
- CartPanda: `/api/webhooks/cartpanda`
- Webhook genérico: `/api/webhooks/sale` 