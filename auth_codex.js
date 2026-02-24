/**
 * Autenticação OpenAI via Device Code Flow (o mesmo fluxo do Codex CLI)
 * 
 * Este fluxo NÃO abre nenhum browser automaticamente.
 * Em vez disso, gera um código de uso único que o utilizador
 * digita manualmente em https://auth.openai.com/codex/device
 * 
 * Baseado em: https://github.com/tumf/opencode-openai-device-auth
 * e https://github.com/openai/codex (codex-rs/login/src/device_code_auth.rs)
 */

const fs = require('fs');
const path = require('path');

// ─────────────────────── CONFIG ───────────────────────
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const BASE_URL = 'https://auth.openai.com';
const API_BASE_URL = `${BASE_URL}/api/accounts`;
const VERIFICATION_URL = `${BASE_URL}/codex/device`;
const MAX_WAIT_MS = 15 * 60 * 1000; // 15 minutos

// ───────────────────── FORMATAÇÃO ─────────────────────
const CYAN = '\x1b[96m';
const GREEN = '\x1b[92m';
const YELLOW = '\x1b[93m';
const RED = '\x1b[91m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

function banner() {
    console.log(`
${CYAN}╔═══════════════════════════════════════════════════╗
║  ${BOLD}OpenAI Device Code Auth${RESET}${CYAN}  ·  Fluxo Codex CLI       ║
╚═══════════════════════════════════════════════════╝${RESET}
`);
}

// ─────────────────── PASSO 1: OBTER CÓDIGO ────────────
async function requestUserCode() {
    const url = `${API_BASE_URL}/deviceauth/usercode`;
    
    console.log(`${DIM}→ POST ${url}${RESET}`);
    
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'openai-chat-cli/1.0.0',
            'Accept': 'application/json'
        },
        body: JSON.stringify({
            client_id: CLIENT_ID,
            scope: 'openid profile email offline_access api.responses.write',
            audience: 'https://api.openai.com/v1'
        })
    });

    if (!response.ok) {
        const text = await response.text();
        console.error(`${RED}✗ Falha ao obter código: ${response.status}${RESET}`);
        console.error(`${DIM}  Resposta: ${text}${RESET}`);

        if (response.status === 404) {
            console.error(`\n${YELLOW}⚠ Device Code Login não está ativado na sua conta.${RESET}`);
            console.error(`  Ative em: ${CYAN}https://chatgpt.com/settings/security${RESET}`);
        }
        return null;
    }

    return await response.json();
}

// ─────────────────── PASSO 2: POLLING ─────────────────
async function pollForAuthCode(deviceAuthId, userCode, intervalSec) {
    const url = `${API_BASE_URL}/deviceauth/token`;
    const startTime = Date.now();
    
    while (Date.now() - startTime < MAX_WAIT_MS) {
        await new Promise(r => setTimeout(r, intervalSec * 1000));
        
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'codex-auth-poc/1.0.0',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    device_auth_id: deviceAuthId,
                    user_code: userCode
                })
            });

            if (response.ok) {
                return await response.json();
            }

            // 403/404 = autorização pendente (esperado)
            if (response.status === 403 || response.status === 404) {
                process.stdout.write(`${DIM}.${RESET}`);
                continue;
            }

            // Erro inesperado
            const text = await response.text();
            console.error(`\n${RED}✗ Erro no polling: ${response.status} - ${text}${RESET}`);
            return null;
        } catch (err) {
            process.stdout.write(`${RED}!${RESET}`);
            // Erro de rede, continua polling
        }
    }
    
    console.error(`\n${RED}✗ Timeout (15 minutos).${RESET}`);
    return null;
}

// ─────────────── PASSO 3: TROCAR POR TOKENS ───────────
async function exchangeCodeForTokens(authorizationCode, codeVerifier) {
    const url = `${BASE_URL}/oauth/token`;
    const redirectUri = `${BASE_URL}/deviceauth/callback`;
    
    console.log(`\n${DIM}→ POST ${url}${RESET}`);
    
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: CLIENT_ID,
            code: authorizationCode,
            code_verifier: codeVerifier,
            redirect_uri: redirectUri
        }).toString()
    });

    if (!response.ok) {
        const text = await response.text();
        console.error(`${RED}✗ Falha na troca de tokens: ${response.status}${RESET}`);
        console.error(`${DIM}  ${text}${RESET}`);
        return null;
    }

    return await response.json();
}

// ──────────────── GUARDAR TOKENS ──────────────────────
function saveTokens(tokens) {
    const tokenFile = path.join(__dirname, 'openai_tokens.json');
    
    const data = {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        id_token: tokens.id_token || null,
        expires_at: Date.now() + (tokens.expires_in * 1000),
        obtained_at: new Date().toISOString(),
        method: 'device_code_flow'
    };

    fs.writeFileSync(tokenFile, JSON.stringify(data, null, 2));
    console.log(`${GREEN}✓ Tokens guardados em: ${tokenFile}${RESET}`);
    return data;
}

// ──────────────── MAIN ────────────────────────────────
async function main() {
    banner();
    
    // Passo 1: Obter device code
    console.log(`${BOLD}[1/3]${RESET} A solicitar código de dispositivo...\n`);
    
    const userCodeResp = await requestUserCode();
    if (!userCodeResp) {
        process.exit(1);
    }
    
    const userCode = userCodeResp.user_code || userCodeResp.usercode;
    if (!userCode) {
        console.error(`${RED}✗ Sem user_code na resposta:${RESET}`, userCodeResp);
        process.exit(1);
    }
    
    const interval = typeof userCodeResp.interval === 'string' 
        ? parseInt(userCodeResp.interval, 10) 
        : (userCodeResp.interval || 5);
    
    // Instruções para o utilizador
    console.log(`${GREEN}✓ Código obtido com sucesso!${RESET}\n`);
    console.log(`╭──────────────────────────────────────────────╮`);
    console.log(`│                                              │`);
    console.log(`│  ${BOLD}1.${RESET} Abra este link no browser:               │`);
    console.log(`│     ${CYAN}${VERIFICATION_URL}${RESET}     │`);
    console.log(`│                                              │`);
    console.log(`│  ${BOLD}2.${RESET} Digite este código:                      │`);
    console.log(`│     ${BOLD}${YELLOW}${userCode}${RESET}                                │`);
    console.log(`│                                              │`);
    console.log(`│  ${DIM}O código expira em 15 minutos.${RESET}              │`);
    console.log(`╰──────────────────────────────────────────────╯\n`);
    console.log(`${DIM}⚠ Códigos de dispositivo são alvo de phishing.`);
    console.log(`  Nunca partilhe este código com ninguém.${RESET}\n`);
    
    // Passo 2: Polling
    console.log(`${BOLD}[2/3]${RESET} À espera que autorize no browser...`);
    process.stdout.write(`${DIM}     `);
    
    const codeResp = await pollForAuthCode(userCodeResp.device_auth_id, userCode, interval);
    
    console.log(`${RESET}`); // Limpar formatação
    
    if (!codeResp) {
        process.exit(1);
    }
    
    console.log(`${GREEN}✓ Autorização recebida!${RESET}\n`);
    
    // Passo 3: Trocar código por tokens
    console.log(`${BOLD}[3/3]${RESET} A trocar código por tokens de acesso...\n`);
    
    const tokens = await exchangeCodeForTokens(
        codeResp.authorization_code,
        codeResp.code_verifier
    );
    
    if (!tokens) {
        process.exit(1);
    }
    
    // Sucesso!
    const saved = saveTokens(tokens);
    
    console.log(`\n${GREEN}${BOLD}═══════════════════════════════════════════${RESET}`);
    console.log(`${GREEN}${BOLD}  ✓ AUTENTICAÇÃO COMPLETA COM SUCESSO!${RESET}`);
    console.log(`${GREEN}${BOLD}═══════════════════════════════════════════${RESET}\n`);
    
    console.log(`${BOLD}Detalhes:${RESET}`);
    console.log(`  Access Token:  ${DIM}${tokens.access_token.substring(0, 30)}...${RESET}`);
    console.log(`  Refresh Token: ${DIM}${tokens.refresh_token ? tokens.refresh_token.substring(0, 20) + '...' : 'N/A'}${RESET}`);
    console.log(`  Expira em:     ${DIM}${new Date(saved.expires_at).toLocaleString('pt-BR')}${RESET}`);
    console.log(`\n${DIM}Ficheiro: ${path.join(__dirname, 'openai_tokens.json')}${RESET}\n`);
}

main().catch(err => {
    console.error(`${RED}Erro fatal: ${err.message}${RESET}`);
    process.exit(1);
});
