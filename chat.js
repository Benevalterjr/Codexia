/**
 * 🤖 Codexia — Terminal interativo com Device Code Auth
 * 
 * Refatorado para Clean Architecture + Testabilidade.
 * Uso: node chat.js
 */

const readline = require('readline');
const fs = require('fs');
const path = require('path');

// Dominio e Infra
const { C, CONFIG } = require('./src/domain/constants');
const JsonTokenRepository = require('./src/infrastructure/repositories/JsonTokenRepository');
const JsonSessionRepository = require('./src/infrastructure/repositories/JsonSessionRepository');
const AiGateway = require('./src/infrastructure/gateways/AiGateway');
const AuthGateway = require('./src/infrastructure/gateways/AuthGateway');
const BrowserGateway = require('./src/infrastructure/gateways/BrowserGateway');

// Aplicação
const ChatUseCase = require('./src/application/use-cases/ChatUseCase');
const AutomationUseCase = require('./src/application/use-cases/AutomationUseCase');

// Interface
const { handleCommand } = require('./src/interface/CommandRouter');

// ───────────────────── UI HELPERS (Pure) ─────────────────────

function printBanner(model) {
    console.log(`
${C.cyan}╔═══════════════════════════════════════════════════╗
║  ${C.bold}🤖 Codexia Engine${C.reset}${C.cyan} ·  Terminal Edition            ║
║  ${C.dim}Codex API + Device Code Auth${C.reset}${C.cyan}                     ║
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
  ${C.cyan}/paste${C.reset}      Modo multiline para colar código (fim com /done)
  ${C.cyan}/fetch${C.reset}      Buscar conteúdo de uma URL ${C.dim}(ex: /fetch https://example.com)${C.reset}
  ${C.cyan}/read${C.reset}       Ler um arquivo local ${C.dim}(ex: /read src/chat.js)${C.reset}
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

// ──────────── STREAM PARSER (Testable) ────────────────

async function streamResponse(stream, output = process.stdout) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let fullResponse = '';
    let buffer = '';
    let responseId = null;
    
    output.write(`\n${C.cyan}${C.bold}AI ▸${C.reset} `);
    
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
                        if (parsed.response?.id) responseId = parsed.response.id;
                        if (parsed.id && parsed.id.startsWith('resp_')) responseId = parsed.id;
                        
                        if (parsed.type === 'response.output_text.delta') {
                            const delta = parsed.delta || '';
                            output.write(delta);
                            fullResponse += delta;
                        } else if (parsed.delta && typeof parsed.delta === 'string' && !parsed.type) {
                            output.write(parsed.delta);
                            fullResponse += parsed.delta;
                        } else if (parsed.type === 'error') {
                            output.write(`\n${C.red}✗ Erro: ${parsed.error?.message || JSON.stringify(parsed)}${C.reset}`);
                        } else if (parsed.type === 'response.completed') {
                            if (parsed.response?.id) responseId = parsed.response.id;
                            if (!fullResponse && parsed.response?.output) {
                                for (const item of parsed.response.output) {
                                    if (item.type === 'message' && item.content) {
                                        for (const c of item.content) {
                                            if (c.type === 'output_text') {
                                                fullResponse = c.text || '';
                                                output.write(fullResponse);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    } catch (e) {
                        if (process.env.DEBUG === 'true') {
                            console.warn(`\n${C.yellow}[DEBUG] Falha ao processar linha SSE: ${data}${C.reset}`);
                        }
                    }
                }
            }
        }
    } catch (err) {
        if (!err.message?.includes('aborted')) {
            output.write(`\n${C.red}✗ Erro no stream: ${err.message}${C.reset}`);
        }
    }
    
    output.write('\n\n');
    return { text: fullResponse, responseId };
}

// ──────────── APP FACTORY (Dependency Injection) ────────────────

function createApp(deps) {
    const { tokenRepo, chatUseCase, automationUseCase, authGateway, browserGateway } = deps;
    
    let accessToken = null;

    const appState = {
        isMultiline: false,
        isProcessing: false,
        multilineBuffer: [],
    };

    function printTokenInfo() {
        const tokens = tokenRepo.load();
        if (!tokens) {
            console.log(`${C.red}  Sem tokens salvos.${C.reset}\n`);
            return;
        }
        
        const expired = tokenRepo.isExpired(tokens);
        const expDate = new Date(tokens.expires_at).toLocaleString('pt-BR');
        const obtDate = new Date(tokens.obtained_at).toLocaleString('pt-BR');
        
        console.log(`
${C.bold}Estado dos Tokens:${C.reset}
  Status:   ${expired ? `${C.red}EXPIRADO` : `${C.green}VÁLIDO`}${C.reset}
  Obtido:   ${C.dim}${obtDate}${C.reset}
  Expira:   ${C.dim}${expDate}${C.reset}
  Método:   ${C.dim}${tokens.method}${C.reset}
  Endpoint: ${C.dim}${CONFIG.CODEX_API}${C.reset}
`);
    }

    // ──────────────── DEVICE CODE FLOW (Bug Fixed) ────────────────────
    async function handleDeviceAuth() {
        console.log(`\n${C.bold}[Auth]${C.reset} A iniciar Device Code Flow...\n`);
        
        try {
            const ucData = await authGateway.requestUserCode();
            const userCode = ucData.user_code || ucData.usercode;
            const interval = typeof ucData.interval === 'string' ? parseInt(ucData.interval, 10) : (ucData.interval ?? 5);
            
            console.log(`╭──────────────────────────────────────────────╮`);
            console.log(`│  ${C.bold}1.${C.reset} Abra: ${C.cyan}https://auth.openai.com/codex/device${C.reset}  │`);
            console.log(`│  ${C.bold}2.${C.reset} Código: ${C.bold}${C.yellow}${userCode}${C.reset}                           │`);
            console.log(`│  ${C.dim}Expira em 15 minutos.${C.reset}                       │`);
            console.log(`╰──────────────────────────────────────────────╯\n`);
            
            process.stdout.write(`${C.dim}  À espera de autorização...`);
            const startTime = Date.now();
            
            while (Date.now() - startTime < CONFIG.MAX_WAIT_MS) {
                await new Promise(r => setTimeout(r, interval * 1000));
                
                try {
                    const pollData = await authGateway.pollForToken(ucData.device_auth_id, userCode);
                    
                    if (pollData) {
                        console.log(`${C.reset}\n${C.green}✓ Autorizado!${C.reset}`);
                        const tokens = await authGateway.exchangeCodeForTokens(pollData.authorization_code, pollData.code_verifier);
                        const saved = tokenRepo.save(tokens, tokens.expires_in);
                        console.log(`${C.green}✓ Tokens salvos! Expira: ${new Date(saved.expires_at).toLocaleString('pt-BR')}${C.reset}\n`);
                        return saved.access_token;
                    }
                    process.stdout.write('.');
                } catch (err) {
                    if (err.status === 401 || err.status === 403) {
                        console.error(`\n${C.red}✗ Falha crítica no polling (${err.status}): ${err.message || 'Acesso negado'}${C.reset}`);
                        break; 
                    }
                    process.stdout.write('!');
                }
            }
            
            console.error(`\n${C.red}✗ Timeout (15 min).${C.reset}`);
            return null;
        } catch (err) {
            console.error(`${C.red}✗ Falha na autenticação: ${err.message}${C.reset}`);
            return null;
        }
    }

    async function getOrAuthToken(forceRefresh = false) {
        const token = await chatUseCase.ensureValidToken(forceRefresh);
        if (token) {
            return token;
        }
        
        console.log(`${C.yellow}⚠ Sem token válido. Necessário autenticar.${C.reset}`);
        return await handleDeviceAuth();
    }

    // Contexto de aplicação consolidado para evitar spreads repetitivos
    const ctx = {
        ...deps,
        printHelp,
        printTokenInfo,
        streamResponse,
        getOrAuthToken,
        handleDeviceAuth,
        C,
        CONFIG
    };

    // ──────────────── COMMAND ROUTER ────────────────────

    // handleCommand logic extracted to src/interface/CommandRouter.js

    // ──────────────── CHAT FLOW ────────────────────

    async function processInput(input, rl) {
        accessToken = await getOrAuthToken();
        if (!accessToken) {
            console.error(`\n${C.red}✗ Não foi possível obter token de acesso.${C.reset}\n`);
            rl.prompt();
            return;
        }

        let result = await chatUseCase.sendMessage(accessToken, input);
        
        if (result.error === 'token_expired') {
            accessToken = await getOrAuthToken(true);
            if (!accessToken) {
                console.error(`\n${C.red}✗ Token expirado e reautenticação falhou.${C.reset}\n`);
                rl.prompt();
                return;
            }
            result = await chatUseCase.sendMessage(accessToken, input);
        }
        
        if (result.error) {
            console.error(`\n${C.red}✗ Erro (${result.status || 'API'}): ${result.message}${C.reset}\n`);
        } else if (result.stream) {
            const resp = await streamResponse(result.stream);
            await chatUseCase.updateStateFromResponse(input, resp.text, resp.responseId, accessToken);

            // AGENTIC: Detetar se a IA quer escrever arquivos (Memória Autônoma)
            // Utiliza blocos delimitados: ```write <path>\n<conteúdo>\n```
            const writeRegex = /```write\s+([^\n]+)\n([\s\S]*?)\n```/g;
            let match;
            
            while ((match = writeRegex.exec(resp.text)) !== null) {
                let targetSpec = match[1].trim();
                let content = match[2]; // Capturado puramente até o fechamento do bloco
                
                // Limpeza extrema: remover pontuação final acidental do path
                targetSpec = targetSpec.replace(/[\.\)\,\?\!]+$/, '');
                const pathTokens = targetSpec.split(/\s+/).filter(Boolean);
                const targetPath = pathTokens[0];
                const pathHasForceFlag = pathTokens.includes('--force');
                
                // Remover flags se existirem (ex: --force)
                const isForce = pathHasForceFlag || content.includes('--force');
                content = content.replace('--force', '').trim();

                console.log(`\n${C.magenta}${C.bold}🤖 AGENTE:${C.reset} A IA deseja escrever em: ${C.bold}${targetPath}${C.reset}`);
                console.log(`${C.dim}Preview (${content.length} chars): ${content.substring(0, 80).replace(/\n/g, ' ')}...${C.reset}`);

                const confirm = await new Promise(r => rl.question(`${C.yellow}➤ Autorizar escrita? (y/N): ${C.reset}`, r));
                if (confirm.toLowerCase() === 'y') {
                    await handleCommand('/write', [targetPath, isForce ? '--force' : ''].filter(Boolean), rl, appState, {
                        ...ctx,
                        content,
                        confirmWrite: async () => true
                    });
                } else {
                    console.log(`${C.red}✗ Escrita recusada.${C.reset}\n`);
                }
            }
        }
        
        rl.prompt();
    }

    // ──────────────── MAIN LOOP ────────────────────

    async function start() {
        chatUseCase.loadSession();
        printBanner(chatUseCase.state.currentModel);
        
        accessToken = await getOrAuthToken();
        if (!accessToken) process.exit(1);

        const tokens = tokenRepo.load();
        const expDate = new Date(tokens.expires_at).toLocaleString('pt-BR');
        console.log(`${C.green}✓ Token válido ${C.dim}(expira: ${expDate})${C.reset}`);
        
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            prompt: `\n${C.bold}${C.white}Você ▸${C.reset} `
        });
        
        console.log(`\n${C.dim}  Pronto! Digite sua mensagem ou /help${C.reset}\n`);
        rl.prompt();
        
        rl.on('line', async (line) => {
            if (appState.isProcessing) return;
            
            const input = line.trim();
            
            appState.isProcessing = true;
            try {
                // Handle Multiline Mode
                if (appState.isMultiline) {
                    if (input.toLowerCase() === '/done') {
                        appState.isMultiline = false;
                        const fullInput = appState.multilineBuffer.join('\n');
                        appState.multilineBuffer = [];
                        console.log(`${C.green}✓ Bloco multiline fechado. Enviando...${C.reset}`);
                        await processInput(fullInput, rl);
                    } else {
                        appState.multilineBuffer.push(line);
                    }
                    return;
                }

                if (!input) { rl.prompt(); return; }
                
                if (input.startsWith('/')) {
                    const [cmd, ...args] = input.split(' ');
                    await handleCommand(cmd, args, rl, appState, ctx);
                    rl.prompt();
                    return;
                }
                
                await processInput(input, rl);
            } finally {
                appState.isProcessing = false;
            }
        });
        
        rl.on('close', () => {
            console.log(`\n${C.dim}Até logo! 👋${C.reset}\n`);
            process.exit(0);
        });
    }

    return {
        printTokenInfo,
        handleDeviceAuth,
        getOrAuthToken,
        handleCommand: (cmd, args, rl, appState) => handleCommand(cmd, args, rl, appState, ctx),
        processInput,
        start,
        get accessToken() { return accessToken; },
        set accessToken(t) { accessToken = t; },
    };
}

// ────────────────────── AUTO-EXECUTION ────────────────────────

if (require.main === module) {
    const tokenRepo = new JsonTokenRepository();
    const sessionRepo = new JsonSessionRepository();
    const aiGateway = new AiGateway();
    const authGateway = new AuthGateway();
    const browserGateway = new BrowserGateway();

    const chatUseCase = new ChatUseCase(sessionRepo, tokenRepo, aiGateway, authGateway);
    const automationUseCase = new AutomationUseCase(chatUseCase);

    const app = createApp({ tokenRepo, sessionRepo, aiGateway, authGateway, browserGateway, chatUseCase, automationUseCase });
    app.start().catch(err => {
        console.error(`${C.red}Erro fatal: ${err.message}${C.reset}`);
        process.exit(1);
    });
}

module.exports = { createApp, printBanner, printHelp, streamResponse };
