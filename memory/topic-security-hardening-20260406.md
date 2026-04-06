# Tópico: Hardening de Tokens (2026-04-06)

## Contexto
O Codexia agora lida com tokens de acesso da Codex API de forma criptografada para evitar exposição inadvertida de tokens em arquivos JSON planos no disco.

## Mudanças Realizadas
1.  **Criptografia**:
    - Implementado `AES-256-GCM` no `JsonTokenRepository.js`.
    - Chave secreta de 32 bytes gerada e armazenada em `.codex_secret`.
2.  **Validações de Integridade**:
    - Agora o sistema verifica se a chave local tem exatamente 32 bytes antes de tentar descriptografar.
    - Adicionado suporte a `CODEX_TOKEN_SECRET` como variável de ambiente (prioridade sobre o arquivo local) para uso em CI/CD.
3.  **Validação de TTL**:
    - `save(tokens, expiresIn)` agora valida se `ttlSeconds` é um número finito e maior ou igual a zero.

## Arquivos Relacionados
- `src/infrastructure/repositories/JsonTokenRepository.js`
- `tests/infrastructure/repositories/JsonTokenRepository.test.js`
- `codex_tokens.json` (Armazena os tokens criptografados)
- `.codex_secret` (Contém a chave de 32 bytes)
