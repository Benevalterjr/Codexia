const AuthGateway = require('../../../src/infrastructure/gateways/AuthGateway');

jest.mock('../../../src/domain/constants', () => ({
  CONFIG: { 
      CODEX_API: 'https://codex.fake',
      MAX_WAIT_MS: 3000 // Acelerado para testes
  },
  C: { red: '', green: '', yellow: '', dim: '', bold: '', cyan: '', reset: '' }
}));

describe('AuthGateway - authenticateDevice', () => {
    let gateway;
    
    beforeEach(() => {
        gateway = new AuthGateway();
        gateway.requestUserCode = jest.fn();
        gateway.pollForToken = jest.fn();
        gateway.exchangeCodeForTokens = jest.fn();
    });

    test('deve chamar requestUserCode e completar o fluxo com sucesso', async () => {
        gateway.requestUserCode.mockResolvedValue({
            user_code: 'TEST-CODE',
            device_auth_id: 'dev_123',
            interval: 0.1, // muito curto para rodar rápido
        });
        gateway.pollForToken.mockResolvedValue({
            authorization_code: 'auth_xyz',
            code_verifier: 'verify_abc',
        });
        gateway.exchangeCodeForTokens.mockResolvedValue({
            access_token: 'tok_device',
            expires_in: 7200,
        });

        const onUserCode = jest.fn();
        const tokens = await gateway.authenticateDevice(onUserCode);

        expect(gateway.requestUserCode).toHaveBeenCalledTimes(1);
        expect(onUserCode).toHaveBeenCalledWith({
            userCode: 'TEST-CODE',
            verificationUri: 'https://auth.openai.com/codex/device',
            expiresIn: 900
        });
        expect(gateway.pollForToken).toHaveBeenCalledWith('dev_123', 'TEST-CODE');
        expect(gateway.exchangeCodeForTokens).toHaveBeenCalledWith('auth_xyz', 'verify_abc');
        expect(tokens.access_token).toBe('tok_device');
    });

    test('deve usar campo usercode (alternativo) quando user_code ausente', async () => {
        gateway.requestUserCode.mockResolvedValue({
            usercode: 'ALT-CODE',
            device_auth_id: 'dev_alt',
            interval: 0.1,
        });
        gateway.pollForToken.mockResolvedValue({
            authorization_code: 'auth_alt',
            code_verifier: 'verify_alt',
        });
        gateway.exchangeCodeForTokens.mockResolvedValue({
            access_token: 'tok_alt',
            expires_in: 3600,
        });

        const tokens = await gateway.authenticateDevice();
        expect(gateway.pollForToken).toHaveBeenCalledWith('dev_alt', 'ALT-CODE');
        expect(tokens.access_token).toBe('tok_alt');
    });

    test('deve interromper polling e propagar erro 401 (Não autorizado)', async () => {
        gateway.requestUserCode.mockResolvedValue({
            user_code: 'TEST-CODE',
            device_auth_id: 'dev_123',
            interval: 0.1,
        });
        
        const authError = new Error('Unauthorized');
        authError.status = 401;
        gateway.pollForToken.mockRejectedValue(authError);
        
        await expect(gateway.authenticateDevice()).rejects.toThrow('Unauthorized');
        expect(gateway.pollForToken).toHaveBeenCalledTimes(1);
    });

    test('deve retornar timeout se exceder o config', async () => {
        gateway.requestUserCode.mockResolvedValue({
            user_code: 'TEST-CODE',
            device_auth_id: 'dev_time',
            interval: 1, // Timeout mockado em 3 sec no config
        });
        gateway.pollForToken.mockRejectedValue(new Error('Pending'));

        await expect(gateway.authenticateDevice()).rejects.toThrow('Timeout');
    });
});
