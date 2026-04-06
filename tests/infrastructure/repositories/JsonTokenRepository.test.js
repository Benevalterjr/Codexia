const JsonTokenRepository = require('../../../src/infrastructure/repositories/JsonTokenRepository');
const fs = require('fs');
const crypto = require('crypto');

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  unlinkSync: jest.fn(),
  lstatSync: jest.fn(),
}));

jest.mock('../../../src/domain/constants', () => ({
  CONFIG: { TOKEN_FILE: '/tmp/token.json' },
}));

const { CONFIG } = require('../../../src/domain/constants');

describe('JsonTokenRepository', () => {
  const fixedNow = 1700000000000;
  const mockSecret = Buffer.alloc(32, 'a'); // 32 bytes de 'a'
  let nowSpy;

  beforeAll(() => {
    nowSpy = jest.spyOn(Date, 'now').mockReturnValue(fixedNow);
  });

  afterAll(() => {
    nowSpy.mockRestore();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Mock padrão para o arquivo de segredo
    fs.existsSync.mockImplementation((path) => {
        if (path.endsWith('.codex_secret')) return true;
        return false;
    });
    fs.readFileSync.mockImplementation((path) => {
        if (path.endsWith('.codex_secret')) return mockSecret;
        return null;
    });
  });

  describe('Secret Key Management', () => {
    it('deve lançar erro se a chave secreta local não tiver 32 bytes', () => {
        const repo = new JsonTokenRepository();
        fs.readFileSync.mockReturnValue(Buffer.alloc(16, 'b')); // 16 bytes em vez de 32
        
        expect(() => repo._getSecret()).toThrow('Invalid local secret length');
    });

    it('deve carregar chave válida de 32 bytes', () => {
        const repo = new JsonTokenRepository();
        fs.readFileSync.mockReturnValue(mockSecret);
        
        const key = repo._getSecret();
        expect(key.length).toBe(32);
        expect(key).toEqual(mockSecret);
    });
  });

  describe('Encryption/Decryption logic', () => {
    it('deve ser capaz de criptografar e descriptografar dados consistentemente', () => {
        const repo = new JsonTokenRepository();
        const originalData = JSON.stringify({ test: "data" });
        
        const encrypted = repo._encrypt(originalData);
        expect(encrypted).toContain(':'); // IV:Tag:Data
        
        // Mock do readFileSync para retornar o dado criptografado
        fs.readFileSync.mockReturnValueOnce(mockSecret); // Para o _getSecret
        const decrypted = repo._decrypt(encrypted);
        expect(decrypted).toBe(originalData);
    });

    it('deve usar segredo de variável de ambiente se disponível', () => {
        process.env.CODEX_TOKEN_SECRET = 'minha-chave-super-secreta';
        const repo = new JsonTokenRepository();
        const data = "test";
        
        const encrypted = repo._encrypt(data);
        const decrypted = repo._decrypt(encrypted);
        
        expect(decrypted).toBe(data);
        delete process.env.CODEX_TOKEN_SECRET;
    });

    it('deve retornar null para payloads malformados ou corrompidos', () => {
        const repo = new JsonTokenRepository();
        
        expect(repo._decrypt("part1:part2")).toBeNull(); // Faltando partes
        expect(repo._decrypt("g".repeat(24) + ":tag:data")).toBeNull(); // Não é hex
        expect(repo._decrypt(null)).toBeNull();
    });
  });

  describe('load', () => {
    it('deve retornar o JSON parseado após descriptografia', () => {
      const data = { access_token: 'abc' };
      const repo = new JsonTokenRepository();
      const encrypted = repo._encrypt(JSON.stringify(data));

      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockImplementation((path) => {
          if (path.endsWith('.codex_secret')) return mockSecret;
          if (path === CONFIG.TOKEN_FILE) return encrypted;
          return null;
      });

      const result = repo.load();
      expect(result).toEqual(data);
    });

    it('deve realizar migração automática se encontrar formato antigo (JSON puro)', () => {
      const legacyData = { access_token: 'old-token' };
      const repo = new JsonTokenRepository();

      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockImplementation((path) => {
          if (path.endsWith('.codex_secret')) return mockSecret;
          if (path === CONFIG.TOKEN_FILE) return JSON.stringify(legacyData);
          return null;
      });

      const saveSpy = jest.spyOn(repo, 'save');
      const result = repo.load();
      
      expect(result).toEqual(legacyData);
      expect(saveSpy).toHaveBeenCalledWith(legacyData, null);
    });
  });

  describe('save', () => {
    it('deve persistir tokens em formato criptografado', () => {
      const repository = new JsonTokenRepository();
      const tokens = { access_token: 'abc' };

      repository.save(tokens, 3600);

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        CONFIG.TOKEN_FILE,
        expect.stringMatching(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/), // IV:TAG:DATA
        expect.objectContaining({ mode: 0o600 })
      );
    });

    it('deve respeitar expiresIn igual a 0 usando operador ??', () => {
        const repository = new JsonTokenRepository();
        const tokens = { access_token: 'abc', expires_in: 3600 };
        
        // expiresIn = 0 deve ser tratado como 0, não sobrescrito por tokens.expires_in
        const result = repository.save(tokens, 0);
        expect(result.expires_at).toBe(fixedNow); // fixedNow + 0
    });

    it('deve lançar erro se o payload for inválido (sem access_token)', () => {
        const repository = new JsonTokenRepository();
        expect(() => repository.save({})).toThrow("Invalid token payload");
        expect(() => repository.save({ access_token: null })).toThrow();
    });

    it('deve lançar erro se ttlSeconds for inválido (não finito ou < 0)', () => {
        const repository = new JsonTokenRepository();
        const tokens = { access_token: 'abc' };
        
        expect(() => repository.save(tokens, NaN)).toThrow("expires_in must be a non-negative number");
        expect(() => repository.save(tokens, -100)).toThrow();
        expect(() => repository.save(tokens, Infinity)).toThrow();
    });
  });

  describe('delete', () => {
    it('deve remover o arquivo quando existir', () => {
      fs.existsSync.mockImplementation((p) => p === CONFIG.TOKEN_FILE);
      const repository = new JsonTokenRepository();
      repository.delete();
      expect(fs.unlinkSync).toHaveBeenCalledWith(CONFIG.TOKEN_FILE);
    });
  });
});
