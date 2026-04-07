const path = require('path');

const DEFAULT_VALID_MODELS = [
    'gpt-5.1-codex',
    'gpt-5.1',
    'gpt-4.1',
    'codex-mini-latest',
    'gpt-5.3-codex'
];

function resolveValidModels() {
    const fromEnv = process.env.CODEXIA_VALID_MODELS;
    if (!fromEnv) return DEFAULT_VALID_MODELS;

    const parsed = fromEnv
        .split(',')
        .map(model => model.trim())
        .filter(Boolean);

    return parsed.length > 0 ? parsed : DEFAULT_VALID_MODELS;
}

const C = {
    cyan:    '\x1b[96m',
    green:   '\x1b[92m',
    yellow:  '\x1b[93m',
    red:     '\x1b[91m',
    white:   '\x1b[97m',
    magenta: '\x1b[95m',
    dim:     '\x1b[2m',
    bold:    '\x1b[1m',
    reset:   '\x1b[0m',
};

const CONFIG = {
    CLIENT_ID: 'app_EMoamEEZ73f0CkXaXp7hrann',
    BASE_URL: 'https://auth.openai.com',
    API_BASE_URL: 'https://auth.openai.com/api/accounts',
    CODEX_API: 'https://chatgpt.com/backend-api/codex',
    DEFAULT_MODEL: 'gpt-5.1-codex',
    MAX_WAIT_MS: 15 * 60 * 1000,
    TOKEN_FILE: path.join(__dirname, '../../codex_tokens.json'),
    SESSION_FILE: path.join(__dirname, '../../codex_session.json'),
    VALID_MODELS: resolveValidModels(),
    AUTOMATIONS_DIR: path.join(__dirname, '../../automations'),
};

module.exports = { C, CONFIG };
