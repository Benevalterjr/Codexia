/**
 * 🧪 Codexia — Testes de Context Collapse
 * 
 * Verifica se o histórico é comprimido corretamente via IA.
 */

const ChatUseCase = require('../../../src/application/use-cases/ChatUseCase');

describe('ChatUseCase Context Collapse', () => {
    let uc, deps;

    beforeEach(() => {
        deps = {
            sessionRepo: { load: jest.fn(), save: jest.fn() },
            tokenRepo: { load: jest.fn(), save: jest.fn(), isExpired: jest.fn() },
            aiGateway: { 
                sendMessage: jest.fn(),
                summarize: jest.fn()
            },
            authGateway: { refreshAccessToken: jest.fn() }
        };
        uc = new ChatUseCase(deps.sessionRepo, deps.tokenRepo, deps.aiGateway, deps.authGateway);
        jest.clearAllMocks();
    });

    test('deve disparar _collapseHistory quando o histórico exceder MAX_CONTEXT_CHARS', async () => {
        // Popular histórico com 40 mensagens (20 pares user/assistant)
        for (let i = 0; i < 20; i++) {
            uc.state.conversationHistory.push({ role: 'user', content: [{ text: 'u'.repeat(2000) }] });
            uc.state.conversationHistory.push({ role: 'assistant', content: [{ text: 'a'.repeat(2000) }] });
        }

        expect(uc.state.conversationHistory.length).toBe(40);

        // Mock do sumário da IA
        deps.aiGateway.summarize.mockResolvedValue('Resumo das primeiras 20 mensagens');

        // Adicionar a 41ª e 42ª mensagem (um novo par)
        uc.state.currentModel = 'gpt-5.1-codex';
        await uc.updateStateFromResponse('pergunta final', 'resposta final', 'resp_123', 'tok_abc');

        // Deve ter chamado summarize para as primeiras 20 mensagens
        expect(deps.aiGateway.summarize).toHaveBeenCalled();
        
        // O histórico deve agora conter:
        // 1. O bloco de collapse (1 msg)
        // 2. As 20 mensagens restantes do histórico original (40 - 20 = 20)
        // 3. O novo par user/assistant (2 msgs)
        // Total esperado: 1 + 20 + 2 = 23
        expect(uc.state.conversationHistory.length).toBe(23);
        expect(uc.state.conversationHistory[0].content[0].text).toContain('[CONTEXT COLLAPSE: ANTERIOR]');
        expect(uc.state.conversationHistory[0].content[0].text).toContain('Resumo das primeiras 20 mensagens');
    });

    test('deve usar fallback (slice) se o summarize falhar', async () => {
        for (let i = 0; i < 20; i++) {
            uc.state.conversationHistory.push({ role: 'user', content: [{ text: 'u'.repeat(2000) }] });
            uc.state.conversationHistory.push({ role: 'assistant', content: [{ text: 'a'.repeat(2000) }] });
        }

        // Simular falha na API de resumo
        deps.aiGateway.summarize.mockResolvedValue(null);

        uc.state.currentModel = 'gpt-5.1-codex';
        await uc.updateStateFromResponse('msg', 'resp', 'id', 'tok');

        // Deve ter feito o slice das últimas 20
        // (42 mensagens totais, slice das últimas 20 = 20)
        expect(uc.state.conversationHistory.length).toBe(20);
        expect(uc.state.conversationHistory[0].content[0].text).not.toContain('CONTEXT COLLAPSE');
    });
});
