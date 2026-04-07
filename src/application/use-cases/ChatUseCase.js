const { CONFIG } = require('../../domain/constants');
const fs = require('fs');
const path = require('path');
const { buildDefaultInstructions, buildCodexInstructions } = require('../PromptBuilder');

const DEFAULT_MEMORY_TEMPLATE = `# 🧠 CODEXIA MEMORY INDEX

Este arquivo é o índice de contexto permanente do Codexia.
Use as tags para localizar rapidamente os tópicos em \`memory/\`.

> **Política**: Escrever tópico primeiro, depois atualizar este índice.
> Cada linha ≤ 150 chars. Sem código, sem logs.

## 📌 TÓPICOS ATIVOS

- [INIT:BOOT] Bootstrap do sistema de memória — memory/topic-bootstrap.md

## 📜 HISTÓRICO DE SESSÕES (Grep-only)

_(Sessões serão registradas aqui automaticamente)_

---
Disciplina: escrever tópico primeiro, depois atualizar este índice.
`;

const DEFAULT_BOOTSTRAP_TOPIC = `# [INIT:BOOT] Bootstrap do Sistema de Memória

## Contexto
Este é o primeiro tópico de memória do Codexia, criado automaticamente na inicialização.
O sistema de memória permite que a IA mantenha continuidade entre sessões.

## Como funciona
1. **MEMORY.md** — Índice compacto com ponteiros para tópicos detalhados.
2. **memory/** — Pasta com tópicos individuais (um arquivo por assunto).
3. A IA usa o comando \`/write\` para criar/atualizar tópicos e o índice.

## Convenções
- Tags no formato \`[AREA:ID]\` (ex: \`[SEC:TOKEN]\`, \`[FIX:CHAT]\`).
- Nomes de arquivo: \`topic-<contexto>-<data>.md\`.
- Máximo de 25 linhas úteis por atualização de tópico.
- Registrar apenas decisões que afetam o futuro do projeto.

## Próximos passos
- Usar o Codexia normalmente — a memória será populada organicamente.
`;

const DEFAULT_AUTODREAM_TOPIC = (dateIso, highlights) => `# [AUTO:DREAM] Consolidação assíncrona (${dateIso})

## Contexto
Consolidação automática baseada nos últimos eventos de sessão (JSONL).

## Highlights
${highlights.map(line => `- ${line}`).join('\n')}

## Próximos passos
- Revisar conflitos/contradições e atualizar tópicos canônicos relevantes.
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
        this._appendTranscriptEntry(userMsg, aiText, responseId);
        this._scheduleAutoDream();
        this.saveSession();
    }

    _appendTranscriptEntry(userMsg, aiText, responseId) {
        try {
            const rootDir = path.join(__dirname, '../../..');
            const transcriptsDir = path.join(rootDir, 'memory', 'transcripts');
            const transcriptPath = path.join(transcriptsDir, 'sessions.jsonl');
            if (!fs.existsSync(transcriptsDir)) fs.mkdirSync(transcriptsDir, { recursive: true });
            const entry = {
                at: new Date().toISOString(),
                model: this.state.currentModel,
                responseId: responseId || null,
                user: userMsg,
                assistant: aiText
            };
            fs.appendFileSync(transcriptPath, `${JSON.stringify(entry)}\n`, 'utf-8');
        } catch (_) { /* Ignore */ }
    }

    _scheduleAutoDream() {
        if (process.env.CODEXIA_AUTODREAM === 'false') return;
        if (this._autoDreamScheduled) return;
        this._autoDreamScheduled = true;
        setTimeout(() => {
            try {
                this._runAutoDream();
            } finally {
                this._autoDreamScheduled = false;
            }
        }, 0);
    }

    _runAutoDream() {
        try {
            const rootDir = path.join(__dirname, '../../..');
            const memoryDir = path.join(rootDir, 'memory');
            const transcriptPath = path.join(memoryDir, 'transcripts', 'sessions.jsonl');
            const memoryPath = path.join(rootDir, 'MEMORY.md');
            if (!fs.existsSync(transcriptPath)) return;
            const raw = fs.readFileSync(transcriptPath, 'utf-8').trim();
            if (!raw) return;
            const lines = raw.split('\n').slice(-3);
            const highlights = lines.map(line => {
                try {
                    const parsed = JSON.parse(line);
                    return `${parsed.user || 'N/A'} => ${(parsed.assistant || '').slice(0, 120)}`;
                } catch (_) {
                    return line.slice(0, 120);
                }
            });
            const dateTag = new Date().toISOString().slice(0, 10).replace(/-/g, '');
            const topicPath = path.join(memoryDir, `topic-autodream-${dateTag}.md`);
            fs.writeFileSync(topicPath, DEFAULT_AUTODREAM_TOPIC(new Date().toISOString().slice(0, 10), highlights), 'utf-8');

            const entryLine = `- [AUTO:DREAM] Consolidação assíncrona — memory/topic-autodream-${dateTag}.md`;
            const indexText = fs.existsSync(memoryPath) ? fs.readFileSync(memoryPath, 'utf-8') : DEFAULT_MEMORY_TEMPLATE;
            if (!indexText.includes(entryLine)) {
                const updated = indexText.includes('## 📌 TÓPICOS ATIVOS')
                    ? indexText.replace('## 📌 TÓPICOS ATIVOS', `## 📌 TÓPICOS ATIVOS\n\n${entryLine}`)
                    : `${indexText}\n\n## 📌 TÓPICOS ATIVOS\n\n${entryLine}\n`;
                fs.writeFileSync(memoryPath, updated, 'utf-8');
            }
        } catch (_) { /* Ignore */ }
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
            const rootDir = path.join(__dirname, '../../..');
            const memoryPath = path.join(rootDir, 'MEMORY.md');
            const memoryDir = path.join(rootDir, 'memory');
            const bootstrapPath = path.join(memoryDir, 'topic-bootstrap.md');

            // Auto-criar estrutura de memória na primeira execução
            if (!fs.existsSync(memoryDir)) {
                fs.mkdirSync(memoryDir, { recursive: true });
            }
            if (!fs.existsSync(bootstrapPath)) {
                fs.writeFileSync(bootstrapPath, DEFAULT_BOOTSTRAP_TOPIC, 'utf-8');
            }
            if (!fs.existsSync(memoryPath)) {
                fs.writeFileSync(memoryPath, DEFAULT_MEMORY_TEMPLATE, 'utf-8');
            }

            memoryIndex = fs.readFileSync(memoryPath, 'utf-8');
            if (process.env.DEBUG === 'true') {
                console.log(`\n${CONFIG.C?.yellow || ''}[DEBUG] Memory Index injetado (${memoryIndex.length} bytes)${CONFIG.C?.reset || ''}`);
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
