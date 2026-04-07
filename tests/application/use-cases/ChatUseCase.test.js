/**
 * 🧪 Codexia — Testes da Memória (ChatUseCase)
 * 
 * Verifica se o MEMORY.md é injetado corretamente nas instruções.
 */

const ChatUseCase = require('../../../src/application/use-cases/ChatUseCase');
const fs = require('fs');

jest.mock('fs', () => ({
    existsSync: jest.fn(),
    readFileSync: jest.fn(),
    writeFileSync: jest.fn(),
}));

describe('ChatUseCase Memory Injection', () => {
    let uc, deps;

    beforeEach(() => {
        deps = {
            sessionRepo: { load: jest.fn(), save: jest.fn() },
            tokenRepo: { load: jest.fn(), save: jest.fn(), isExpired: jest.fn() },
            aiGateway: { sendMessage: jest.fn() },
            authGateway: { refreshAccessToken: jest.fn() }
        };
        uc = new ChatUseCase(deps.sessionRepo, deps.tokenRepo, deps.aiGateway, deps.authGateway);
        jest.clearAllMocks();
    });

    test('deve injetar o conteúdo do MEMORY.md nas instruções quando o arquivo existir', async () => {
        const fakeMemory = "# Test Memory Index\n- [T1] Topic 1 : memory/t1.md";
        fs.existsSync.mockReturnValue(true);
        fs.readFileSync.mockReturnValue(fakeMemory);
        
        deps.aiGateway.sendMessage.mockResolvedValue({ stream: {} });

        await uc.sendMessage('token_123', 'Olá');

        expect(deps.aiGateway.sendMessage).toHaveBeenCalledWith(
            'token_123',
            expect.objectContaining({
                instructions: expect.stringContaining('--- 🧠 MEMORY INDEX (Contexto Permanente) ---'),
            })
        );
        expect(deps.aiGateway.sendMessage.mock.calls[0][1].instructions).toContain(fakeMemory);
    });

    test('não deve injetar bloco de memória quando o MEMORY.md não existir', async () => {
        fs.existsSync.mockReturnValue(false);
        deps.aiGateway.sendMessage.mockResolvedValue({ stream: {} });

        await uc.sendMessage('token_123', 'Olá');

        expect(deps.aiGateway.sendMessage).toHaveBeenCalled();
        const instructions = deps.aiGateway.sendMessage.mock.calls[0][1].instructions;
        expect(instructions).not.toContain('--- 🧠 MEMORY INDEX');
    });

    test('deve falhar graciosamente se houver erro na leitura do arquivo', async () => {
        fs.existsSync.mockReturnValue(true);
        fs.readFileSync.mockImplementation(() => { throw new Error('Permission denied'); });
        
        deps.aiGateway.sendMessage.mockResolvedValue({ stream: {} });

        await uc.sendMessage('token_123', 'Olá');

        expect(deps.aiGateway.sendMessage).toHaveBeenCalled();
        const instructions = deps.aiGateway.sendMessage.mock.calls[0][1].instructions;
        expect(instructions).not.toContain('--- 🧠 MEMORY INDEX');
    });

    test('deve criar MEMORY.md com template padrão quando não existir', async () => {
        fs.existsSync
            .mockReturnValueOnce(false) // primeira verificação: arquivo não existe
            .mockReturnValueOnce(true); // segunda verificação: já criado
        fs.readFileSync.mockReturnValue('# MEMORY Index\n\n- [INIT:0001] Bootstrap');
        deps.aiGateway.sendMessage.mockResolvedValue({ stream: {} });

        await uc.sendMessage('token_123', 'Olá');

        expect(fs.writeFileSync).toHaveBeenCalledWith(
            expect.stringContaining('MEMORY.md'),
            expect.stringContaining('# MEMORY Index'),
            'utf-8'
        );
    });
});
