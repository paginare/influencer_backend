import { Response } from 'express';
import asyncHandler from '../utils/asyncHandler';
import { AuthRequest } from '../middlewares/authMiddleware';
import User from '../models/User';
import axios from 'axios'; // Usaremos axios para a requisição externa

// @desc    Obter o status da conexão WhatsApp (verifica se token existe)
// @route   GET /api/whatsapp/status
// @access  Private/Manager
const getWhatsappStatus = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = req.user?._id;
    
    // Buscar apenas o campo tokenWhats para o usuário logado
    const user = await User.findById(userId).select('tokenWhats');

    if (!user) {
        res.status(404); throw new Error('Usuário não encontrado');
    }

    res.json({ 
        hasToken: !!user.tokenWhats, // Retorna true se o token existe
        token: user.tokenWhats || null 
    });
});

// @desc    Iniciar uma nova instância WhatsApp via UAZapi
// @route   POST /api/whatsapp/initiate
// @access  Private/Manager
const initiateWhatsappInstance = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = req.user?._id;

    // Buscar usuário com whatsappNumber
    const user = await User.findById(userId).select('tokenWhats whatsappNumber');
    if (!user) {
        res.status(404); throw new Error('Usuário não encontrado');
    }
    // Verificar se o manager tem número cadastrado
    if (!user.whatsappNumber) {
        res.status(400);
        throw new Error('Número de WhatsApp não cadastrado para este manager. Atualize seu perfil.');
    }

    if (user.tokenWhats) {
        // TODO: Em vez de erro, talvez chamar /instance/connect aqui se já tiver token?
        // Por agora, mantemos o erro para fluxo inicial.
        res.status(400).json({ /* ... */ });
        return;
    }
    
    const adminToken = process.env.ADMIN_TOKEN_UAZAPI;
    if (!adminToken) { /* ... erro token admin */ }

    const instanceName = `user_${userId}`;
    const uazapiBaseUrl = process.env.UAZAPI_URL || 'https://rs-aml.uazapi.com';
    const initUrl = `${uazapiBaseUrl}/instance/init`;
    const connectUrl = `${uazapiBaseUrl}/instance/connect`; // URL para segunda chamada
    const initPayload = { name: instanceName, systemName: 'notificacoes' };

    try {
        // --- Primeira Chamada: /instance/init --- 
        console.log(`Iniciando instância UAZapi: POST ${initUrl} com nome ${instanceName}`);
        const response1 = await axios.post(initUrl, initPayload, {
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'admintoken': adminToken
            }
        });
        console.log('Resposta da UAZapi (/init):', response1.data);

        if (!response1.data || !response1.data.token) { 
             console.error('Resposta inesperada ou faltando token de /init:', response1.data);
             throw new Error('Falha ao iniciar instância: resposta inicial inválida.');
        }
        
        const apiToken = response1.data.token; // Token da instância criada

        // --- Segunda Chamada: /instance/connect --- 
        console.log(`Solicitando conexão UAZapi: POST ${connectUrl} para token ${apiToken}`);
        const response2 = await axios.post(connectUrl, null, {
             headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'token': apiToken 
            }
        });
        console.log('Resposta da UAZapi (/connect):', response2.data);

        // Verificar a resposta da segunda chamada pelo QR Code
        // O QR code está dentro de response.data.instance.qrcode
        if (!response2.data || !response2.data.instance?.qrcode) {
            console.error('Resposta inesperada ou faltando instance.qrcode de /connect:', response2.data);
            throw new Error('Falha ao obter QR Code: resposta da segunda chamada inválida ou sem instance.qrcode.');
        }

        const qrCode = response2.data.instance.qrcode; // <-- CORRIGIDO: Pegar de instance.qrcode
            
        // Salvar o TOKEN (da primeira chamada) no usuário
        user.tokenWhats = apiToken;
        await user.save();
            
        console.log(`Token UAZapi ${apiToken} salvo para o usuário ${userId}`);
            
        res.status(201).json({ 
            message: 'Instância iniciada! Escaneie o QR Code.',
            hasToken: true,
            token: apiToken, 
            qrCode: qrCode
        });

    } catch (error: any) {
        console.error('Erro durante processo UAZapi:', error.response?.data || error.message);
        res.status(error.response?.status || 500);
        throw new Error(error.response?.data?.message || 'Erro ao comunicar com a API do WhatsApp.');
    }
});

// @desc    Conectar instância existente e obter QR code
// @route   POST /api/whatsapp/connect
// @access  Private/Manager
const connectWhatsappInstance = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = req.user?._id;
    
    const user = await User.findById(userId).select('tokenWhats whatsappNumber');
    if (!user) {
        res.status(404); throw new Error('Usuário não encontrado');
    }
    if (!user.tokenWhats) {
        res.status(400); throw new Error('Nenhuma instância WhatsApp iniciada para este usuário.');
    }
    if (!user.whatsappNumber) {
         res.status(400);
         throw new Error('Número de WhatsApp não cadastrado para este manager.');
     }

    const apiToken = user.tokenWhats;
    const uazapiBaseUrl = process.env.UAZAPI_URL || 'https://rs-aml.uazapi.com';
    const connectUrl = `${uazapiBaseUrl}/instance/connect`;
    // const connectPayload = { phone: user.whatsappNumber }; // Removido conforme instrução anterior

    try {
        console.log(`Solicitando conexão UAZapi: POST ${connectUrl} para token ${apiToken}`);
        const response = await axios.post(connectUrl, null, { // Corpo é null
             headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'token': apiToken 
            }
        });
        console.log('Resposta da UAZapi (/connect):', response.data);

        if (!response.data || !response.data.instance?.qrcode) {
            console.error('Resposta inesperada ou faltando instance.qrcode de /connect:', response.data);
            throw new Error('Falha ao obter QR Code: resposta da API inválida.');
        }

        const qrCode = response.data.instance.qrcode;
            
        res.status(200).json({ 
            message: 'QR Code obtido com sucesso!',
            success: true,
            qrCode: qrCode,
            token: apiToken // Retorna o token também para consistência
        });

    } catch (error: any) {
        console.error('Erro durante conexão UAZapi:', error.response?.data || error.message);
        res.status(error.response?.status || 500);
        // Não lançar erro aqui, retornar falha no JSON
        res.json({ 
            success: false,
            message: error.response?.data?.message || 'Erro ao comunicar com a API do WhatsApp.'
        });
    }
});

// @desc    Obter status detalhado de uma instância existente
// @route   GET /api/whatsapp/detailed-status
// @access  Private/Manager
const getDetailedWhatsappStatus = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = req.user?._id;
    
    // Buscar token do usuário
    const user = await User.findById(userId).select('tokenWhats');
    if (!user || !user.tokenWhats) {
        res.status(400); throw new Error('Nenhuma instância WhatsApp iniciada para este usuário.');
    }

    const apiToken = user.tokenWhats;
    const uazapiBaseUrl = process.env.UAZAPI_URL || 'https://rs-aml.uazapi.com';
    const statusUrl = `${uazapiBaseUrl}/instance/status`;

    try {
        console.log(`Buscando status UAZapi: GET ${statusUrl} para token ${apiToken}`);
        const response = await axios.get(statusUrl, { 
             headers: {
                'Accept': 'application/json',
                'token': apiToken 
            }
        });
        console.log('Resposta da UAZapi (/status):', response.data);

        // Extrair dados relevantes da resposta conforme a estrutura fornecida
        const instanceStatus = response.data?.instance?.status; // "connected", "connecting", etc.
        const isLoggedIn = response.data?.status?.loggedIn; // true/false
        // QR code também está dentro de instance
        const qrCode = response.data?.instance?.qrcode; 
            
        res.status(200).json({ 
            success: true,
            status: instanceStatus, // Passar o status da instância
            loggedIn: isLoggedIn, // Passar o status de login
            qrCode: qrCode || null // Passar QR code se existir
        });

    } catch (error: any) {
        console.error('Erro ao buscar status UAZapi:', error.response?.data || error.message);
        res.status(error.response?.status || 500);
        res.json({ 
            success: false,
            message: error.response?.data?.message || 'Erro ao comunicar com a API do WhatsApp para obter status.'
        });
    }
});

// @desc    Desconectar instância WhatsApp
// @route   POST /api/whatsapp/disconnect
// @access  Private/Manager
const disconnectWhatsappInstance = asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = req.user?._id;
    
    console.log(`[DISCONNECT] Iniciando processo de desconexão para usuário ${userId}`);
    
    // Buscar token do usuário
    const user = await User.findById(userId).select('tokenWhats');
    if (!user) {
        console.log(`[DISCONNECT] Usuário ${userId} não encontrado`);
        res.status(404); throw new Error('Usuário não encontrado');
    }
    
    if (!user.tokenWhats) {
        console.log(`[DISCONNECT] Usuário ${userId} não tem tokenWhats`);
        res.status(400); throw new Error('Nenhuma instância WhatsApp encontrada para este usuário.');
    }

    const apiToken = user.tokenWhats;
    console.log(`[DISCONNECT] Token do usuário: ${apiToken.substring(0, 10)}...`);
    
    const uazapiBaseUrl = process.env.UAZAPI_URL || 'https://rs-aml.uazapi.com';
    const disconnectUrl = `${uazapiBaseUrl}/instance/disconnect`;
    console.log(`[DISCONNECT] URL da API externa: ${disconnectUrl}`);

    try {
        console.log(`[DISCONNECT] Enviando request para desconectar instância...`);
        
        // Tentativa com uma abordagem mais simples usando apenas axios
        try {
            console.log(`[DISCONNECT] Tentando chamar API com axios simples`);
            const axiosResponse = await axios({
                method: 'post',
                url: disconnectUrl,
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'token': apiToken
                },
                validateStatus: () => true // Não lançar erro para qualquer status
            });
            
            console.log(`[DISCONNECT] Resposta axios: status=${axiosResponse.status}, contentType=${axiosResponse.headers['content-type']}`);
            
            if (axiosResponse.headers['content-type']?.includes('application/json')) {
                console.log(`[DISCONNECT] Corpo da resposta JSON:`, axiosResponse.data);
            } else {
                // Se não for JSON, log apenas uma parte para depuração
                const responseText = typeof axiosResponse.data === 'string' 
                    ? axiosResponse.data.substring(0, 100) 
                    : JSON.stringify(axiosResponse.data).substring(0, 100);
                console.log(`[DISCONNECT] Corpo da resposta (não-JSON): ${responseText}...`);
            }
            
        } catch (axiosError: any) {
            console.error(`[DISCONNECT] Erro ao tentar chamar API com axios:`, axiosError.message);
        }
        
        // Independentemente do resultado da API externa, realizamos a desconexão local
        console.log(`[DISCONNECT] Removendo token do usuário...`);
        user.tokenWhats = undefined;
        await user.save();
        console.log(`[DISCONNECT] Token removido do usuário ${userId}`);
            
        res.status(200).json({ 
            success: true,
            message: 'Instância WhatsApp desconectada localmente com sucesso'
        });

    } catch (error: any) {
        console.error(`[DISCONNECT] Erro geral no processo:`, error.message);
        
        // Sempre remover o token do usuário mesmo em caso de erro
        if (user.tokenWhats) {
            console.log(`[DISCONNECT] Removendo token do usuário após erro...`);
            user.tokenWhats = undefined;
            await user.save();
            console.log(`[DISCONNECT] Token removido do usuário ${userId} após erro`);
        }
        
        res.status(500).json({ 
            success: false,
            message: 'Erro ao comunicar com a API do WhatsApp, mas instância foi desconectada localmente.'
        });
    }
});

export {
    getWhatsappStatus,
    initiateWhatsappInstance,
    connectWhatsappInstance,
    getDetailedWhatsappStatus,
    disconnectWhatsappInstance
}; 