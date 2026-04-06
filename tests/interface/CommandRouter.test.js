/**
 * 🧪 Codexia — Testes do CommandRouter
 * 
 * Cobre a lógica de roteamento de comandos que foi extraída do chat.js.
 */

const { handleCommand } = require('../../src/interface/CommandRouter');
const path = require('path');
const fs = require('fs');

describe('CommandRouter', () => {
    let deps, mockRl, appState, logSpy, errorSpy;

    beforeEach(() => {
        deps = {
            C: {
                cyan: '', green: '', yellow: '', red: '', 
                white: '', magenta: '', dim: '', bold: '', reset: ''
            },
            CONFIG: {
                VALID_MODELS: ['gpt-5.1-codex', 'gpt-5.1', 'gpt-4.1']
            },
            chatUseCase: {
                state: { currentModel: 'gpt-5.1-codex' },
                resetSession: jest.fn(),
                setModel: jest.fn(),
                updateStateFromResponse: jest.fn()
            },
            automationUseCase: { execute: jest.fn() },
            tokenRepo: { delete: jest.fn() },
            authGateway: {},
            browserGateway: { 
                fetchPageContent: jest.fn(),
                close: jest.fn() 
            },
            streamResponse: jest.fn(),
            getOrAuthToken: jest.fn(),
            handleDeviceAuth: jest.fn(),
            printHelp: jest.fn(),
            printTokenInfo: jest.fn()
        };
        mockRl = { prompt: jest.fn() };
        appState = { isMultiline: false, multilineBuffer: [] };
        logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        logSpy.mockRestore();
        errorSpy.mockRestore();
        jest.restoreAllMocks();
    });

    test('/help deve chamar printHelp', async () => {
        await handleCommand('/help', [], mockRl, appState, deps);
        expect(deps.printHelp).toHaveBeenCalled();
    });

    describe('/model validation', () => {
        test('deve aceitar modelo válido', async () => {
            await handleCommand('/model', ['gpt-4.1'], mockRl, appState, deps);
            expect(deps.chatUseCase.setModel).toHaveBeenCalledWith('gpt-4.1');
            expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('✓ Modelo:'));
        });

        test('deve rejeitar modelo inválido', async () => {
            await handleCommand('/model', ['modelo-fantasma'], mockRl, appState, deps);
            expect(deps.chatUseCase.setModel).not.toHaveBeenCalled();
            expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('✗ Modelo inválido'));
            expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('gpt-5.1-codex, gpt-5.1, gpt-4.1'));
        });

        test('sem argumentos deve apenas mostrar o atual', async () => {
            await handleCommand('/model', [], mockRl, appState, deps);
            expect(deps.chatUseCase.setModel).not.toHaveBeenCalled();
            expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Modelo atual:'));
        });
    });

    describe('/read security audit', () => {
        test('deve logar [AUDIT] quando usar --force fora do workspace', async () => {
            // Em Windows, caminhos absolutos são sempre "fora" se o cwd for diferente
            // Ou usamos path.resolve('..')
            const externalPath = path.resolve('..', 'alguem.txt');
            
            // Mock de fs.existsSync e fs.lstatSync para não falhar no filesystem real
            jest.spyOn(fs, 'existsSync').mockReturnValue(true);
            jest.spyOn(fs, 'lstatSync').mockReturnValue({ isDirectory: () => false });
            jest.spyOn(fs, 'readFileSync').mockReturnValue('conteudo fake');

            await handleCommand('/read', [externalPath, '--force'], mockRl, appState, deps);

            expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[AUDIT] Acesso externo autorizado via --force'));
            expect(appState.isMultiline).toBe(true);
        });

        test('não deve logar [AUDIT] para arquivos locais', async () => {
            const localPath = 'local.txt';
            jest.spyOn(fs, 'existsSync').mockReturnValue(true);
            jest.spyOn(fs, 'lstatSync').mockReturnValue({ isDirectory: () => false });
            jest.spyOn(fs, 'readFileSync').mockReturnValue('conteudo fake');

            await handleCommand('/read', [localPath], mockRl, appState, deps);

            expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('[AUDIT]'));
        });
    });

    test('/tokens deve chamar printTokenInfo', async () => {
        await handleCommand('/tokens', [], mockRl, appState, deps);
        expect(deps.printTokenInfo).toHaveBeenCalled();
    });

    test('/reauth deve resetar sessão e disparar auth', async () => {
        await handleCommand('/reauth', [], mockRl, appState, deps);
        expect(deps.tokenRepo.delete).toHaveBeenCalled();
        expect(deps.handleDeviceAuth).toHaveBeenCalled();
        expect(deps.chatUseCase.resetSession).toHaveBeenCalled();
    });
});
