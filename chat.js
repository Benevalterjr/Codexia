/**
 * 🤖 Codexia — Terminal interativo com Device Code Auth
 * 
 * Refatorado para Clean Architecture.
 * Uso: node chat.js
 */

const readline = require('readline');

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

// Instanciação dos Componentes
const tokenRepo = new JsonTokenRepository();
const sessionRepo = new JsonSessionRepository();
const aiGateway = new AiGateway();
const authGateway = new AuthGateway();
const browserGateway = new BrowserGateway();

const chatUseCase = new ChatUseCase(sessionRepo, tokenRepo, aiGateway, authGateway);
const automationUseCase = new AutomationUseCase(chatUseCase);

// ───────────────────── UI HELPERS ─────────────────────

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

// ──────────────── DEVICE CODE FLOW UI ────────────────────
async function handleDeviceAuth() {
    console.log(`\n${C.bold}[Auth]${C.reset} A iniciar Device Code Flow...\n`);
    
    try {
        const ucData = await authGateway.requestUserCode();
        const userCode = ucData.user_code || ucData.usercode;
        const interval = typeof ucData.interval === 'string' ? parseInt(ucData.interval, 10) : (ucData.interval || 5);
        
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
            } catch {
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
                        if (parsed.response?.id) responseId = parsed.response.id;
                        if (parsed.id && parsed.id.startsWith('resp_')) responseId = parsed.id;
                        
                        if (parsed.type === 'response.output_text.delta') {
                            const delta = parsed.delta || '';
                            process.stdout.write(delta);
                            fullResponse += delta;
                        } else if (parsed.delta && typeof parsed.delta === 'string' && !parsed.type) {
                            process.stdout.write(parsed.delta);
                            fullResponse += parsed.delta;
                        } else if (parsed.type === 'error') {
                            console.error(`\n${C.red}✗ Erro: ${parsed.error?.message || JSON.stringify(parsed)}${C.reset}`);
                        } else if (parsed.type === 'response.completed') {
                            if (parsed.response?.id) responseId = parsed.response.id;
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
                    } catch {}
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

// ────────────────────── MAIN ────────────────────────

async function main() {
    chatUseCase.loadSession();
    printBanner(chatUseCase.state.currentModel);
    
    let accessToken = await getOrAuthToken();
    if (!accessToken) process.exit(1);

    const tokens = tokenRepo.load();
    const expDate = new Date(tokens.expires_at).toLocaleString('pt-BR');
    console.log(`${C.green}✓ Token válido ${C.dim}(expira: ${expDate})${C.reset}`);
    
    let isMultiline = false;
    let multilineBuffer = [];

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: `\n${C.bold}${C.white}Você ▸${C.reset} `
    });
    
    console.log(`\n${C.dim}  Pronto! Digite sua mensagem ou /help${C.reset}\n`);
    rl.prompt();
    
    rl.on('line', async (line) => {
        const input = line.trim();
        
        // Handle Multiline Mode
        if (isMultiline) {
            if (input.toLowerCase() === '/done') {
                isMultiline = false;
                const fullInput = multilineBuffer.join('\n');
                multilineBuffer = [];
                console.log(`${C.green}✓ Bloco multiline fechado. Enviando...${C.reset}`);
                await processInput(fullInput, rl);
            } else {
                multilineBuffer.push(line);
            }
            return;
        }

        if (!input) { rl.prompt(); return; }
        
        if (input.startsWith('/')) {
            const [cmd, ...args] = input.split(' ');
            
            switch (cmd.toLowerCase()) {
                case '/exit': case '/quit': case '/q':
                    console.log(`\n${C.dim}A fechar conexões...${C.reset}`);
                    await browserGateway.close();
                    console.log(`${C.dim}Até logo! 👋${C.reset}\n`);
                    process.exit(0);
                case '/help': case '/h':
                    printHelp();
                    break;
                case '/paste': case '/multiline':
                    isMultiline = true;
                    multilineBuffer = [];
                    console.log(`\n${C.magenta}${C.bold}⇶ Modo Multiline ativado.${C.reset}`);
                    console.log(`${C.dim}Cole seu texto/código e digite ${C.bold}/done${C.dim} para enviar.${C.reset}\n`);
                    return;
                case '/new': case '/clear':
                    chatUseCase.resetSession();
                    console.log(`\n${C.yellow}✓ Histórico e contexto resetados.${C.reset}\n`);
                    break;
                case '/model':
                    if (args.length === 0) {
                        console.log(`${C.dim}  Modelo atual: ${C.bold}${chatUseCase.state.currentModel}${C.reset}`);
                        console.log(`${C.dim}  Uso: /model gpt-4o${C.reset}\n`);
                    } else {
                        chatUseCase.setModel(args[0]);
                        console.log(`${C.green}✓ Modelo: ${C.bold}${chatUseCase.state.currentModel}${C.reset}\n`);
                    }
                    break;
                case '/run':
                    if (args.length === 0) {
                        console.log(`${C.dim}  Uso: /run nome-arquivo.yaml [--inject]${C.reset}\n`);
                    } else {
                        const file = args[0];
                        const inject = args.includes('--inject');
                        accessToken = await getOrAuthToken();
                        
                        try {
                            const result = await automationUseCase.execute(accessToken, file, inject);
                            console.log(`\n${C.magenta}🚀 Executando Automação: ${C.bold}${result.config.meta?.name || file}${C.reset}`);
                            console.log(`${C.dim}Modelo: ${result.targetModel} | Injeção: ${inject ? "SIM" : "NÃO"}${C.reset}\n`);
                            
                            if (result.stream) {
                                const resp = await streamResponse(result.stream);
                                if (inject) {
                                    chatUseCase.updateStateFromResponse(`[AUTOMATION:${file}]`, resp.text, resp.responseId);
                                }
                            }
                        } catch (err) {
                            console.error(`${C.red}✗ Erro: ${err.message}${C.reset}`);
                        }
                    }
                    break;
                case '/tokens':
                    printTokenInfo();
                    break;
                case '/fetch':
                    if (args.length === 0) {
                        console.log(`${C.dim}  Uso: /fetch https://exemplo.com${C.reset}\n`);
                    } else {
                        const url = args[0];
                        console.log(`\n${C.cyan}🌐 Buscando conteúdo de: ${C.bold}${url}${C.reset}`);
                        try {
                            const content = await browserGateway.fetchPageContent(url);
                            console.log(`${C.green}✓ Conteúdo extraído (${content.length} caracteres).${C.reset}`);
                            console.log(`${C.dim}Enviando para o modo multiline...${C.reset}`);
                            
                            // Injeta no buffer multiline para o usuário revisar ou pedir algo sobre
                            isMultiline = true;
                            multilineBuffer = [
                                `CONTEÚDO DA PÁGINA (${url}):`,
                                "---",
                                content,
                                "---",
                                "Por favor, analise o conteúdo acima."
                            ];
                            console.log(`\n${C.magenta}${C.bold}⇶ Conteúdo carregado no buffer.${C.reset}`);
                            console.log(`${C.dim}Digite ${C.bold}/done${C.dim} para enviar à IA ou adicione mais instruções.${C.reset}\n`);
                        } catch (err) {
                            console.error(`${C.red}✗ Falha no fetch: ${err.message}${C.reset}`);
                        }
                    }
                    break;
                case '/reauth':
                    console.log(`${C.yellow}🔑 A reiniciar autenticação...${C.reset}`);
                    tokenRepo.delete();
                    accessToken = await handleDeviceAuth();
                    chatUseCase.resetSession();
                    break;
                default:
                    console.log(`${C.red}✗ Comando desconhecido: ${cmd}${C.reset}\n`);
            }
            rl.prompt();
            return;
        }
        
        await processInput(input, rl);
    });

    async function processInput(input, rl) {
        // Chat Flow
        accessToken = await getOrAuthToken();
        let result = await chatUseCase.sendMessage(accessToken, input);
        
        if (result.error === 'token_expired') {
            accessToken = await getOrAuthToken(true);
            result = await chatUseCase.sendMessage(accessToken, input);
        }
        
        if (result.error) {
            console.error(`\n${C.red}✗ Erro (${result.status || 'API'}): ${result.message}${C.reset}\n`);
        } else if (result.stream) {
            const resp = await streamResponse(result.stream);
            chatUseCase.updateStateFromResponse(input, resp.text, resp.responseId);
        }
        
        rl.prompt();
    }
    
    rl.on('close', () => {
        console.log(`\n${C.dim}Até logo! 👋${C.reset}\n`);
        process.exit(0);
    });
}

main().catch(err => {
    console.error(`${C.red}Erro fatal: ${err.message}${C.reset}`);
    process.exit(1);
});
