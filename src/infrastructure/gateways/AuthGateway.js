const { CONFIG } = require('../../domain/constants');

class AuthGateway {
    async requestUserCode() {
        const response = await fetch(`${CONFIG.API_BASE_URL}/deviceauth/usercode`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'codexia-auth-cli/1.0.0',
                'Accept': 'application/json'
            },
            body: JSON.stringify({ 
                client_id: CONFIG.CLIENT_ID,
                scope: 'openid profile email offline_access api.responses.write',
                audience: 'https://api.openai.com/v1'
            })
        });

        if (!response.ok) {
            throw new Error(`Auth initiation failed: ${response.status}`);
        }

        return await response.json();
    }

    async pollForToken(deviceAuthId, userCode) {
        const response = await fetch(`${CONFIG.API_BASE_URL}/deviceauth/token`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'codexia-auth-cli/1.0.0',
                'Accept': 'application/json'
            },
            body: JSON.stringify({ device_auth_id: deviceAuthId, user_code: userCode })
        });

        if (response.status === 403 || response.status === 404) {
            return null; // Still waiting
        }

        if (!response.ok) {
            throw new Error(`Polling failed: ${response.status}`);
        }

        return await response.json();
    }

    async exchangeCodeForTokens(authorizationCode, codeVerifier) {
        const response = await fetch(`${CONFIG.BASE_URL}/oauth/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                client_id: CONFIG.CLIENT_ID,
                code: authorizationCode,
                code_verifier: codeVerifier,
                redirect_uri: `${CONFIG.BASE_URL}/deviceauth/callback`
            }).toString()
        });

        if (!response.ok) {
            throw new Error(`Token exchange failed: ${response.status}`);
        }

        return await response.json();
    }

    async refreshAccessToken(refreshToken) {
        const response = await fetch(`${CONFIG.BASE_URL}/oauth/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                client_id: CONFIG.CLIENT_ID,
                refresh_token: refreshToken,
            }).toString()
        });

        if (!response.ok) {
            return null;
        }

        return await response.json();
    }
}

module.exports = AuthGateway;
