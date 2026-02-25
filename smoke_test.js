const assert = require('assert');
const { C, CONFIG } = require('./src/domain/constants');
const JsonTokenRepository = require('./src/infrastructure/repositories/JsonTokenRepository');
const JsonSessionRepository = require('./src/infrastructure/repositories/JsonSessionRepository');

console.log('Running Smoke Test...');

// Test 1: Constants
assert.ok(C.cyan, 'Cyan color missing');
assert.ok(CONFIG.CODEX_API, 'API URL missing');

// Test 2: Token Repository
const tokenRepo = new JsonTokenRepository();
const tokens = tokenRepo.load();
console.log('Tokens loaded:', !!tokens);

// Test 3: Session Repository
const sessionRepo = new JsonSessionRepository();
const session = sessionRepo.load();
console.log('Session loaded:', !!session);

console.log('Smoke Test Passed!');
