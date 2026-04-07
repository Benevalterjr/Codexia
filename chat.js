/**
 * 🤖 Codexia — Terminal interativo com Device Code Auth
 * 
 * Refatorado para Clean Architecture: Bootstrap minimalista.
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

// ──────────── APP FACTORY (Dependency Injection) ────────────────

function createApp(deps) {
    const { tokenRepo, chatUseCase, automationUseCase, authGateway, aiGateway } = deps;
    
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
        console.log(`
${C.bold}Estado dos Tokens:${C.reset}
  Status:   ${expired ? `${C.red}EXPIRADO` : `${C.green}VÁLIDO`}${C.reset}
  Obtido:   ${C.dim}${new Date(tokens.obtained_at).toLocaleString('pt-BR')}${C.reset}
  Expira:   ${C.dim}${new Date(tokens.expires_at).toLocaleString('pt-BR')}${C.reset}
  Endpoint: ${C.dim}${CONFIG.CODEX_API}${C.reset}
`);
    }

    async function getOrAuthToken(forceRefresh = false) {
        const token = await chatUseCase.ensureValidToken(forceRefresh);
        if (token) return token;
        
        console.log(`${C.yellow}⚠ Sem token válido. Iniciando Device Code Flow...${C.reset}`);
        try {
            const tokens = await authGateway.authenticateDevice(({ userCode, verificationUri }) => {
                console.log(`\n╭──────────────────────────────────────────────╮`);
                console.log(`│  ${C.bold}1.${C.reset} Abra: ${C.cyan}${verificationUri}${C.reset}  │`);
                console.log(`│  ${C.bold}2.${C.reset} Código: ${C.bold}${C.yellow}${userCode}${C.reset}                           │`);
                console.log(`╰──────────────────────────────────────────────╯\n`);
                process.stdout.write(`${C.dim}  À espera de autorização...`);
            });

            const saved = tokenRepo.save(tokens, tokens.expires_in);
            console.log(`${C.green}\n✓ Autorizado e tokens salvos!${C.reset}\n`);
            return saved.access_token;
        } catch (err) {
            console.error(`\n${C.red}✗ Falha na autenticação: ${err.message}${C.reset}`);
            return null;
        }
    }

    const ctx = { ...deps, printHelp, printTokenInfo, getOrAuthToken, C, CONFIG };

    async function processInput(input, rl) {
        accessToken = await getOrAuthToken();
        if (!accessToken) return rl.prompt();

        let result = await chatUseCase.sendMessage(accessToken, input);
        
        if (result.error === 'token_expired') {
            accessToken = await getOrAuthToken(true);
            if (!accessToken) return rl.prompt();
            result = await chatUseCase.sendMessage(accessToken, input);
        }
        
        if (result.error) {
            console.error(`\n${C.red}✗ Erro: ${result.message}${C.reset}\n`);
        } else if (result.stream) {
            const resp = await aiGateway.streamResponse(result.stream);
            await chatUseCase.updateStateFromResponse(input, resp.text, resp.responseId, accessToken);

            const pendingWrites = chatUseCase.extractAgenticWrites(resp.text);
            for (const pw of pendingWrites) {
                const targetPath = pw.targetSpec.split(/\s+/)[0];
                console.log(`\n${C.magenta}${C.bold}🤖 AGENTE:${C.reset} Deseja escrever em: ${C.bold}${targetPath}${C.reset}`);
                
                const confirm = await new Promise(r => rl.question(`${C.yellow}➤ Autorizar escrita? (y/N): ${C.reset}`, r));
                if (confirm.toLowerCase() === 'y') {
                    await handleCommand('/write', [pw.targetSpec, pw.content], rl, appState, {
                        ...ctx, content: pw.content, confirmWrite: async () => true
                    });
                }
            }
        }
        rl.prompt();
    }

    async function start() {
        chatUseCase.loadSession();
        printBanner(chatUseCase.state.currentModel);
        
        if (!(await getOrAuthToken())) process.exit(1);

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
                if (appState.isMultiline) {
                    if (input.toLowerCase() === '/done') {
                        appState.isMultiline = false;
                        const fullInput = appState.multilineBuffer.join('\n');
                        appState.multilineBuffer = [];
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
        
        rl.on('close', () => { console.log(`\n${C.dim}Até logo! 👋${C.reset}\n`); process.exit(0); });
    }

    return {
        printTokenInfo,
        getOrAuthToken,
        processInput,
        start,
        // Helpers para testes
        get appState() { return appState; }
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

    createApp({ tokenRepo, sessionRepo, aiGateway, authGateway, browserGateway, chatUseCase, automationUseCase })
        .start().catch(err => {
            console.error(`${C.red}Erro fatal: ${err.message}${C.reset}`);
            process.exit(1);
        });
}

module.exports = { createApp, printBanner, printHelp };
