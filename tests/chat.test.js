/**
 * 🧪 Codexia — Suíte de Testes do Controller (chat.js)
 *
 * Cobre:
 *   - Funções puras de UI (printBanner, printHelp)
 *   - Parser de stream SSE (streamResponse)
 *   - Factory createApp: handleCommand, processInput, getOrAuthToken, handleDeviceAuth
 */

const readline = require('readline');
const { createApp, printBanner, printHelp, streamResponse } = require('../chat');
const { TextEncoder } = require('util');

// ───────────────── HELPERS ─────────────────

function createMockDeps(overrides = {}) {
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
        },
        automationUseCase: {
            execute: jest.fn(),
        },
        authGateway: {
            requestUserCode: jest.fn(),
            pollForToken: jest.fn(),
            exchangeCodeForTokens: jest.fn(),
            refreshAccessToken: jest.fn(),
        },
        browserGateway: {
            fetchPageContent: jest.fn(),
            close: jest.fn(),
        },
        ...overrides,
    };
}

/** Cria um ReadableStream mock a partir de chunks de texto */
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

/** Cria output mock para capturar writes */
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

    beforeEach(() => {
        logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        logSpy.mockRestore();
    });

    test('printBanner deve renderizar sem erros e incluir o modelo', () => {
        printBanner('gpt-5.1-codex');
        const output = logSpy.mock.calls.map(c => c[0]).join('\n');
        expect(output).toContain('Codexia Engine');
        expect(output).toContain('gpt-5.1-codex');
    });

    test('printHelp deve listar todos os comandos', () => {
        printHelp();
        const output = logSpy.mock.calls.map(c => c[0]).join('\n');
        expect(output).toContain('/help');
        expect(output).toContain('/model');
        expect(output).toContain('/new');
        expect(output).toContain('/tokens');
        expect(output).toContain('/reauth');
        expect(output).toContain('/paste');
        expect(output).toContain('/fetch');
        expect(output).toContain('/read');
        expect(output).toContain('/run');
        expect(output).toContain('/exit');
    });
});

// ─────────────────────────────────────────────────────────────

describe('streamResponse — SSE Parser', () => {
    test('deve parsear eventos de delta de texto corretamente', async () => {
        const output = createMockOutput();
        const stream = createMockStream([
            'data: {"type":"response.output_text.delta","delta":"Hello"}\n',
            'data: {"type":"response.output_text.delta","delta":" World"}\n',
            'data: [DONE]\n',
        ]);

        const result = await streamResponse(stream, output);
        expect(result.text).toBe('Hello World');
    });

    test('deve extrair responseId de response.completed', async () => {
        const output = createMockOutput();
        const stream = createMockStream([
            'data: {"type":"response.output_text.delta","delta":"Hi"}\n',
            'data: {"type":"response.completed","response":{"id":"resp_abc123"}}\n',
            'data: [DONE]\n',
        ]);

        const result = await streamResponse(stream, output);
        expect(result.responseId).toBe('resp_abc123');
        expect(result.text).toBe('Hi');
    });

    test('deve extrair responseId de campo id com prefixo resp_', async () => {
        const output = createMockOutput();
        const stream = createMockStream([
            'data: {"id":"resp_xyz","type":"response.output_text.delta","delta":"test"}\n',
            'data: [DONE]\n',
        ]);

        const result = await streamResponse(stream, output);
        expect(result.responseId).toBe('resp_xyz');
    });

    test('deve lidar com delta string sem type (formato alternativo)', async () => {
        const output = createMockOutput();
        const stream = createMockStream([
            'data: {"delta":"bare delta"}\n',
            'data: [DONE]\n',
        ]);

        const result = await streamResponse(stream, output);
        expect(result.text).toBe('bare delta');
    });

    test('deve extrair resposta de fallback via response.completed output', async () => {
        const output = createMockOutput();
        const stream = createMockStream([
            'data: {"type":"response.completed","response":{"id":"resp_fb","output":[{"type":"message","content":[{"type":"output_text","text":"fallback text"}]}]}}\n',
            'data: [DONE]\n',
        ]);

        const result = await streamResponse(stream, output);
        expect(result.text).toBe('fallback text');
        expect(result.responseId).toBe('resp_fb');
    });

    test('deve reportar erros de stream da API', async () => {
        const output = createMockOutput();
        const stream = createMockStream([
            'data: {"type":"error","error":{"message":"rate limit exceeded"}}\n',
            'data: [DONE]\n',
        ]);

        await streamResponse(stream, output);
        expect(output.getFullOutput()).toContain('rate limit exceeded');
    });

    test('deve tratar erros de rede no stream (não-aborted)', async () => {
        const output = createMockOutput();
        const stream = {
            getReader: () => ({
                read: async () => { throw new Error('network failure'); },
            }),
        };

        const result = await streamResponse(stream, output);
        expect(result.text).toBe('');
        expect(output.getFullOutput()).toContain('network failure');
    });

    test('deve ignorar erros abortados silenciosamente', async () => {
        const output = createMockOutput();
        const stream = {
            getReader: () => ({
                read: async () => { throw new Error('request was aborted'); },
            }),
        };

        const result = await streamResponse(stream, output);
        expect(result.text).toBe('');
        expect(output.getFullOutput()).not.toContain('Erro no stream');
    });

    test('deve ignorar JSON malformado no SSE sem crashar', async () => {
        const output = createMockOutput();
        const stream = createMockStream([
            'data: {invalid json}\n',
            'data: {"type":"response.output_text.delta","delta":"after error"}\n',
            'data: [DONE]\n',
        ]);

        const result = await streamResponse(stream, output);
        expect(result.text).toBe('after error');
    });

    test('deve retornar texto vazio para stream vazio', async () => {
        const output = createMockOutput();
        const stream = createMockStream([]);

        const result = await streamResponse(stream, output);
        expect(result.text).toBe('');
        expect(result.responseId).toBeNull();
    });

    test('deve lidar com chunks parciais entre leituras', async () => {
        const output = createMockOutput();
        // O SSE chega dividido em dois chunks — a segunda metade da linha chega no segundo read
        const stream = createMockStream([
            'data: {"type":"response.output_text.del',
            'ta","delta":"split"}\ndata: [DONE]\n',
        ]);

        const result = await streamResponse(stream, output);
        expect(result.text).toBe('split');
    });

    test('deve parsear linhas SSE no formato data: sem espaço', async () => {
        const output = createMockOutput();
        const stream = createMockStream([
            'data:{"type":"response.output_text.delta","delta":"ok"}\n',
            'data:[DONE]\n',
        ]);

        const result = await streamResponse(stream, output);
        expect(result.text).toBe('ok');
    });
});

// ─────────────────────────────────────────────────────────────

describe('createApp', () => {
    let deps, app, logSpy, errorSpy, exitSpy, writeSpy;

    beforeEach(() => {
        deps = createMockDeps();
        app = createApp(deps);
        logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
        writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => {});
    });

    afterEach(() => {
        logSpy.mockRestore();
        errorSpy.mockRestore();
        exitSpy.mockRestore();
        writeSpy.mockRestore();
    });

    // ── getOrAuthToken ──────────────────────────────────

    describe('getOrAuthToken', () => {
        test('deve retornar token válido do chatUseCase', async () => {
            deps.chatUseCase.ensureValidToken.mockResolvedValue('tok_valid');

            const token = await app.getOrAuthToken();
            expect(token).toBe('tok_valid');
            expect(deps.chatUseCase.ensureValidToken).toHaveBeenCalledWith(false);
        });

        test('deve forçar refresh quando solicitado', async () => {
            deps.chatUseCase.ensureValidToken.mockResolvedValue('tok_refreshed');

            const token = await app.getOrAuthToken(true);
            expect(deps.chatUseCase.ensureValidToken).toHaveBeenCalledWith(true);
            expect(token).toBe('tok_refreshed');
        });

        test('deve disparar device auth quando não há token válido', async () => {
            deps.chatUseCase.ensureValidToken.mockResolvedValue(null);
            deps.authGateway.requestUserCode.mockResolvedValue({
                user_code: 'ABC-123',
                device_auth_id: 'dev_1',
                interval: 1,
            });
            deps.authGateway.pollForToken.mockResolvedValue({
                authorization_code: 'auth_code',
                code_verifier: 'verifier',
            });
            deps.authGateway.exchangeCodeForTokens.mockResolvedValue({
                access_token: 'tok_new',
                expires_in: 3600,
            });
            deps.tokenRepo.save.mockReturnValue({
                access_token: 'tok_new',
                expires_at: Date.now() + 3600000,
            });

            const token = await app.getOrAuthToken();
            expect(token).toBe('tok_new');
            expect(deps.authGateway.requestUserCode).toHaveBeenCalled();
        });
    });

    // ── handleDeviceAuth (Bug Fix Validation) ───────────

    describe('handleDeviceAuth', () => {
        test('deve chamar requestUserCode e completar o fluxo com sucesso', async () => {
            deps.authGateway.requestUserCode.mockResolvedValue({
                user_code: 'TEST-CODE',
                device_auth_id: 'dev_123',
                interval: 1,
            });
            deps.authGateway.pollForToken.mockResolvedValue({
                authorization_code: 'auth_xyz',
                code_verifier: 'verify_abc',
            });
            deps.authGateway.exchangeCodeForTokens.mockResolvedValue({
                access_token: 'tok_device',
                expires_in: 7200,
            });
            deps.tokenRepo.save.mockReturnValue({
                access_token: 'tok_device',
                expires_at: Date.now() + 7200000,
            });

            const token = await app.handleDeviceAuth();

            expect(deps.authGateway.requestUserCode).toHaveBeenCalledTimes(1);
            expect(deps.authGateway.pollForToken).toHaveBeenCalledWith('dev_123', 'TEST-CODE');
            expect(deps.authGateway.exchangeCodeForTokens).toHaveBeenCalledWith('auth_xyz', 'verify_abc');
            expect(token).toBe('tok_device');
        });

        test('deve retornar null quando requestUserCode falha', async () => {
            deps.authGateway.requestUserCode.mockRejectedValue(new Error('network error'));

            const token = await app.handleDeviceAuth();
            expect(token).toBeNull();
        });

        test('deve usar campo usercode (alternativo) quando user_code ausente', async () => {
            deps.authGateway.requestUserCode.mockResolvedValue({
                usercode: 'ALT-CODE',
                device_auth_id: 'dev_alt',
                interval: '1', // String interval — testa parseInt
            });
            deps.authGateway.pollForToken.mockResolvedValue({
                authorization_code: 'auth_alt',
                code_verifier: 'verify_alt',
            });
            deps.authGateway.exchangeCodeForTokens.mockResolvedValue({
                access_token: 'tok_alt',
                expires_in: 3600,
            });
            deps.tokenRepo.save.mockReturnValue({
                access_token: 'tok_alt',
                expires_at: Date.now() + 3600000,
            });

            const token = await app.handleDeviceAuth();
            expect(deps.authGateway.pollForToken).toHaveBeenCalledWith('dev_alt', 'ALT-CODE');
            expect(token).toBe('tok_alt');
        });

        test('deve interromper polling e retornar null em caso de erro 401 (Não autorizado)', async () => {
            deps.authGateway.requestUserCode.mockResolvedValue({
                user_code: 'TEST-CODE',
                device_auth_id: 'dev_123',
                interval: 1,
            });
            
            // Simular erro 401 no primeiro poll
            const authError = new Error('Unauthorized');
            authError.status = 401;
            deps.authGateway.pollForToken.mockRejectedValue(authError);
            
            const token = await app.handleDeviceAuth();
            
            expect(token).toBeNull();
            expect(deps.authGateway.pollForToken).toHaveBeenCalledTimes(1); // Interrompeu no primeiro
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Falha crítica no polling (401)'));
        });
    });

    // ── handleCommand ───────────────────────────────────

    describe('handleCommand', () => {
        let mockRl, appState;

        beforeEach(() => {
            mockRl = { prompt: jest.fn() };
            appState = { isMultiline: false, multilineBuffer: [] };
        });

        test('/help deve exibir menu de ajuda', async () => {
            await app.handleCommand('/help', [], mockRl, appState);
            const output = logSpy.mock.calls.map(c => c[0]).join('\n');
            expect(output).toContain('/help');
            expect(output).toContain('/model');
        });

        test('/h deve funcionar como alias de /help', async () => {
            await app.handleCommand('/h', [], mockRl, appState);
            const output = logSpy.mock.calls.map(c => c[0]).join('\n');
            expect(output).toContain('Comandos disponíveis');
        });

        test('/new deve resetar a sessão', async () => {
            await app.handleCommand('/new', [], mockRl, appState);
            expect(deps.chatUseCase.resetSession).toHaveBeenCalledTimes(1);
        });

        test('/clear deve funcionar como alias de /new', async () => {
            await app.handleCommand('/clear', [], mockRl, appState);
            expect(deps.chatUseCase.resetSession).toHaveBeenCalledTimes(1);
        });

        test('/model sem args deve mostrar modelo atual', async () => {
            await app.handleCommand('/model', [], mockRl, appState);
            const output = logSpy.mock.calls.map(c => c[0]).join('\n');
            expect(output).toContain('gpt-5.1-codex');
        });

        test('/model com arg deve trocar o modelo', async () => {
            await app.handleCommand('/model', ['gpt-4.1'], mockRl, appState);
            expect(deps.chatUseCase.setModel).toHaveBeenCalledWith('gpt-4.1');
        });

        test('/paste deve ativar modo multiline', async () => {
            await app.handleCommand('/paste', [], mockRl, appState);
            expect(appState.isMultiline).toBe(true);
            expect(appState.multilineBuffer).toEqual([]);
        });

        test('/multiline deve funcionar como alias de /paste', async () => {
            await app.handleCommand('/multiline', [], mockRl, appState);
            expect(appState.isMultiline).toBe(true);
        });

        test('/tokens deve exibir informações de token', async () => {
            deps.tokenRepo.load.mockReturnValue({
                expires_at: Date.now() + 100000,
                obtained_at: new Date().toISOString(),
                method: 'device_code_flow',
            });
            deps.tokenRepo.isExpired.mockReturnValue(false);

            await app.handleCommand('/tokens', [], mockRl, appState);
            expect(deps.tokenRepo.load).toHaveBeenCalled();
            const output = logSpy.mock.calls.map(c => c[0]).join('\n');
            expect(output).toContain('VÁLIDO');
        });

        test('/tokens sem tokens deve informar ausência', async () => {
            deps.tokenRepo.load.mockReturnValue(null);

            await app.handleCommand('/tokens', [], mockRl, appState);
            const output = logSpy.mock.calls.map(c => c[0]).join('\n');
            expect(output).toContain('Sem tokens salvos');
        });

        test('/run sem args deve mostrar uso', async () => {
            await app.handleCommand('/run', [], mockRl, appState);
            const output = logSpy.mock.calls.map(c => c[0]).join('\n');
            expect(output).toContain('Uso:');
        });

        test('/fetch sem args deve mostrar uso', async () => {
            await app.handleCommand('/fetch', [], mockRl, appState);
            const output = logSpy.mock.calls.map(c => c[0]).join('\n');
            expect(output).toContain('Uso:');
        });

        test('/read sem args deve mostrar uso', async () => {
            await app.handleCommand('/read', [], mockRl, appState);
            const output = logSpy.mock.calls.map(c => c[0]).join('\n');
            expect(output).toContain('Uso:');
        });

        test('/exit deve fechar browser e encerrar processo', async () => {
            deps.browserGateway.close.mockResolvedValue();

            await app.handleCommand('/exit', [], mockRl, appState);
            expect(deps.browserGateway.close).toHaveBeenCalled();
            expect(exitSpy).toHaveBeenCalledWith(0);
        });

        test('/quit e /q devem funcionar como alias de /exit', async () => {
            deps.browserGateway.close.mockResolvedValue();

            await app.handleCommand('/quit', [], mockRl, appState);
            expect(exitSpy).toHaveBeenCalledWith(0);

            exitSpy.mockClear();
            deps.browserGateway.close.mockClear();

            await app.handleCommand('/q', [], mockRl, appState);
            expect(exitSpy).toHaveBeenCalledWith(0);
        });

        test('/reauth deve deletar tokens, reautenticar e resetar sessão', async () => {
            // Device auth vai falhar rápido para simplificar o teste
            deps.authGateway.requestUserCode.mockRejectedValue(new Error('fail'));

            await app.handleCommand('/reauth', [], mockRl, appState);

            expect(deps.tokenRepo.delete).toHaveBeenCalled();
            expect(deps.chatUseCase.resetSession).toHaveBeenCalled();
            expect(deps.authGateway.requestUserCode).toHaveBeenCalled();
        });

        test('comando desconhecido deve exibir erro', async () => {
            await app.handleCommand('/blabla', [], mockRl, appState);
            const output = logSpy.mock.calls.map(c => c[0]).join('\n');
            expect(output).toContain('Comando desconhecido');
            expect(output).toContain('/blabla');
        });
    });

    // ── processInput ────────────────────────────────────

    describe('processInput', () => {
        let mockRl;

        beforeEach(() => {
            mockRl = { prompt: jest.fn(), question: jest.fn((q, cb) => cb('n')) };
        });

        test('deve enviar mensagem e processar stream com sucesso', async () => {
            deps.chatUseCase.ensureValidToken.mockResolvedValue('tok_valid');
            const mockStream = createMockStream([
                'data: {"type":"response.output_text.delta","delta":"Resposta"}\n',
                'data: [DONE]\n',
            ]);
            deps.chatUseCase.sendMessage.mockResolvedValue({ stream: mockStream });

            await app.processInput('olá mundo', mockRl);

            expect(deps.chatUseCase.sendMessage).toHaveBeenCalledWith('tok_valid', 'olá mundo');
            expect(deps.chatUseCase.updateStateFromResponse).toHaveBeenCalledWith(
                'olá mundo',
                'Resposta',
                null,
                'tok_valid'
            );
            expect(mockRl.prompt).toHaveBeenCalled();
        });

        test('deve tratar erro genérico da API', async () => {
            deps.chatUseCase.ensureValidToken.mockResolvedValue('tok_valid');
            deps.chatUseCase.sendMessage.mockResolvedValue({
                error: 'api_error',
                status: 500,
                message: 'Internal Server Error',
            });

            await app.processInput('hello', mockRl);

            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Internal Server Error'));
            expect(mockRl.prompt).toHaveBeenCalled();
        });

        test('deve fazer retry com token novo quando token expira', async () => {
            deps.chatUseCase.ensureValidToken
                .mockResolvedValueOnce('tok_old')
                .mockResolvedValueOnce('tok_new');

            const mockStream = createMockStream(['data: [DONE]\n']);
            deps.chatUseCase.sendMessage
                .mockResolvedValueOnce({ error: 'token_expired', message: 'expired' })
                .mockResolvedValueOnce({ stream: mockStream });

            await app.processInput('hello', mockRl);

            expect(deps.chatUseCase.sendMessage).toHaveBeenCalledTimes(2);
            expect(deps.chatUseCase.sendMessage).toHaveBeenNthCalledWith(1, 'tok_old', 'hello');
            expect(deps.chatUseCase.sendMessage).toHaveBeenNthCalledWith(2, 'tok_new', 'hello');
            expect(mockRl.prompt).toHaveBeenCalled();
        });

        test('deve falhar graciosamente quando nenhum token disponível', async () => {
            deps.chatUseCase.ensureValidToken.mockResolvedValue(null);
            deps.authGateway.requestUserCode.mockRejectedValue(new Error('no auth'));

            await app.processInput('hello', mockRl);

            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Não foi possível obter token'));
            expect(deps.chatUseCase.sendMessage).not.toHaveBeenCalled();
            expect(mockRl.prompt).toHaveBeenCalled();
        });

        test('deve falhar quando retry de token também falha', async () => {
            deps.chatUseCase.ensureValidToken
                .mockResolvedValueOnce('tok_old')
                .mockResolvedValueOnce(null);
            deps.chatUseCase.sendMessage.mockResolvedValueOnce({
                error: 'token_expired',
                message: 'expired',
            });
            deps.authGateway.requestUserCode.mockRejectedValue(new Error('no auth'));

            await app.processInput('hello', mockRl);

            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('reautenticação falhou'));
            expect(deps.chatUseCase.sendMessage).toHaveBeenCalledTimes(1);
            expect(mockRl.prompt).toHaveBeenCalled();
        });

        test('deve detectar comando agentic /write no formato code block e ignorar texto explicativo', async () => {
            deps.chatUseCase.ensureValidToken.mockResolvedValue('tok_valid');
            const agenticResponse = 'Vou salvar seu arquivo:\n\n```write memory/test.md\nConteúdo ultra secreto!\n```\nTexto explicativo que deve ser ignorado.';
            const mockStream = createMockStream([
                `data: {"type":"response.output_text.delta","delta":${JSON.stringify(agenticResponse)}}\n`,
                'data: [DONE]\n',
            ]);
            deps.chatUseCase.sendMessage.mockResolvedValue({ stream: mockStream });
            
            // Simular autorização (responder 'y')
            mockRl.question = jest.fn((q, cb) => cb('y'));

            await app.processInput('salve o arquivo test', mockRl);

            // Verificar se o agente foi detetado e se o log apareceu
            const logCalls = logSpy.mock.calls.map(call => call[0]);
            const hasAgentLog = logCalls.some(log => log.includes('AGENTE:') && log.includes('memory/test.md'));
            const hasPreviewLog = logCalls.some(log => log.includes('Preview (23 chars):'));

            expect(hasAgentLog).toBe(true);
            expect(hasPreviewLog).toBe(true);
        });

        test('deve ignorar /write inline para evitar falso positivo', async () => {
            deps.chatUseCase.ensureValidToken.mockResolvedValue('tok_valid');
            const agenticInline = '/write ../inline.md\nLinha 1\nLinha 2';
            const mockStream = createMockStream([
                `data: {"type":"response.output_text.delta","delta":${JSON.stringify(agenticInline)}}\n`,
                'data: [DONE]\n',
            ]);
            deps.chatUseCase.sendMessage.mockResolvedValue({ stream: mockStream });
            mockRl.question = jest.fn((q, cb) => cb('y'));

            await app.processInput('salve inline', mockRl);

            const logCalls = logSpy.mock.calls.map(call => call[0]);
            const hasAgentLog = logCalls.some(log => log.includes('AGENTE:') && log.includes('../inline.md'));
            expect(hasAgentLog).toBe(false);
        });

        test('deve detectar comando /write dentro de bloco ```bash``` e solicitar autorização exatamente 1 vez', async () => {
            deps.chatUseCase.ensureValidToken.mockResolvedValue('tok_valid');
            const payload = '```bash\n/write ../bash-write.md\nconteudo vindo do bloco bash\n```';
            const mockStream = createMockStream([
                `data: {"type":"response.output_text.delta","delta":${JSON.stringify(payload)}}\n`,
                'data: [DONE]\n',
            ]);
            deps.chatUseCase.sendMessage.mockResolvedValue({ stream: mockStream });
            mockRl.question = jest.fn((q, cb) => cb('y'));

            await app.processInput('teste bash write', mockRl);

            const logCalls = logSpy.mock.calls.map(call => call[0]);
            const hasAgentLog = logCalls.some(log => log.includes('AGENTE:') && log.includes('../bash-write.md'));
            expect(hasAgentLog).toBe(true);
            // REGRESSION: autorização deve ser pedida exatamente 1 vez (sem duplicação)
            expect(mockRl.question).toHaveBeenCalledTimes(1);
        });

        test('deve deduplicar /write para o mesmo path em formatos diferentes', async () => {
            deps.chatUseCase.ensureValidToken.mockResolvedValue('tok_valid');
            // Mesmo path em dois formatos: ```bash /write e ```write
            const payload = '```bash\n/write memory/dup.md\nconteudo bash\n```\n\n```write memory/dup.md\nconteudo write\n```';
            const mockStream = createMockStream([
                `data: {"type":"response.output_text.delta","delta":${JSON.stringify(payload)}}\n`,
                'data: [DONE]\n',
            ]);
            deps.chatUseCase.sendMessage.mockResolvedValue({ stream: mockStream });
            mockRl.question = jest.fn((q, cb) => cb('y'));

            await app.processInput('teste dedup', mockRl);

            // Deve solicitar autorização apenas 1 vez (deduplicado por path)
            expect(mockRl.question).toHaveBeenCalledTimes(1);
        });

        test('deve ignorar path inválido de /write sugerido pelo agente', async () => {
            deps.chatUseCase.ensureValidToken.mockResolvedValue('tok_valid');
            const payload = '```write <path>\nconteudo invalido\n```';
            const mockStream = createMockStream([
                `data: {"type":"response.output_text.delta","delta":${JSON.stringify(payload)}}\n`,
                'data: [DONE]\n',
            ]);
            deps.chatUseCase.sendMessage.mockResolvedValue({ stream: mockStream });
            mockRl.question = jest.fn((q, cb) => cb('y'));

            await app.processInput('teste path invalido', mockRl);

            const output = logSpy.mock.calls.map(c => c[0]).join('\n');
            expect(output).toContain('path inválido ignorado');
        });

        test('não deve inferir --force a partir do conteúdo do bloco agentic', async () => {
            deps.chatUseCase.ensureValidToken.mockResolvedValue('tok_valid');
            const payload = '```write ../fora.txt\nconteudo normal com token textual --force dentro\n```';
            const mockStream = createMockStream([
                `data: {"type":"response.output_text.delta","delta":${JSON.stringify(payload)}}\n`,
                'data: [DONE]\n',
            ]);
            deps.chatUseCase.sendMessage.mockResolvedValue({ stream: mockStream });
            mockRl.question = jest.fn((q, cb) => cb('y'));

            await app.processInput('teste force', mockRl);

            const output = logSpy.mock.calls.map(c => c[0]).join('\n');
            expect(output).toContain('Tentativa de escrita fora do workspace');
            expect(output).not.toContain('Escrita externa autorizada via --force');
        });

        test('deve ignorar entradas paralelas (backpressure) no loop principal', async () => {
            const rlOn = jest.fn();
            const rlPrompt = jest.fn();
            const mockRl = { 
                on: rlOn, 
                prompt: rlPrompt, 
                close: jest.fn(),
                pause: jest.fn(),
                resume: jest.fn()
            };
            const createInterfaceSpy = jest.spyOn(readline, 'createInterface').mockReturnValue(mockRl);
            
            // Mock do token para o start() passar
            deps.chatUseCase.ensureValidToken.mockResolvedValue('tok_valid');
            deps.tokenRepo.load.mockReturnValue({ expires_at: Date.now() + 10000 });

            // Iniciar o app (isso vai registrar o handler de 'line')
            const startPromise = app.start(); 

            // Aguardar a inicialização do readline (polling para evitar race conditions no async)
            let lineHandler;
            const initStartTime = Date.now();
            while (!lineHandler && Date.now() - initStartTime < 1000) {
                await new Promise(resolve => setImmediate(resolve));
                const lineCall = rlOn.mock.calls.find(c => c[0] === 'line');
                if (lineCall) lineHandler = lineCall[1];
            }

            if (!lineHandler) {
                throw new Error('Handler de "line" não foi registrado a tempo no start()');
            }
            
            // Simular um processamento longo no sendMessage
            let resolveFirstMessage;
            const longPromise = new Promise(r => { resolveFirstMessage = r; });
            deps.chatUseCase.sendMessage.mockReturnValue(longPromise);
            
            // Disparar primeira linha (isso deve travar o isProcessing síncronamente)
            const p1 = lineHandler('mensagem 1');
            
            // Aguardar um tick para p1 chegar no sendMessage (que está travado pelo longPromise)
            await new Promise(resolve => setImmediate(resolve));
            
            // Disparar segunda linha imediatamente (deve ser ignorada pois isProcessing é true)
            const p2 = lineHandler('mensagem 2');
            
            expect(deps.chatUseCase.sendMessage).toHaveBeenCalledTimes(1);
            expect(deps.chatUseCase.sendMessage).toHaveBeenCalledWith('tok_valid', 'mensagem 1');
            
            // Liberar a primeira mensagem
            resolveFirstMessage({ stream: createMockStream(['data: [DONE]\n']) });
            await p1;
            await p2;
            
            // O sendMessage NÃO deve ter sido chamado para a segunda mensagem
            expect(deps.chatUseCase.sendMessage).toHaveBeenCalledTimes(1);
            
            createInterfaceSpy.mockRestore();
        });

        test('start não deve quebrar quando tokenRepo.load retorna null', async () => {
            const rlOn = jest.fn();
            const rlPrompt = jest.fn();
            const mockRl = {
                on: rlOn,
                prompt: rlPrompt,
                close: jest.fn(),
                pause: jest.fn(),
                resume: jest.fn()
            };
            const createInterfaceSpy = jest.spyOn(readline, 'createInterface').mockReturnValue(mockRl);

            deps.chatUseCase.ensureValidToken.mockResolvedValue('tok_valid');
            deps.tokenRepo.load.mockReturnValue(null);

            await app.start();

            const output = logSpy.mock.calls.map(c => c[0]).join('\n');
            expect(output).toContain('metadados de expiração indisponíveis');
            createInterfaceSpy.mockRestore();
        });
    });

    // ── printTokenInfo ──────────────────────────────────

    describe('printTokenInfo', () => {
        test('deve exibir VÁLIDO para token não expirado', () => {
            deps.tokenRepo.load.mockReturnValue({
                expires_at: Date.now() + 3600000,
                obtained_at: new Date().toISOString(),
                method: 'device_code_flow',
            });
            deps.tokenRepo.isExpired.mockReturnValue(false);

            app.printTokenInfo();

            const output = logSpy.mock.calls.map(c => c[0]).join('\n');
            expect(output).toContain('VÁLIDO');
            expect(output).toContain('device_code_flow');
        });

        test('deve exibir EXPIRADO para token expirado', () => {
            deps.tokenRepo.load.mockReturnValue({
                expires_at: Date.now() - 1000,
                obtained_at: new Date().toISOString(),
                method: 'device_code_flow',
            });
            deps.tokenRepo.isExpired.mockReturnValue(true);

            app.printTokenInfo();

            const output = logSpy.mock.calls.map(c => c[0]).join('\n');
            expect(output).toContain('EXPIRADO');
        });

        test('deve informar ausência quando não há tokens', () => {
            deps.tokenRepo.load.mockReturnValue(null);

            app.printTokenInfo();

            const output = logSpy.mock.calls.map(c => c[0]).join('\n');
            expect(output).toContain('Sem tokens salvos');
        });
    });
});
