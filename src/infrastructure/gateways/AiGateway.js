const { CONFIG, C } = require('../../domain/constants');

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

    async streamResponse(stream, output = process.stdout) {
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        let fullResponse = '';
        let buffer = '';
        let responseId = null;
        
        const cyan = C?.cyan || '\x1b[36m';
        const bold = C?.bold || '\x1b[1m';
        const reset = C?.reset || '\x1b[0m';
        const red = C?.red || '\x1b[31m';
        const yellow = C?.yellow || '\x1b[33m';
        
        output.write(`\n${cyan}${bold}AI ▸${reset} `);
        
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                
                for (const line of lines) {
                    if (/^data:\s?/.test(line)) {
                        const data = line.replace(/^data:\s?/, '').trim();
                        if (data === '[DONE]') continue;
                        
                        try {
                            const parsed = JSON.parse(data);
                            if (parsed.response?.id) responseId = parsed.response.id;
                            if (parsed.id && parsed.id.startsWith('resp_')) responseId = parsed.id;
                            
                            if (parsed.type === 'response.output_text.delta') {
                                const delta = parsed.delta || '';
                                output.write(delta);
                                fullResponse += delta;
                            } else if (parsed.delta && typeof parsed.delta === 'string' && !parsed.type) {
                                output.write(parsed.delta);
                                fullResponse += parsed.delta;
                            } else if (parsed.type === 'error') {
                                output.write(`\n${red}✗ Erro: ${parsed.error?.message || JSON.stringify(parsed)}${reset}`);
                            } else if (parsed.type === 'response.completed') {
                                if (parsed.response?.id) responseId = parsed.response.id;
                                if (!fullResponse && parsed.response?.output) {
                                    for (const item of parsed.response.output) {
                                        if (item.type === 'message' && item.content) {
                                            for (const c of item.content) {
                                                if (c.type === 'output_text') {
                                                    fullResponse = c.text || '';
                                                    output.write(fullResponse);
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        } catch (e) {
                            if (process.env.DEBUG === 'true') {
                                console.warn(`\n${yellow}[DEBUG] Falha ao processar linha SSE: ${data}${reset}`);
                            }
                        }
                    }
                }
            }
        } catch (err) {
            if (!err.message?.includes('aborted')) {
                output.write(`\n${red}✗ Erro no stream: ${err.message}${reset}`);
            }
        }
        
        output.write('\n\n');
        return { text: fullResponse, responseId };
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
