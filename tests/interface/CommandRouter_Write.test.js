/**
 * 🧪 Codexia — Testes do Comando /write
 * 
 * Verifica a criação de arquivos e segurança de escrita.
 */

const { handleCommand } = require('../../src/interface/CommandRouter');
const fs = require('fs');
const path = require('path');

describe('CommandRouter /write', () => {
    let deps, appState, mockRl, logSpy, errorSpy;

    beforeEach(() => {
        deps = {
            C: { reset: '', bold: '', dim: '', green: '', red: '', yellow: '', magenta: '', cyan: '' },
            CONFIG: { DEFAULT_MODEL: 'gpt-4o', VALID_MODELS: ['gpt-4o'] },
            chatUseCase: { setModel: jest.fn(), state: { currentModel: 'gpt-4o' } },
            content: "Conteúdo de teste",
            handleDeviceAuth: jest.fn(),
            tokenRepo: { delete: jest.fn() },
            printHelp: jest.fn(),
            printTokenInfo: jest.fn()
        };
        mockRl = { prompt: jest.fn() };
        appState = { isMultiline: false, multilineBuffer: [] };
        
        logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        
        // Spy on FS methods
        jest.spyOn(fs, 'existsSync').mockImplementation(() => false);
        jest.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
        jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
        jest.spyOn(fs, 'lstatSync').mockImplementation(() => ({ isDirectory: () => false }));
        
        // Spy on Path methods
        jest.spyOn(path, 'resolve').mockImplementation((p) => p.includes('..') ? 'G:\\ext\\file' : `G:\\workspace\\${p}`);
        jest.spyOn(path, 'relative').mockImplementation((base, p) => p.includes('G:\\ext') ? '..\\ext' : 'file');
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('deve escrever um arquivo no workspace com sucesso', async () => {
        fs.existsSync.mockReturnValue(true);
        
        await handleCommand('/write', ['test.md'], mockRl, appState, deps);

        expect(fs.writeFileSync).toHaveBeenCalledWith(expect.stringContaining('test.md'), "Conteúdo de teste", 'utf-8');
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Arquivo escrito com sucesso'));
    });

    test('deve criar diretório pai se não existir', async () => {
        fs.existsSync.mockReturnValue(false); 
        
        await handleCommand('/write', ['memory/new-topic.md'], mockRl, appState, deps);

        expect(fs.mkdirSync).toHaveBeenCalledWith(expect.stringContaining('memory'), { recursive: true });
        expect(fs.writeFileSync).toHaveBeenCalled();
    });

    test('deve bloquear escrita externa sem o parâmetro --force', async () => {
        await handleCommand('/write', ['../ext/config.json'], mockRl, appState, deps);

        expect(fs.writeFileSync).not.toHaveBeenCalled();
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('AVISO DE SEGURANÇA'));
    });

    test('deve permitir escrita externa com o parâmetro --force', async () => {
        fs.existsSync.mockReturnValue(true);
        
        await handleCommand('/write', ['../ext/config.json', '--force'], mockRl, appState, deps);

        expect(fs.writeFileSync).toHaveBeenCalled();
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[AUDIT] Escrita externa autorizada'));
    });
});
