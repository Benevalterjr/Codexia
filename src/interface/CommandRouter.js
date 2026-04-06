const fs = require('fs');
const path = require('path');

async function handleCommand(cmd, args, rl, appState, deps) {
    const { 
        C, CONFIG, chatUseCase, automationUseCase, tokenRepo, 
        authGateway, browserGateway, streamResponse, 
        getOrAuthToken, handleDeviceAuth, printHelp, printTokenInfo
    } = deps;

    switch (cmd.toLowerCase()) {
        case '/exit': case '/quit': case '/q':
            console.log(`\n${C.dim}A fechar conexões...${C.reset}`);
            await browserGateway.close();
            console.log(`${C.dim}Até logo! 👋${C.reset}\n`);
            process.exit(0);
            break;
        case '/help': case '/h':
            printHelp();
            break;
        case '/paste': case '/multiline':
            appState.isMultiline = true;
            appState.multilineBuffer = [];
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
                const newModel = args[0];
                if (!CONFIG.VALID_MODELS.includes(newModel)) {
                    console.log(`\n${C.red}✗ Modelo inválido: ${C.bold}${newModel}${C.reset}`);
                    console.log(`${C.dim}Modelos válidos: ${CONFIG.VALID_MODELS.join(', ')}${C.reset}\n`);
                } else {
                    chatUseCase.setModel(newModel);
                    console.log(`${C.green}✓ Modelo: ${C.bold}${chatUseCase.state.currentModel}${C.reset}\n`);
                }
            }
            break;
        case '/run':
            if (args.length === 0) {
                console.log(`${C.dim}  Uso: /run nome-arquivo.yaml [--inject]${C.reset}\n`);
            } else {
                const file = args[0];
                const inject = args.includes('--inject');
                const token = await getOrAuthToken();
                
                try {
                    const result = await automationUseCase.execute(token, file, inject);
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
                    
                    appState.isMultiline = true;
                    appState.multilineBuffer = [
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
        case '/read':
            if (args.length === 0) {
                console.log(`${C.dim}  Uso: /read <caminho-do-arquivo-ou-pasta>${C.reset}\n`);
            } else {
                const rawPath = args[0];
                const absPath = path.resolve(rawPath);
                const relPath = path.relative(process.cwd(), absPath);
                const isOutside = relPath.startsWith('..') || path.isAbsolute(relPath);

                if (isOutside && !args.includes('--force')) {
                    console.log(`\n${C.yellow}⚠ AVISO DE SEGURANÇA: O caminho está fora do workspace.${C.reset}`);
                    console.log(`${C.dim}Caminho: ${C.bold}${absPath}${C.reset}`);
                    console.log(`${C.dim}Para ler arquivos externos, use o parâmetro --force (Ex: /read ${rawPath} --force).${C.reset}\n`);
                    break;
                }

                if (isOutside && args.includes('--force')) {
                    console.log(`\n${C.magenta}${C.bold}[AUDIT]${C.reset} Acesso externo autorizado via --force: ${C.dim}${absPath}${C.reset}`);
                }

                const filePath = absPath;
                try {
                    if (!fs.existsSync(filePath)) throw new Error("Caminho não encontrado.");
                    
                    const stats = fs.lstatSync(filePath);
                    
                    if (stats.isDirectory()) {
                        console.log(`\n${C.cyan}📂 Listando diretório: ${C.bold}${filePath}${C.reset}`);
                        const files = fs.readdirSync(filePath);
                        if (files.length === 0) {
                            console.log(`${C.dim}  Diretório vazio.${C.reset}\n`);
                        } else {
                            files.forEach(f => {
                                const isDir = fs.lstatSync(path.join(filePath, f)).isDirectory();
                                console.log(`  ${isDir ? '📁' : '📄'} ${f}`);
                            });
                            console.log(`\n${C.dim}Dica: Use /read ${rawPath}/${files[0]} para ler um arquivo.${C.reset}\n`);

                            const dirList = files.map(f => `- ${f}`).join('\n');
                            chatUseCase.updateStateFromResponse(
                                `[SISTEMA: Listagem de diretório ${filePath}]`, 
                                `O diretório ${filePath} contém os seguintes itens:\n${dirList}`,
                                null
                            );
                        }
                    } else {
                        console.log(`\n${C.cyan}📄 Lendo arquivo: ${C.bold}${filePath}${C.reset}`);
                        const content = fs.readFileSync(filePath, 'utf-8');
                        console.log(`${C.green}✓ Arquivo lido (${content.length} caracteres).${C.reset}`);
                        console.log(`${C.dim}Enviando para o modo multiline...${C.reset}`);

                        appState.isMultiline = true;
                        appState.multilineBuffer = [
                            `CONTEÚDO DO ARQUIVO (${filePath}):`,
                            "---",
                            content,
                            "---",
                            "Por favor, analise o conteúdo deste arquivo."
                        ];
                        console.log(`\n${C.magenta}${C.bold}⇶ Arquivo carregado no buffer.${C.reset}`);
                        console.log(`${C.dim}Digite ${C.bold}/done${C.dim} para enviar à IA ou adicione mais instruções.${C.reset}\n`);
                    }
                } catch (err) {
                    console.error(`${C.red}✗ Falha: ${err.message}${C.reset}`);
                }
            }
            break;
        case '/write':
            if (args.length === 0) {
                console.log(`${C.dim}  Uso: /write <caminho-do-arquivo> [--force]${C.reset}\n`);
            } else {
                const rawPath = args[0];
                const absPath = path.resolve(rawPath);
                const relPath = path.relative(process.cwd(), absPath);
                const isOutside = relPath.startsWith('..') || path.isAbsolute(relPath);

                if (isOutside && !args.includes('--force')) {
                    console.log(`\n${C.yellow}⚠ AVISO DE SEGURANÇA: Tentativa de escrita fora do workspace.${C.reset}`);
                    console.log(`${C.dim}Caminho: ${C.bold}${absPath}${C.reset}`);
                    console.log(`${C.dim}Para escrever em arquivos externos, use o parâmetro --force.${C.reset}\n`);
                    break;
                }

                if (isOutside && args.includes('--force')) {
                    console.log(`\n${C.magenta}${C.bold}[AUDIT]${C.reset} Escrita externa autorizada via --force: ${C.dim}${absPath}${C.reset}`);
                }

                const content = deps.content || "";
                try {
                    const dir = path.dirname(absPath);
                    if (!fs.existsSync(dir)) {
                        fs.mkdirSync(dir, { recursive: true });
                    }
                    fs.writeFileSync(absPath, content, 'utf-8');
                    console.log(`\n${C.green}✓ Arquivo escrito com sucesso: ${C.bold}${absPath}${C.reset}`);
                    console.log(`${C.dim}(${content.length} caracteres)${C.reset}\n`);
                } catch (err) {
                    console.error(`${C.red}✗ Falha na escrita: ${err.message}${C.reset}`);
                }
            }
            break;
        case '/reauth':
            console.log(`${C.yellow}🔑 A reiniciar autenticação...${C.reset}`);
            tokenRepo.delete();
            await handleDeviceAuth(); 
            chatUseCase.resetSession();
            break;
        default:
            console.log(`${C.red}✗ Comando desconhecido: ${cmd}${C.reset}\n`);
    }
}

module.exports = { handleCommand };
