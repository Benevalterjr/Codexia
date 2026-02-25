const path = require('path');

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
    AUTOMATIONS_DIR: path.join(__dirname, '../../automations'),
};

module.exports = { C, CONFIG };
