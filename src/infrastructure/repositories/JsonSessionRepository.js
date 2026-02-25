const fs = require('fs');
const { CONFIG } = require('../../domain/constants');

class JsonSessionRepository {
    constructor(sessionFile = CONFIG.SESSION_FILE) {
        this.sessionFile = sessionFile;
    }

    load() {
        if (!fs.existsSync(this.sessionFile)) return null;
        try {
            return JSON.parse(fs.readFileSync(this.sessionFile, 'utf-8'));
        } catch {
            return null;
        }
    }

    save(data) {
        try {
            fs.writeFileSync(this.sessionFile, JSON.stringify(data, null, 2), 'utf-8');
            return true;
        } catch {
            return false;
        }
    }
}

module.exports = JsonSessionRepository;
