/**
 * 🧪 Codexia — Testes da Memória (ChatUseCase)
 * 
 * Verifica se o sistema de memória é inicializado e injetado corretamente.
 * Cobre: auto-criação de memory/, topic-bootstrap.md e MEMORY.md.
 */

const ChatUseCase = require('../../../src/application/use-cases/ChatUseCase');
const fs = require('fs');

jest.mock('fs', () => ({
    existsSync: jest.fn(),
    readFileSync: jest.fn(),
    writeFileSync: jest.fn(),
    mkdirSync: jest.fn(),
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
        // memoryDir exists, bootstrapPath exists, memoryPath exists
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
        // memoryDir exists, bootstrap exists, memoryPath not exists -> write creates it
        // but readFileSync will throw to simulate total failure
        fs.existsSync.mockReturnValue(false);
        fs.readFileSync.mockImplementation(() => { throw new Error('File not found'); });
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
        // memoryDir exists, bootstrap exists, memoryPath does NOT exist
        fs.existsSync
            .mockReturnValueOnce(true)   // memoryDir exists
            .mockReturnValueOnce(true)   // bootstrapPath exists
            .mockReturnValueOnce(false); // memoryPath does NOT exist -> triggers write
        fs.readFileSync.mockReturnValue('# 🧠 CODEXIA MEMORY INDEX\n\n- [INIT:BOOT] Bootstrap');
        deps.aiGateway.sendMessage.mockResolvedValue({ stream: {} });

        await uc.sendMessage('token_123', 'Olá');

        expect(fs.writeFileSync).toHaveBeenCalledWith(
            expect.stringContaining('MEMORY.md'),
            expect.stringContaining('CODEXIA MEMORY INDEX'),
            'utf-8'
        );
    });

    test('deve criar pasta memory/ e bootstrap na primeira execução', async () => {
        // Nada existe -> tudo é criado
        fs.existsSync.mockReturnValue(false);
        fs.readFileSync.mockReturnValue('# 🧠 CODEXIA MEMORY INDEX');
        deps.aiGateway.sendMessage.mockResolvedValue({ stream: {} });

        await uc.sendMessage('token_123', 'Olá');

        // Deve criar o diretório
        expect(fs.mkdirSync).toHaveBeenCalledWith(
            expect.stringContaining('memory'),
            { recursive: true }
        );
        // Deve criar o bootstrap topic
        expect(fs.writeFileSync).toHaveBeenCalledWith(
            expect.stringContaining('topic-bootstrap.md'),
            expect.stringContaining('Bootstrap do Sistema de Memória'),
            'utf-8'
        );
        // Deve criar o MEMORY.md
        expect(fs.writeFileSync).toHaveBeenCalledWith(
            expect.stringContaining('MEMORY.md'),
            expect.stringContaining('CODEXIA MEMORY INDEX'),
            'utf-8'
        );
    });

    test('não deve recriar bootstrap se já existir', async () => {
        // memoryDir exists, bootstrapPath exists, memoryPath exists
        fs.existsSync.mockReturnValue(true);
        fs.readFileSync.mockReturnValue('# Existing Memory');
        deps.aiGateway.sendMessage.mockResolvedValue({ stream: {} });

        await uc.sendMessage('token_123', 'Olá');

        // Não deve ter criado diretório nem escrito bootstrap
        expect(fs.mkdirSync).not.toHaveBeenCalled();
        expect(fs.writeFileSync).not.toHaveBeenCalledWith(
            expect.stringContaining('topic-bootstrap.md'),
            expect.anything(),
            expect.anything()
        );
    });
});
