const AiGateway = require('../../../src/infrastructure/gateways/AiGateway');

jest.mock('../../../src/domain/constants', () => ({
  CONFIG: { CODEX_API: 'https://codex.fake' },
}));

const { CONFIG } = require('../../../src/domain/constants');

describe('AiGateway', () => {
  let gateway;

  beforeEach(() => {
    gateway = new AiGateway();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('sendMessage', () => {
    it('deve enviar a requisição corretamente e retornar o stream quando a API responder 200', async () => {
      // Arrange
      const mockStream = Symbol('stream');
      const body = { prompt: 'olá' };
      global.fetch.mockResolvedValue({
        ok: true,
        body: mockStream,
      });

      // Act
      const result = await gateway.sendMessage('token-123', body);

      // Assert
      expect(global.fetch).toHaveBeenCalledWith(`${CONFIG.CODEX_API}/responses`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token-123',
          'User-Agent': 'codexia-cli/1.0.0',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify(body),
      });
      expect(result).toEqual({ stream: mockStream });
    });

    it('deve sinalizar token expirado quando a API retornar 401', async () => {
      // Arrange
      global.fetch.mockResolvedValue({
        ok: false,
        status: 401,
        text: jest.fn().mockResolvedValue('expired token'),
      });

      // Act
      const result = await gateway.sendMessage('token-expirado', {});

      // Assert
      expect(result).toEqual({ error: 'token_expired', message: 'expired token' });
    });

    it('deve repassar erro genérico da API para status diferentes de 401', async () => {
      // Arrange
      global.fetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: jest.fn().mockResolvedValue('internal error'),
      });

      // Act
      const result = await gateway.sendMessage('token', {});

      // Assert
      expect(result).toEqual({
        error: 'api_error',
        status: 500,
        message: 'internal error',
      });
    });

    it('deve propagar exceções de rede quando fetch rejeitar', async () => {
      // Arrange
      const networkError = new Error('network down');
      global.fetch.mockRejectedValue(networkError);

      // Act & Assert
      await expect(gateway.sendMessage('token', {})).rejects.toThrow('network down');
    });
  });
});
