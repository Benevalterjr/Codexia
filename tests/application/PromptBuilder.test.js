const { buildDefaultInstructions, buildCodexInstructions } = require('../../src/application/PromptBuilder');

jest.mock('../../src/domain/constants', () => ({
    CONFIG: {
        MAX_MEMORY_INJECT_CHARS: 50, // Limite pequeno para facilitar o teste
    },
}));

describe('PromptBuilder — Memory Truncation', () => {
    test('deve injetar memória completa quando abaixo do limite', () => {
        const shortMemory = '# Curto';
        const result = buildDefaultInstructions('gpt-5.3-codex', shortMemory);
        expect(result).toContain('# Curto');
        expect(result).not.toContain('MEMORY TRUNCADO');
    });

    test('deve truncar memória quando exceder o limite', () => {
        const longMemory = 'A'.repeat(200);
        const result = buildDefaultInstructions('gpt-5.3-codex', longMemory);
        expect(result).toContain('MEMORY TRUNCADO');
        expect(result).not.toContain('A'.repeat(200));
    });

    test('deve truncar memória no buildCodexInstructions', () => {
        const longMemory = 'B'.repeat(200);
        const result = buildCodexInstructions('gpt-5.3-codex', longMemory);
        expect(result).toContain('MEMORY TRUNCADO');
    });

    test('não deve crashar com memória vazia ou null', () => {
        expect(() => buildDefaultInstructions('gpt-5.3-codex', '')).not.toThrow();
        expect(() => buildDefaultInstructions('gpt-5.3-codex', null)).not.toThrow();
        expect(() => buildCodexInstructions('gpt-5.3-codex', null)).not.toThrow();
    });
});
