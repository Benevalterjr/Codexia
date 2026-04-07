describe('CONFIG.VALID_MODELS resolution', () => {
    const original = process.env.CODEXIA_VALID_MODELS;

    afterEach(() => {
        if (original === undefined) {
            delete process.env.CODEXIA_VALID_MODELS;
        } else {
            process.env.CODEXIA_VALID_MODELS = original;
        }
        jest.resetModules();
    });

    test('uses env-provided whitelist when present', () => {
        process.env.CODEXIA_VALID_MODELS = 'gpt-x, codex-y';
        const { CONFIG } = require('../../src/domain/constants');

        expect(CONFIG.VALID_MODELS).toEqual(['gpt-x', 'codex-y']);
    });

    test('falls back to defaults when env is empty', () => {
        process.env.CODEXIA_VALID_MODELS = '   ';
        const { CONFIG } = require('../../src/domain/constants');

        expect(CONFIG.VALID_MODELS.length).toBeGreaterThan(0);
        expect(CONFIG.VALID_MODELS).toContain('gpt-5.1-codex');
    });
});
