/**
 * 🧪 Codexia — Suíte de Testes do Controller (chat.js)
 *
 * Cobre:
 *   - Funções puras de UI (printBanner, printHelp)
 *   - Parser de stream SSE (AiGateway.streamResponse)
 *   - Factory createApp: processInput, getOrAuthToken, handleDeviceAuth
 */

const readline = require('readline');
const { createApp, printBanner, printHelp } = require('../chat');
const AiGateway = require('../src/infrastructure/gateways/AiGateway');
const { TextEncoder } = require('util');

// ───────────────── HELPERS ─────────────────

function createMockDeps(overrides = {}) {
    const aiGateway = new AiGateway();
    // No mock default para streamResponse aqui para permitir testes reais do parser
    
    return {
        tokenRepo: {
            load: jest.fn(),
            save: jest.fn(),
            delete: jest.fn(),
            isExpired: jest.fn(),
        },
        chatUseCase: {
            state: {
                currentModel: 'gpt-5.1-codex',
                lastResponseId: null,
                conversationHistory: [],
            },
            loadSession: jest.fn(),
            saveSession: jest.fn(),
            resetSession: jest.fn(),
            setModel: jest.fn(),
            sendMessage: jest.fn(),
            ensureValidToken: jest.fn(),
            updateStateFromResponse: jest.fn(),
            extractAgenticWrites: jest.fn().mockReturnValue([]),
        },
        automationUseCase: {
            execute: jest.fn(),
        },
        authGateway: {
            requestUserCode: jest.fn(),
            pollForToken: jest.fn(),
            exchangeCodeForTokens: jest.fn(),
            refreshAccessToken: jest.fn(),
            authenticateDevice: jest.fn(),
        },
        aiGateway,
        browserGateway: {
            fetchPageContent: jest.fn(),
            close: jest.fn(),
        },
        ...overrides,
    };
}

function createMockStream(chunks) {
    let index = 0;
    return {
        getReader: () => ({
            read: async () => {
                if (index >= chunks.length) return { done: true };
                const value = new TextEncoder().encode(chunks[index++]);
                return { done: false, value };
            },
        }),
    };
}

function createMockOutput() {
    const calls = [];
    return {
        write: jest.fn(text => calls.push(text)),
        getCalls: () => calls,
        getFullOutput: () => calls.join(''),
    };
}

// ───────────────── TESTS ─────────────────

describe('Pure UI Functions', () => {
    let logSpy;
    beforeEach(() => { logSpy = jest.spyOn(console, 'log').mockImplementation(() => {}); });
    afterEach(() => { logSpy.mockRestore(); });

    test('printBanner deve renderizar sem erros', () => {
        printBanner('gpt-5.1-codex');
        expect(logSpy.mock.calls[0][0]).toContain('Codexia Engine');
    });

    test('printHelp deve listar comandos', () => {
        printHelp();
        expect(logSpy.mock.calls[0][0]).toContain('/help');
    });
});

describe('AiGateway.streamResponse', () => {
    let gateway;
    beforeEach(() => { gateway = new AiGateway(); });

    test('deve parsear delta de texto', async () => {
        const out = createMockOutput();
        const stream = createMockStream(['data: {"type":"response.output_text.delta","delta":"Hello"}\n', 'data: [DONE]\n']);
        const res = await gateway.streamResponse(stream, out);
        expect(res.text).toBe('Hello');
    });

    test('deve extrair responseId', async () => {
        const out = createMockOutput();
        const stream = createMockStream(['data: {"id":"resp_123","delta":"x"}\n', 'data: [DONE]\n']);
        const res = await gateway.streamResponse(stream, out);
        expect(res.responseId).toBe('resp_123');
    });
});

describe('createApp', () => {
    let deps, app, logSpy, errorSpy, writeSpy;

    beforeEach(() => {
        deps = createMockDeps();
        app = createApp(deps);
        logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => {});
    });

    afterEach(() => {
        logSpy.mockRestore(); errorSpy.mockRestore(); writeSpy.mockRestore();
    });

    test('getOrAuthToken deve retornar token do use case', async () => {
        deps.chatUseCase.ensureValidToken.mockResolvedValue('tok_ok');
        const token = await app.getOrAuthToken();
        expect(token).toBe('tok_ok');
    });

    test('processInput deve coordenar envio e stream', async () => {
        deps.chatUseCase.ensureValidToken.mockResolvedValue('tok_ok');
        const mockStream = createMockStream(['data: {"delta":"resp"}\n', 'data: [DONE]\n']);
        deps.chatUseCase.sendMessage.mockResolvedValue({ stream: mockStream });
        const mockRl = { prompt: jest.fn(), question: jest.fn() };

        await app.processInput('oi', mockRl);

        expect(deps.chatUseCase.sendMessage).toHaveBeenCalledWith('tok_ok', 'oi');
        expect(deps.chatUseCase.updateStateFromResponse).toHaveBeenCalledWith('oi', 'resp', null, 'tok_ok');
    });

    test('printTokenInfo deve mostrar estado dos tokens', () => {
        deps.tokenRepo.load.mockReturnValue({
            expires_at: Date.now() + 10000,
            obtained_at: new Date().toISOString()
        });
        deps.tokenRepo.isExpired.mockReturnValue(false);

        app.printTokenInfo();
        const output = logSpy.mock.calls.join('\n');
        expect(output).toContain('VÁLIDO');
    });
});
