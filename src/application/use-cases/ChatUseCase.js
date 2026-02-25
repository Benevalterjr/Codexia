const { CONFIG } = require('../../domain/constants');

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

    updateStateFromResponse(userMsg, aiText, responseId) {
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
            
            if (this.state.conversationHistory.length > 40) {
                this.state.conversationHistory = this.state.conversationHistory.slice(-40);
            }
        }
        this.saveSession();
    }

    async sendMessage(accessToken, userMessage, model = this.state.currentModel, previousResponseId = this.state.lastResponseId) {
        const isCodex = model.endsWith('-codex') || model.startsWith('codex');
        const defaultInstructions = "Você é um assistente de terminal útil e amigável. Responda de forma clara e direta.";

        const body = {
            model: model,
            instructions: defaultInstructions,
            stream: true,
        };

        if (isCodex) {
            body.input = [
                {
                    role: "system",
                    content: [{ type: "input_text", text: defaultInstructions }]
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
