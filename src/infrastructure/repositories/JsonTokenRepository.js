const fs = require('fs');
const { CONFIG } = require('../../domain/constants');

class JsonTokenRepository {
    constructor(tokenFile = CONFIG.TOKEN_FILE) {
        this.tokenFile = tokenFile;
    }

    load() {
        if (!fs.existsSync(this.tokenFile)) return null;
        try {
            return JSON.parse(fs.readFileSync(this.tokenFile, 'utf-8'));
        } catch {
            return null;
        }
    }

    save(tokens, expiresIn) {
        const data = {
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token || null,
            id_token: tokens.id_token || null,
            expires_at: Date.now() + ((expiresIn || tokens.expires_in || 864000) * 1000),
            obtained_at: new Date().toISOString(),
            method: 'device_code_flow'
        };
        fs.writeFileSync(this.tokenFile, JSON.stringify(data, null, 2));
        return data;
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
        } catch {}
    }
}

module.exports = JsonTokenRepository;
