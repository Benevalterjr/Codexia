const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { CONFIG } = require('../../domain/constants');

class JsonTokenRepository {
    constructor(tokenFile = CONFIG.TOKEN_FILE) {
        this.tokenFile = tokenFile;
        this.secretFile = path.join(path.dirname(tokenFile), '.codex_secret');
        this.algorithm = 'aes-256-gcm';
    }

    _debugLog(message) {
        if (process.env.DEBUG === 'true') {
            console.error(message);
        }
    }

    _getSecret() {
        // Prioritiza variável de ambiente para ambientes CI/CD ou maior segurança
        if (process.env.CODEX_TOKEN_SECRET) {
            const envSecret = process.env.CODEX_TOKEN_SECRET;
            // Garante chave de 32 bytes através de hash SHA-256
            return crypto.createHash('sha256').update(envSecret).digest();
        }

        if (fs.existsSync(this.secretFile)) {
            const secret = fs.readFileSync(this.secretFile);
            if (secret.length !== 32) {
                throw new Error('Invalid local secret length (expected 32 bytes).');
            }
            return secret;
        }

        const secret = crypto.randomBytes(32);
        fs.writeFileSync(this.secretFile, secret, { mode: 0o600 });
        return secret;
    }

    _encrypt(text) {
        const iv = crypto.randomBytes(12);
        const key = this._getSecret();
        const cipher = crypto.createCipheriv(this.algorithm, key, iv);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        const authTag = cipher.getAuthTag().toString('hex');
        return `${iv.toString('hex')}:${authTag}:${encrypted}`;
    }

    _decrypt(data) {
        if (!data || typeof data !== 'string') return null;

        const parts = data.split(':');
        if (parts.length !== 3) return null;

        const [ivHex, authTagHex, encryptedHex] = parts;

        // IV=12 bytes => 24 hex chars, tag=16 bytes => 32 hex chars
        if (ivHex.length !== 24 || authTagHex.length !== 32) return null;

        const hexRe = /^[0-9a-f]+$/i;
        if (!hexRe.test(ivHex) || !hexRe.test(authTagHex) || !hexRe.test(encryptedHex)) return null;

        try {
            const iv = Buffer.from(ivHex, 'hex');
            const authTag = Buffer.from(authTagHex, 'hex');
            const key = this._getSecret();
            const decipher = crypto.createDecipheriv(this.algorithm, key, iv);
            decipher.setAuthTag(authTag);
            let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            return decrypted;
        } catch (err) {
            this._debugLog(`[Security] Decryption error: ${err.message}`);
            return null;
        }
    }

    load() {
        if (!fs.existsSync(this.tokenFile)) return null;
        try {
            const raw = fs.readFileSync(this.tokenFile, 'utf-8');
            const decrypted = this._decrypt(raw);

            if (!decrypted) {
                // Legado: tenta JSON puro se o arquivo parecer um JSON
                if (raw.trim().startsWith('{')) {
                    try {
                        const legacy = JSON.parse(raw);
                        this._debugLog('[Security] Migrando tokens para formato v2 criptografado...');
                        this.save(legacy, null);
                        return legacy;
                    } catch {
                        return null;
                    }
                }
                return null;
            }

            return JSON.parse(decrypted);
        } catch (err) {
            this._debugLog(`[Security] Load error: ${err.message}`);
            return null;
        }
    }

    save(tokens, expiresIn) {
        if (!tokens || !tokens.access_token || typeof tokens.access_token !== 'string') {
            throw new Error('Invalid token payload: access_token is required.');
        }

        const ttlSeconds = Number(expiresIn ?? tokens.expires_in ?? 864000);
        if (!Number.isFinite(ttlSeconds) || ttlSeconds < 0) {
            throw new Error('Invalid token payload: expires_in must be a non-negative number.');
        }

        const data = {
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token || null,
            id_token: tokens.id_token || null,
            expires_at: Date.now() + (ttlSeconds * 1000),
            obtained_at: new Date().toISOString(),
            method: 'device_code_flow'
        };

        try {
            const encrypted = this._encrypt(JSON.stringify(data));
            fs.writeFileSync(this.tokenFile, encrypted, { mode: 0o600 });
            return data;
        } catch (err) {
            throw new Error(`Failed to save tokens: ${err.message}`);
        }
    }

    isExpired(tokens) {
        if (!tokens || !tokens.expires_at) return true;
        return Date.now() > (tokens.expires_at - 5 * 60 * 1000);
    }

    delete() {
        try {
            if (fs.existsSync(this.tokenFile)) {
                fs.unlinkSync(this.tokenFile);
            }
        } catch (err) {
            this._debugLog(`[Security] Delete error: ${err.message}`);
        }
    }
}

module.exports = JsonTokenRepository;
