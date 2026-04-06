const { CONFIG } = require('../../domain/constants');
const fs = require('fs');
const path = require('path');

class ChatUseCase {
    constructor(sessionRepo, tokenRepo, aiGateway, authGateway) {
        this.sessionRepo = sessionRepo;
        this.tokenRepo = tokenRepo;
        this.aiGateway = aiGateway;
        this.authGateway = authGateway;
        
        this.state = {
            currentModel: CONFIG.DEFAULT_MODEL,
            lastResponseId: null,
            conversationHistory: []
        };
    }

    loadSession() {
        const session = this.sessionRepo.load();
        if (session) {
            this.state.currentModel = session.currentModel || this.state.currentModel;
            this.state.lastResponseId = session.lastResponseId || null;
            this.state.conversationHistory = session.conversationHistory || [];
            return true;
        }
        return false;
    }

    saveSession() {
        this.sessionRepo.save(this.state);
    }

    resetSession() {
        this.state.lastResponseId = null;
        this.state.conversationHistory = [];
        this.saveSession();
    }

    setModel(model) {
        this.state.currentModel = model;
        this.saveSession();
    }

    async updateStateFromResponse(userMsg, aiText, responseId, accessToken) {
        if (responseId) this.state.lastResponseId = responseId;
        
        const isCodex = this.state.currentModel.endsWith('-codex') || this.state.currentModel.startsWith('codex');
        if (isCodex && aiText) {
            this.state.conversationHistory.push({
                role: "user",
                content: [{ type: "input_text", text: userMsg }]
            });
            this.state.conversationHistory.push({
                role: "assistant",
                content: [{ type: "output_text", text: aiText }]
            });
            
            // Context Collapse (Comprimir se houver > 40 mensagens)
            if (this.state.conversationHistory.length > 40) {
                await this._collapseHistory(accessToken);
            }
        }
        this.saveSession();
    }

    async _collapseHistory(accessToken) {
        const total = this.state.conversationHistory.length;
        const toSummarize = this.state.conversationHistory.slice(0, 20);
        const remaining = this.state.conversationHistory.slice(20);

        if (process.env.DEBUG === 'true') {
            console.log(`\n${CONFIG.C?.yellow || ''}[DEBUG] Gatilho de Context Collapse: Comprimindo ${toSummarize.length} mensagens...${CONFIG.C?.reset || ''}`);
        }

        const prompt = [
            {
                role: "system",
                content: [{ type: "input_text", text: "Você é um compressor de contexto técnico. Resuma as discussões, bugs encontrados e decisões tomadas neste trecho de conversa de forma EXTREMAMENTE densa e curta. Preserve nomes de arquivos e IDs. O objetivo é liberar espaço no contexto sem perder o fio da meada." }]
            },
            ...toSummarize
        ];

        try {
            const summary = await this.aiGateway.summarize(accessToken, prompt);
            
            if (summary) {
                this.state.conversationHistory = [
                    {
                        role: "system",
                        content: [{ type: "input_text", text: `[CONTEXT COLLAPSE: ANTERIOR]\n${summary}` }]
                    },
                    ...remaining
                ];
                if (process.env.DEBUG === 'true') {
                    console.log(`${CONFIG.C?.green || ''}[DEBUG] Contexto comprimido com sucesso!${CONFIG.C?.reset || ''}`);
                }
            } else {
                // Fallback: se falhar, apenas faz o corte seco para não travar
                this.state.conversationHistory = this.state.conversationHistory.slice(-20);
            }
        } catch (err) {
            console.error(`[DEBUG] Erro no Context Collapse: ${err.message}`);
            this.state.conversationHistory = this.state.conversationHistory.slice(-20);
        }
    }

    async sendMessage(accessToken, userMessage, model = this.state.currentModel, previousResponseId = this.state.lastResponseId) {
        const isCodex = model.endsWith('-codex') || model.startsWith('codex');
        let memoryIndex = '';
        try {
            const memoryPath = path.join(__dirname, '../../../MEMORY.md');
            if (fs.existsSync(memoryPath)) {
                memoryIndex = fs.readFileSync(memoryPath, 'utf-8');
                if (process.env.DEBUG === 'true') {
                    console.log(`\n${CONFIG.C?.yellow || ''}[DEBUG] Memory Index injetado (${memoryIndex.length} bytes)${CONFIG.C?.reset || ''}`);
                }
            }
        } catch (e) { /* Ignore */ }

        const defaultInstructions = `Você é o motor cognitivo do Codexia, um terminal avançado para Codex e Chat.
MODELO ATUAL: ${model}

Você possui comandos especiais que o usuário executa:
- /read <caminho>: Lê um arquivo ou lista um diretório.
- /fetch <url>: Busca conteúdo web.
- /run <automation>: Executa tarefas YAML.
- /paste: Modo de colagem múltipla.

Quando o usuário usa /read em uma pasta, eu injetarei a lista de arquivos para você. Use essa informação para ajudar o usuário a navegar e analisar o código. Suas respostas devem ser precisas e você tem consciência situacional de que está rodando em um terminal Node.js.

${memoryIndex ? `\n--- 🧠 MEMORY INDEX (Contexto Permanente) ---\n${memoryIndex}\n--------------------------------------------\n` : ''}`;

        const body = {
            model: model,
            instructions: defaultInstructions,
            stream: true,
        };

        if (isCodex) {
            const instructions = [
                `# ROLE: ${this.state.currentModel} — Codexia Advanced Assistant`,
                `Você é um assistente de engenharia altamente técnico e proativo operando no Codexia CLI.`,
                `SEU OBJETIVO: Atuar como um AGENTE que não apenas resolve problemas, mas gerencia a própria memória de longo prazo do projeto para garantir continuidade.`,
                
                `## 🧠 AUTOGESTÃO DE MEMÓRIA (Disciplina Claude Code)`,
                `Você é o CURADOR da memória do projeto. Sua tarefa é manter o arquivo \`MEMORY.md\` (Índice) e a pasta \`memory/\` (Tópicos) sempre atualizados.`,
                `Sempre que houver um progresso significativo, uma decisão de arquitetura ou um bug complexo resolvido:`,
                `1. Use o comando \`/write memory/topic-<contexto>-<data>.md\` para salvar os detalhes técnicos.`,
                `2. Use o comando \`/write MEMORY.md\` para atualizar o índice com o novo ponteiro (máximo 150 chars/linha).`,
                `3. Mantenha o índice conciso e denso.`,

                `## 🛠️ COMANDOS DISPONÍVEIS (Modo Agente)`,
                `- \`/write <path>\`: Use para criar ou atualizar arquivos (Memória, código, docs). O conteúdo deve vir imediatamente após o caminho.`,
                `- \`/read <path>\`: Leia arquivos ou liste diretórios.`,
                `- \`/fetch <url>\`: Busque conteúdo web para contexto.`,
                `- \`/run <automation.yaml>\`: Execute fluxos de automação.`,

                `## 📝 FORMATO DO ÍNDICE (MEMORY.md)`,
                `Mantenha este padrão estrito:`,
                `- [TAG:ID] Descrição curta — memory/topic-nome-data.md`,

                `--- 🧠 MEMORY INDEX ATUAL (Contexto Permanente) ---`,
                memoryIndex || "O índice de memória está vazio no momento.",
                `--------------------------------------------------`,

                `HISTÓRICO DA SESSÃO ATUAL:`,
            ].join('\n');

            body.input = [
                {
                    role: "system",
                    content: [{ type: "input_text", text: instructions }]
                },
                ...this.state.conversationHistory,
                {
                    role: "user",
                    content: [{ type: "input_text", text: userMessage }]
                }
            ];
            body.store = false; 
        } else {
            body.input = userMessage; 
            if (previousResponseId) {
                body.previous_response_id = previousResponseId;
            }
        }

        return await this.aiGateway.sendMessage(accessToken, body);
    }

    async ensureValidToken(forceRefresh = false) {
        let tokens = this.tokenRepo.load();
        
        if (tokens && !this.tokenRepo.isExpired(tokens) && !forceRefresh) {
            return tokens.access_token;
        }
        
        if (tokens && tokens.refresh_token) {
            const data = await this.authGateway.refreshAccessToken(tokens.refresh_token);
            if (data) {
                const saved = this.tokenRepo.save(data, data.expires_in);
                return saved.access_token;
            }
        }
        
        return null; // Trigger device auth in controller
    }
}

module.exports = ChatUseCase;
