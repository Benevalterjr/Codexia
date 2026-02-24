/**
 * 🤖 OpenAI Chat — Terminal interativo com Device Code Auth
 * 
 * Usa chatgpt.com/backend-api/codex/responses — o mesmo endpoint
 * que o Codex CLI usa quando autenticado via ChatGPT OAuth.
 * Funciona com contas ChatGPT (Plus/Pro/Team etc).
 * 
 * Uso: node chat.js
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const yaml = require('js-yaml');
const crypto = require('crypto');

// ─────────────────────── CONFIG ───────────────────────
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const BASE_URL = 'https://auth.openai.com';
const API_BASE_URL = `${BASE_URL}/api/accounts`;

// O Codex CLI usa este endpoint quando autenticado via ChatGPT OAuth
// (em vez de api.openai.com/v1 que requer API key ou scopes especiais)
const CODEX_API = 'https://chatgpt.com/backend-api/codex';

const TOKEN_FILE = path.join(__dirname, 'openai_tokens.json');
const SESSION_FILE = path.join(__dirname, 'openai_session.json');
const MAX_WAIT_MS = 15 * 60 * 1000;

const DEFAULT_MODEL = 'gpt-5.1-codex'; // PADRÃO: O mais estável para contas Free no Codex

// ────────────────────── STATE ────────────────────────
let lastResponseId = null;
let currentModel = DEFAULT_MODEL;
let conversationHistory = []; // Para modelos Codex que não suportam previous_response_id

// ───────────────────── FORMATAÇÃO ─────────────────────
const C = {
    cyan:    '\x1b[96m',
    green:   '\x1b[92m',
    yellow:  '\x1b[93m',
    red:     '\x1b[91m',
    white:   '\x1b[97m',
    magenta: '\x1b[95m',
    dim:     '\x1b[2m',
    bold:    '\x1b[1m',
    reset:   '\x1b[0m',
};

// ═══════════════════════════════════════════════════════
//  AUTH — Gestão de Tokens
// ═══════════════════════════════════════════════════════

function loadTokens() {
    if (!fs.existsSync(TOKEN_FILE)) return null;
    try {
        return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8'));
    } catch {
        return null;
    }
}

function saveTokens(tokens, expiresIn) {
    const data = {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || null,
        id_token: tokens.id_token || null,
        expires_at: Date.now() + ((expiresIn || tokens.expires_in || 864000) * 1000),
        obtained_at: new Date().toISOString(),
        method: 'device_code_flow'
    };
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(data, null, 2));
    return data;
}

function isTokenExpired(tokens) {
    if (!tokens || !tokens.expires_at) return true;
    return Date.now() > (tokens.expires_at - 5 * 60 * 1000);
}

// ──────────────── REFRESH TOKEN ───────────────────────
async function refreshAccessToken(refreshToken) {
    console.log(`\n${C.yellow}🔄 Token expirado. A renovar...${C.reset}`);
    
    try {
        const response = await fetch(`${BASE_URL}/oauth/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                client_id: CLIENT_ID,
                refresh_token: refreshToken,
            }).toString()
        });

        if (!response.ok) {
            console.error(`${C.red}✗ Falha no refresh: ${response.status}${C.reset}`);
            return null;
        }

        const data = await response.json();
        const saved = saveTokens(data, data.expires_in);
        console.log(`${C.green}✓ Token renovado! Expira: ${new Date(saved.expires_at).toLocaleString('pt-BR')}${C.reset}\n`);
        return saved;
    } catch (err) {
        console.error(`${C.red}✗ Erro no refresh: ${err.message}${C.reset}`);
        return null;
    }
}

// ──────────────── DEVICE CODE FLOW ────────────────────
async function deviceCodeAuth() {
    console.log(`\n${C.bold}[Auth]${C.reset} A iniciar Device Code Flow...\n`);
    
    const ucResp = await fetch(`${API_BASE_URL}/deviceauth/usercode`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'openai-chat-cli/1.0.0',
            'Accept': 'application/json'
        },
        body: JSON.stringify({ 
            client_id: CLIENT_ID,
            scope: 'openid profile email offline_access api.responses.write',
            audience: 'https://api.openai.com/v1'
        })
    });

    if (!ucResp.ok) {
        const text = await ucResp.text();
        console.error(`${C.red}✗ Falha: ${ucResp.status} — ${text}${C.reset}`);
        if (ucResp.status === 404) {
            console.error(`${C.yellow}⚠ Ative "Device Code Login" em: https://chatgpt.com/settings → Segurança${C.reset}`);
        }
        return null;
    }

    const ucData = await ucResp.json();
    const userCode = ucData.user_code || ucData.usercode;
    const interval = typeof ucData.interval === 'string' ? parseInt(ucData.interval, 10) : (ucData.interval || 5);
    
    console.log(`╭──────────────────────────────────────────────╮`);
    console.log(`│  ${C.bold}1.${C.reset} Abra: ${C.cyan}https://auth.openai.com/codex/device${C.reset}  │`);
    console.log(`│  ${C.bold}2.${C.reset} Código: ${C.bold}${C.yellow}${userCode}${C.reset}                           │`);
    console.log(`│  ${C.dim}Expira em 15 minutos.${C.reset}                       │`);
    console.log(`╰──────────────────────────────────────────────╯\n`);
    
    process.stdout.write(`${C.dim}  À espera de autorização...`);
    const startTime = Date.now();
    
    while (Date.now() - startTime < MAX_WAIT_MS) {
        await new Promise(r => setTimeout(r, interval * 1000));
        
        try {
            const pollResp = await fetch(`${API_BASE_URL}/deviceauth/token`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'openai-chat-cli/1.0.0',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    device_auth_id: ucData.device_auth_id,
                    user_code: userCode
                })
            });
            
            if (pollResp.ok) {
                const codeData = await pollResp.json();
                console.log(`${C.reset}\n${C.green}✓ Autorizado!${C.reset}`);
                
                const tokenResp = await fetch(`${BASE_URL}/oauth/token`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({
                        grant_type: 'authorization_code',
                        client_id: CLIENT_ID,
                        code: codeData.authorization_code,
                        code_verifier: codeData.code_verifier,
                        redirect_uri: `${BASE_URL}/deviceauth/callback`
                    }).toString()
                });
                
                if (!tokenResp.ok) {
                    console.error(`${C.red}✗ Troca falhou: ${tokenResp.status}${C.reset}`);
                    return null;
                }
                
                const tokens = await tokenResp.json();
                const saved = saveTokens(tokens, tokens.expires_in);
                console.log(`${C.green}✓ Tokens salvos! Expira: ${new Date(saved.expires_at).toLocaleString('pt-BR')}${C.reset}\n`);
                return saved;
            }
            
            if (pollResp.status === 403 || pollResp.status === 404) {
                process.stdout.write('.');
                continue;
            }
            
            console.error(`\n${C.red}✗ Erro: ${pollResp.status}${C.reset}`);
            return null;
        } catch {
            process.stdout.write('!');
        }
    }
    
    console.error(`\n${C.red}✗ Timeout (15 min).${C.reset}`);
    return null;
}

// ──────────────── OBTER TOKEN VÁLIDO ──────────────────
async function ensureValidToken() {
    let tokens = loadTokens();
    
    if (tokens && !isTokenExpired(tokens)) {
        const expDate = new Date(tokens.expires_at).toLocaleString('pt-BR');
        console.log(`${C.green}✓ Token válido ${C.dim}(expira: ${expDate})${C.reset}`);
        return tokens.access_token;
    }
    
    if (tokens && tokens.refresh_token) {
        const refreshed = await refreshAccessToken(tokens.refresh_token);
        if (refreshed) return refreshed.access_token;
    }
    
    console.log(`${C.yellow}⚠ Sem token válido. Necessário autenticar.${C.reset}`);
    const newTokens = await deviceCodeAuth();
    if (!newTokens) {
        console.error(`${C.red}✗ Autenticação falhou. Encerrando.${C.reset}`);
        process.exit(1);
    }
    return newTokens.access_token;
}

// ───────────────────── PERSISTÊNCIA ─────────────────────

// ═══════════════════════════════════════════════════════
//  CHAT — Responses API via Codex endpoint
//  (chatgpt.com/backend-api/codex/responses)
// ═══════════════════════════════════════════════════════

// Auxiliar para carregar a sessão anterior
function loadSession() {
    try {
        if (!fs.existsSync(SESSION_FILE)) return;
        const data = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
        conversationHistory = data.conversationHistory || [];
        lastResponseId = data.lastResponseId || null;
        currentModel = data.currentModel || currentModel;
        console.log(`${C.dim}✓ Sessão anterior carregada.${C.reset}`);
    } catch (err) {
        console.log(`${C.yellow}⚠ Erro ao carregar sessão. Iniciando nova.${C.reset}`);
    }
}

// Auxiliar para salvar a sessão atual
function saveSession() {
    try {
        const data = { currentModel, lastResponseId, conversationHistory };
        fs.writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
        console.log(`${C.yellow}⚠ Erro ao salvar sessão.${C.reset}`);
    }
}

// Auxiliar para atualizar o estado global após uma resposta
function updateState(userMsg, aiText, responseId) {
    if (responseId) lastResponseId = responseId;
    
    // Formato Codex exige histórico manual para contexto
    const isCodex = currentModel.endsWith('-codex') || currentModel.startsWith('codex');
    if (isCodex && aiText) {
        conversationHistory.push({
            role: "user",
            content: [{ type: "input_text", text: userMsg }]
        });
        conversationHistory.push({
            role: "assistant",
            content: [{ type: "output_text", text: aiText }]
        });
        
        // Limite de histórico para evitar payloads saturados (40 msgs = 20 turns)
        if (conversationHistory.length > 40) {
            conversationHistory = conversationHistory.slice(-40);
        }
    }
    
    saveSession();
}

/**
 * Constrói o prompt estruturado a partir do YAML
 */
function buildAutomationPrompt(config) {
    const context = config.context?.description || "";
    const objective = config.objective?.description || "";
    const style = config.style ? `
Estilo:
- Verbosidade: ${config.style.verbosity || "normal"}
- Foco: ${config.style.foco || ""}
- Linguagem: ${config.style.linguagem || ""}
` : "";

    const quality = (config.quality?.criteria || []).length > 0 
        ? `\nCritérios de Qualidade:\n${config.quality.criteria.map(c => `- ${c}`).join('\n')}`
        : "";

    return `
${context}

Objetivo:
${objective}
${style}${quality}
`.trim();
}

/**
 * Executa uma automação baseada em arquivo YAML
 */
async function executeAutomation(accessToken, fileName, inject = false) {
    try {
        const automationsDir = path.join(__dirname, 'automations');
        const filePath = path.join(automationsDir, fileName.endsWith('.yaml') ? fileName : `${fileName}.yaml`);

        if (!fs.existsSync(filePath)) {
            console.log(`${C.red}✗ Arquivo não encontrado: ${filePath}${C.reset}`);
            return;
        }

        const raw = fs.readFileSync(filePath, 'utf-8');
        const config = yaml.load(raw);
        const automationPrompt = buildAutomationPrompt(config);
        const targetModel = config.model?.name || currentModel;

        console.log(`\n${C.magenta}🚀 Executando Automação: ${C.bold}${config.meta?.name || fileName}${C.reset}`);
        console.log(`${C.dim}Modelo: ${targetModel} | Injeção: ${inject ? "SIM" : "NÃO"}${C.reset}\n`);

        // Executa a chamada
        const result = await sendMessage(accessToken, automationPrompt, inject ? lastResponseId : null, targetModel);
        
        if (result.error) {
            console.error(`${C.red}✗ Erro na automação: ${result.message}${C.reset}`);
            return result;
        }

        // PROBLEMA 1 RESOLVIDO: Consumir o stream e exibir em tempo real
        if (result.stream) {
            const resp = await streamResponse(result.stream);
            
            // PROBLEMA 3 RESOLVIDO: Injetar no histórico apenas se solicitado
            if (inject) {
                updateState(
                    `[AUTOMATION:${fileName}]`, 
                    resp.text, 
                    resp.responseId
                );
            }
            return resp;
        }

        return result; 
    } catch (err) {
        console.error(`${C.red}✗ Erro ao processar automação: ${err.message}${C.reset}`);
    }
}

async function sendMessage(accessToken, userMessage, previousResponseId, model) {
    const isCodex = model.endsWith('-codex') || model.startsWith('codex');
    const defaultInstructions = "Você é um assistente de terminal útil e amigável. Responda de forma clara e direta.";

    const body = {
        model: model,
        instructions: defaultInstructions, // Valor padrão obrigatório para validação da API
        stream: true,
    };

    if (isCodex) {
        // Codex ignora semanticamente o campo raiz 'instructions', mas a API exige que ele EXISTA.
        // O comportamento real é controlado injetando uma mensagem de 'system' no input.
        const fullInput = [
            {
                role: "system",
                content: [{ type: "input_text", text: defaultInstructions }]
            },
            ...conversationHistory,
            {
                role: "user",
                content: [{ type: "input_text", text: userMessage }]
            }
        ];
        body.input = fullInput;
        body.store = false; 
    } else {
        body.input = userMessage; 
        if (previousResponseId) {
            body.previous_response_id = previousResponseId;
        }
    }

    const response = await fetch(`${CODEX_API}/responses`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
            'User-Agent': 'openai-codex-cli/1.0.0',
            'Accept': 'text/event-stream',
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const text = await response.text();
        
        if (response.status === 401) {
            return { error: 'token_expired', message: text };
        }
        
        return { error: 'api_error', status: response.status, message: text };
    }

    return { stream: response.body };
}

async function streamResponse(stream) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let fullResponse = '';
    let buffer = '';
    let responseId = null;
    
    process.stdout.write(`\n${C.cyan}${C.bold}AI ▸${C.reset} `);
    
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            buffer += decoder.decode(value, { stream: true });
            
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6).trim();
                    if (data === '[DONE]') continue;
                    
                    try {
                        const parsed = JSON.parse(data);
                        
                        // Captura o response_id para manter contexto
                        if (parsed.response?.id) {
                            responseId = parsed.response.id;
                        }
                        if (parsed.id && parsed.id.startsWith('resp_')) {
                            responseId = parsed.id;
                        }
                        
                        // response.output_text.delta — texto incremental
                        if (parsed.type === 'response.output_text.delta') {
                            const delta = parsed.delta || '';
                            process.stdout.write(delta);
                            fullResponse += delta;
                        }
                        
                        // Formato alternativo de delta
                        if (parsed.delta && typeof parsed.delta === 'string' && !parsed.type) {
                            process.stdout.write(parsed.delta);
                            fullResponse += parsed.delta;
                        }
                        
                        // Erro na resposta
                        if (parsed.type === 'error') {
                            console.error(`\n${C.red}✗ Erro: ${parsed.error?.message || JSON.stringify(parsed)}${C.reset}`);
                        }

                        // response.completed — fim da resposta
                        if (parsed.type === 'response.completed') {
                            if (parsed.response?.id) {
                                responseId = parsed.response.id;
                            }
                            // Fallback: pega texto completo se stream não enviou deltas
                            if (!fullResponse && parsed.response?.output) {
                                for (const item of parsed.response.output) {
                                    if (item.type === 'message' && item.content) {
                                        for (const c of item.content) {
                                            if (c.type === 'output_text') {
                                                fullResponse = c.text || '';
                                                process.stdout.write(fullResponse);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        
                    } catch {
                        // Ignora linhas não-JSON
                    }
                }
            }
        }
    } catch (err) {
        if (!err.message?.includes('aborted')) {
            console.error(`\n${C.red}✗ Erro no stream: ${err.message}${C.reset}`);
        }
    }
    
    console.log('\n');
    return { text: fullResponse, responseId };
}

// ═══════════════════════════════════════════════════════
//  UI — Interface do Chat
// ═══════════════════════════════════════════════════════

function printBanner(model) {
    console.log(`
${C.cyan}╔═══════════════════════════════════════════════════╗
║  ${C.bold}🤖 OpenAI Chat${C.reset}${C.cyan}  ·  Terminal Edition              ║
║  ${C.dim}Codex API + Device Code Auth${C.reset}${C.cyan}                    ║
╚═══════════════════════════════════════════════════╝${C.reset}
  Modelo: ${C.bold}${C.yellow}${model}${C.reset}
  Comandos: /help, /model, /new, /tokens, /reauth, /exit
`);
}

function printHelp() {
    console.log(`
${C.bold}Comandos disponíveis:${C.reset}
  ${C.cyan}/help${C.reset}       Mostra este menu
  ${C.cyan}/model${C.reset}      Trocar modelo ${C.dim}(ex: /model gpt-4o)${C.reset}
  ${C.cyan}/new${C.reset}        Nova conversa (limpa contexto)
  ${C.cyan}/tokens${C.reset}     Ver estado dos tokens
  ${C.cyan}/reauth${C.reset}     Refazer autenticação
  ${C.cyan}/run${C.reset}        Executar automação YAML ${C.dim}(ex: /run criar-api.yaml [--inject])${C.reset}
  ${C.cyan}/exit${C.reset}       Sair

${C.bold}Modelos disponíveis:${C.reset}
  ${C.dim}gpt-5.1-codex${C.reset}      GPT-5.1 Codex (alta qualidade, padrão)
  ${C.dim}gpt-5.1${C.reset}            GPT-5.1 Chat (mais simples, estável)
  ${C.dim}gpt-4.1${C.reset}            GPT-4.1 Chat (rápido)
  ${C.dim}codex-mini-latest${C.reset}    Codex Mini (rápido, otimizado para CLI)
  ${C.dim}gpt-5.3-codex${C.reset}      GPT-5.3 Codex (mais recente)
`);
}

function printTokenInfo() {
    const tokens = loadTokens();
    if (!tokens) {
        console.log(`${C.red}  Sem tokens salvos.${C.reset}\n`);
        return;
    }
    
    const expired = isTokenExpired(tokens);
    const expDate = new Date(tokens.expires_at).toLocaleString('pt-BR');
    const obtDate = new Date(tokens.obtained_at).toLocaleString('pt-BR');
    
    console.log(`
${C.bold}Estado dos Tokens:${C.reset}
  Status:   ${expired ? `${C.red}EXPIRADO` : `${C.green}VÁLIDO`}${C.reset}
  Obtido:   ${C.dim}${obtDate}${C.reset}
  Expira:   ${C.dim}${expDate}${C.reset}
  Método:   ${C.dim}${tokens.method}${C.reset}
  Endpoint: ${C.dim}${CODEX_API}${C.reset}
`);
}

// ═══════════════════════════════════════════════════════
//  MAIN
// ═══════════════════════════════════════════════════════

async function main() {
    // currentModel is now a global variable
    // Carrega sessão anterior se existir
    loadSession();
    
    printBanner(currentModel);
    
    let accessToken = await ensureValidToken();
    
    // Estado da conversa — a Responses API usa previous_response_id
    // previousResponseId is now lastResponseId (global)
    
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: `\n${C.bold}${C.white}Você ▸${C.reset} `
    });
    
    console.log(`\n${C.dim}  Pronto! Digite sua mensagem ou /help${C.reset}\n`);
    rl.prompt();
    
    rl.on('line', async (line) => {
        const input = line.trim();
        if (!input) { rl.prompt(); return; }
        
        // ────── Comandos ──────
        if (input.startsWith('/')) {
            const [cmd, ...args] = input.split(' ');
            
            switch (cmd.toLowerCase()) {
                case '/exit':
                case '/quit':
                case '/q':
                    console.log(`\n${C.dim}Até logo! 👋${C.reset}\n`);
                    process.exit(0);
                    
                case '/help':
                case '/h':
                    printHelp();
                    break;
                    
                case '/new':
                case '/clear':
                    lastResponseId = null;
                    conversationHistory = [];
                    saveSession();
                    console.log(`\n${C.yellow}✓ Histórico e contexto resetados.${C.reset}\n`);
                    return;
                    
                case '/model':
                    if (args.length === 0) {
                        console.log(`${C.dim}  Modelo atual: ${C.bold}${currentModel}${C.reset}`);
                        console.log(`${C.dim}  Uso: /model gpt-4o${C.reset}\n`);
                    } else {
                        currentModel = args[0];
                        saveSession();
                        console.log(`${C.green}✓ Modelo: ${C.bold}${currentModel}${C.reset}\n`);
                    }
                    break;

                case '/run':
                    if (args.length === 0) {
                        console.log(`${C.dim}  Uso: /run nome-arquivo.yaml [--inject]${C.reset}\n`);
                    } else {
                        const file = args[0];
                        const inject = args.includes('--inject');
                        accessToken = await ensureValidToken();
                        const autResult = await executeAutomation(accessToken, file, inject);
                        
                        // Se houve erro de token, tentamos uma vez
                        if (autResult?.error === 'token_expired') {
                            accessToken = await ensureValidToken(true);
                            await executeAutomation(accessToken, file, inject);
                        }
                    }
                    break;
                    
                case '/tokens':
                    printTokenInfo();
                    break;
                    
                case '/reauth':
                    console.log(`${C.yellow}🔑 A reiniciar autenticação...${C.reset}`);
                    try { fs.unlinkSync(TOKEN_FILE); } catch {}
                    accessToken = await ensureValidToken();
                    previousResponseId = null;
                    break;
                    
                default:
                    console.log(`${C.red}✗ Comando desconhecido: ${cmd}${C.reset}\n`);
            }
            
            rl.prompt();
            return;
        }
        
        // ────── Chat ──────
        accessToken = await ensureValidToken();
        const result = await sendMessage(accessToken, input, lastResponseId, currentModel);
        
        if (result.error === 'token_expired') {
            accessToken = await ensureValidToken(true); // Força refresh
            const retry = await sendMessage(accessToken, input, lastResponseId, currentModel);
            if (retry.error) {
                console.error(`\n${C.red}✗ Erro: ${retry.message}${C.reset}\n`);
            } else {
                const resp = await streamResponse(retry.stream);
                updateState(input, resp.text, resp.responseId);
            }
        } else if (result.error) {
            console.error(`\n${C.red}✗ Erro (${result.status}): ${result.message}${C.reset}\n`);
        } else {
            const resp = await streamResponse(result.stream);
            updateState(input, resp.text, resp.responseId);
        }
        
        rl.prompt();
    });
    
    rl.on('close', () => {
        console.log(`\n${C.dim}Até logo! 👋${C.reset}\n`);
        process.exit(0);
    });
}

main().catch(err => {
    console.error(`${C.red}Erro fatal: ${err.message}${C.reset}`);
    process.exit(1);
});
