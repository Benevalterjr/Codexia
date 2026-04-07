const { CONFIG } = require('../../domain/constants');
const fs = require('fs');
const path = require('path');
const { buildDefaultInstructions, buildCodexInstructions } = require('../PromptBuilder');

const DEFAULT_MEMORY_TEMPLATE = `# MEMORY Index

Use este arquivo como índice de conhecimento persistente do projeto.

## Convenção de entradas
- [TAG:ID] Descrição curta — memory/topic-nome-data.md

## Tópicos
- [INIT:0001] Bootstrap do índice de memória — memory/topic-bootstrap-0001.md
`;

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
            if (!fs.existsSync(memoryPath)) {
                fs.writeFileSync(memoryPath, DEFAULT_MEMORY_TEMPLATE, 'utf-8');
            }
            if (fs.existsSync(memoryPath)) {
                memoryIndex = fs.readFileSync(memoryPath, 'utf-8');
                if (process.env.DEBUG === 'true') {
                    console.log(`\n${CONFIG.C?.yellow || ''}[DEBUG] Memory Index injetado (${memoryIndex.length} bytes)${CONFIG.C?.reset || ''}`);
                }
            }
        } catch (e) { /* Ignore */ }

        const defaultInstructions = buildDefaultInstructions(model, memoryIndex);

        const body = {
            model: model,
            instructions: defaultInstructions,
            stream: true,
        };

        if (isCodex) {
            const instructions = buildCodexInstructions(this.state.currentModel, memoryIndex);

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
