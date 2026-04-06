const { CONFIG } = require('../../domain/constants');

class AiGateway {
    async sendMessage(accessToken, body) {
        const response = await fetch(`${CONFIG.CODEX_API}/responses`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`,
                'User-Agent': 'codexia-cli/1.0.0',
                'Accept': 'text/event-stream',
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const text = await response.text();
            if (response.status === 401) {
                return { error: 'token_expired', message: text };
            }
            return { error: 'api_error', status: response.status, message: text };
        }

        return { stream: response.body };
    }

    async summarize(accessToken, messages) {
        const response = await fetch(`${CONFIG.CODEX_API}/responses`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`,
                'User-Agent': 'codexia-cli/1.0.0',
            },
            body: JSON.stringify({
                model: CONFIG.DEFAULT_MODEL,
                input: messages,
                stream: false,
                store: false
            })
        });

        if (!response.ok) return null;

        const data = await response.json();
        // Extract text from Codex response format
        return data.output?.[0]?.content?.[0]?.text || null;
    }
}

module.exports = AiGateway;
