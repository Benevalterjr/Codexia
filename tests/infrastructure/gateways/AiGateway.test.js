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

  describe('streamResponse — SSE Parser', () => {
    function createMockStream(chunks) {
        let index = 0;
        return {
            getReader: () => ({
                read: async () => {
                    if (index >= chunks.length) return { done: true };
                    const value = new (require('util').TextEncoder)().encode(chunks[index++]);
                    return { done: false, value };
                },
            }),
        };
    }

    function createMockOutput() {
        const calls = [];
        return {
            write: jest.fn(text => calls.push(text)),
            getCalls: () => calls,
            getFullOutput: () => calls.join(''),
        };
    }

    test('deve parsear eventos de delta de texto corretamente', async () => {
        const output = createMockOutput();
        const stream = createMockStream([
            'data: {"type":"response.output_text.delta","delta":"Hello"}\n',
            'data: {"type":"response.output_text.delta","delta":" World"}\n',
            'data: [DONE]\n',
        ]);

        const result = await gateway.streamResponse(stream, output);
        expect(result.text).toBe('Hello World');
    });

    test('deve extrair responseId de response.completed', async () => {
        const output = createMockOutput();
        const stream = createMockStream([
            'data: {"type":"response.output_text.delta","delta":"Hi"}\n',
            'data: {"type":"response.completed","response":{"id":"resp_abc123"}}\n',
            'data: [DONE]\n',
        ]);

        const result = await gateway.streamResponse(stream, output);
        expect(result.responseId).toBe('resp_abc123');
        expect(result.text).toBe('Hi');
    });

    test('deve extrair responseId de campo id com prefixo resp_', async () => {
        const output = createMockOutput();
        const stream = createMockStream([
            'data: {"id":"resp_xyz","type":"response.output_text.delta","delta":"test"}\n',
            'data: [DONE]\n',
        ]);

        const result = await gateway.streamResponse(stream, output);
        expect(result.responseId).toBe('resp_xyz');
    });

    test('deve lidar com delta string sem type (formato alternativo)', async () => {
        const output = createMockOutput();
        const stream = createMockStream([
            'data: {"delta":"bare delta"}\n',
            'data: [DONE]\n',
        ]);

        const result = await gateway.streamResponse(stream, output);
        expect(result.text).toBe('bare delta');
    });

    test('deve lidar com partes parciais JSON sem crashar', async () => {
        const output = createMockOutput();
        const stream = createMockStream([
            'data: {"type":"response.output_text.del',
            'ta","delta":"split"}\ndata: [DONE]\n',
        ]);

        const result = await gateway.streamResponse(stream, output);
        expect(result.text).toBe('split');
    });
    
    test('deve reportar erros de stream da API', async () => {
        const output = createMockOutput();
        const stream = createMockStream([
            'data: {"type":"error","error":{"message":"rate limit"}}\n',
            'data: [DONE]\n',
        ]);

        await gateway.streamResponse(stream, output);
        expect(output.getFullOutput()).toContain('rate limit');
    });
  });
});
