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
    appendFileSync: jest.fn(),
    statSync: jest.fn(),
    readdirSync: jest.fn(),
    renameSync: jest.fn(),
    unlinkSync: jest.fn(),
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
        fs.statSync.mockReturnValue({ size: 0 }); // Prevents throwing on default calls
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
        fs.existsSync.mockImplementation((targetPath) => {
            if (targetPath.includes('MEMORY.md')) return false;
            return true;
        });
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

    test('deve gravar transcrições em JSONL ao atualizar estado', async () => {
        fs.existsSync.mockReturnValue(true);
        await uc.updateStateFromResponse('pergunta', 'resposta', 'resp_1', 'tok');

        expect(fs.appendFileSync).toHaveBeenCalledWith(
            expect.stringContaining('sessions.jsonl'),
            expect.stringContaining('"user":"pergunta"'),
            'utf-8'
        );
    });

    test('deve executar autoDream e criar tópico consolidado', async () => {
        jest.useFakeTimers();
        fs.existsSync.mockImplementation((targetPath) => targetPath.includes('sessions.jsonl') || targetPath.includes('MEMORY.md'));
        fs.readFileSync.mockImplementation((targetPath) => {
            if (targetPath.includes('sessions.jsonl')) {
                return '{"user":"u1","assistant":"a1"}\n{"user":"u2","assistant":"a2"}\n';
            }
            return '# 🧠 CODEXIA MEMORY INDEX\n\n## 📌 TÓPICOS ATIVOS\n';
        });

        await uc.updateStateFromResponse('pergunta', 'resposta', 'resp_2', 'tok');
        jest.runAllTimers();

        expect(fs.writeFileSync).toHaveBeenCalledWith(
            expect.stringContaining('topic-autodream-'),
            expect.stringContaining('[AUTO:DREAM]'),
            'utf-8'
        );

        jest.useRealTimers();
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

    describe('extractAgenticWrites', () => {
        test('deve detectar comando /write no formato code block e extrair o conteudo', () => {
             const payload = '```bash\n/write ../bash-write.md\nconteudo vindo do bloco bash\n```\nTexto extra';
             const ucInstance = new ChatUseCase({}, {}, {}, {});
             const writes = ucInstance.extractAgenticWrites(payload);
             
             expect(writes).toHaveLength(1);
             expect(writes[0].targetSpec).toBe('../bash-write.md');
             expect(writes[0].content).toBe('conteudo vindo do bloco bash');
        });

        test('deve tratar multiplos writes e remover duplicados pelo path basename', () => {
             const payload = '```bash\n/write dup.md\n1\n```\n```write dup.md\n2\n```\n```write abc.md\n3\n```';
             const ucInstance = new ChatUseCase({}, {}, {}, {});
             const writes = ucInstance.extractAgenticWrites(payload);
             
             expect(writes).toHaveLength(2);
             expect(writes[0].targetSpec).toBe('dup.md');
             expect(writes[1].targetSpec).toBe('abc.md');
        });
    });

    describe('Memory Hardening', () => {
        test('deve rotacionar sessions.jsonl quando ultrapassar MAX_TRANSCRIPT_BYTES', async () => {
            // Simular arquivo existente com tamanho acima do limite
            fs.existsSync.mockReturnValue(true);
            fs.statSync.mockReturnValue({ size: 600 * 1024 }); // 600KB > 512KB
            fs.readFileSync.mockReturnValue('# Memory');
            fs.readdirSync.mockReturnValue([]);

            await uc.updateStateFromResponse('msg', 'resp', 'id1', 'tok');

            expect(fs.renameSync).toHaveBeenCalledWith(
                expect.stringContaining('sessions.jsonl'),
                expect.stringContaining('sessions-')
            );
        });

        test('NÃO deve rotacionar sessions.jsonl quando abaixo do limite', async () => {
            fs.existsSync.mockReturnValue(true);
            fs.statSync.mockReturnValue({ size: 100 * 1024 }); // 100KB < 512KB
            fs.readFileSync.mockReturnValue('# Memory');
            fs.readdirSync.mockReturnValue([]);

            await uc.updateStateFromResponse('msg', 'resp', 'id2', 'tok');

            expect(fs.renameSync).not.toHaveBeenCalled();
        });

        test('deve disparar collapse quando totalChars exceder MAX_CONTEXT_CHARS', async () => {
            fs.existsSync.mockReturnValue(true);
            fs.statSync.mockReturnValue({ size: 100 });
            fs.readFileSync.mockReturnValue('# Memory');
            fs.readdirSync.mockReturnValue([]);

            // Forçar modelo codex
            uc.state.currentModel = 'gpt-5.3-codex';
            
            // Simular histórico enorme (acima de 60K chars)
            const bigText = 'x'.repeat(35000);
            uc.state.conversationHistory = [
                { role: 'user', content: [{ type: 'input_text', text: bigText }] },
                { role: 'assistant', content: [{ type: 'output_text', text: bigText }] },
            ];

            // Mock do summarize para o collapse
            deps.aiGateway.summarize = jest.fn().mockResolvedValue('resumo comprimido');

            await uc.updateStateFromResponse('nova msg', 'nova resp', 'id3', 'tok');

            // O collapse deve ter sido chamado (summarize invocado)
            expect(deps.aiGateway.summarize).toHaveBeenCalled();
        });

        test('deve remover autodreams antigos além do keepCount', () => {
            fs.readdirSync.mockReturnValue([
                'topic-autodream-20260101.md',
                'topic-autodream-20260102.md',
                'topic-autodream-20260103.md',
                'topic-autodream-20260104.md',
            ]);

            // keepCount = 2, deve deletar os 2 mais antigos
            uc._pruneOldAutoDreams('/fake/memory', 2);

            expect(fs.unlinkSync).toHaveBeenCalledTimes(2);
            const path = require('path');
            expect(fs.unlinkSync).toHaveBeenCalledWith(path.join('/fake/memory', 'topic-autodream-20260101.md'));
            expect(fs.unlinkSync).toHaveBeenCalledWith(path.join('/fake/memory', 'topic-autodream-20260102.md'));
        });

        test('NÃO deve deletar quando quantidade está dentro do keepCount', () => {
            fs.readdirSync.mockReturnValue([
                'topic-autodream-20260101.md',
                'topic-autodream-20260102.md',
            ]);

            uc._pruneOldAutoDreams('/fake/memory', 5);

            expect(fs.unlinkSync).not.toHaveBeenCalled();
        });
    });
});
