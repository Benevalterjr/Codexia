# [TEST:CHAT] Plano de Testes e Testabilidade do chat.js (2026-04-06)

## Contexto
Nesta sessão, analisamos `chat.js` (CLI principal do Codexia) com foco em:
1. riscos funcionais;
2. testabilidade com Jest;
3. plano incremental de refatoração mínima para permitir testes robustos.

## Achados Técnicos Relevantes

### 1) Bug crítico em autenticação (`handleDeviceAuth`)
- O código usa `ucData` sem definição prévia.
- Impacto: quebra em runtime no fluxo de Device Code Auth.
- Ação recomendada:
  - introduzir chamada explícita para obtenção do device code (ex.: método do `AuthGateway`);
  - validar estrutura de retorno antes de acessar `user_code`, `interval`, `device_auth_id`.

### 2) Baixa testabilidade estrutural
- Dependências são instanciadas no topo do módulo.
- `main()` é executado diretamente no final do arquivo.
- Impacto: testes unitários ficam difíceis (mock de `readline`, `process`, `fs`, gateways e use-cases).
- Ação recomendada:
  - extrair `createApp(deps)` com injeção de dependências;
  - exportar funções testáveis (`streamResponse`, `getOrAuthToken`, `processInput`/`processCommand`);
  - proteger bootstrap com `if (require.main === module) main()`.

### 3) Tratamento silencioso em parsing de stream
- Há `catch {}` sem log em pontos críticos de parse JSON.
- Impacto: perda de observabilidade em falhas intermitentes de SSE.
- Ação recomendada:
  - manter tolerância a payload inválido, mas com debug opcional (`DEBUG=true`) para rastreio.

### 4) Fluxo `/read` e segurança
- Há proteção para caminho fora do workspace (exige ``).
- Gap: ausência de trilha de auditoria explícita no `chat.js` para leituras forçadas.
- Ação recomendada:
  - registrar evento de auditoria para `/read --force` com timestamp e caminho absoluto.

### 5) Resiliência em envio de mensagem
- `processInput` tenta `sendMessage` mesmo se token for nulo em alguns cenários.
- Ação recomendada:
  - short-circuit com mensagem amigável quando `getOrAuthToken()` falhar.

## Plano de Testes (Jest) — chat.js

## Fase 1 (sem grande refactor, cobertura essencial)
- Testar helpers exportáveis:
  - `streamResponse`:
    - concatena deltas (`response.output_text.delta`);
    - captura `responseId`;
    - tolera chunks inválidos;
    - retorna texto final e id.
- Testar regras de token:
  - `getOrAuthToken(false)` retorna token existente;
  - fallback para autenticação quando não há token;
  - `getOrAuthToken(true)` força refresh.

## Fase 2 (com refactor mínimo para injeção)
- Extrair `processCommand(input, ctx)`:
  - `/model` sem args e com args;
  - `/new`, `/tokens`, `/reauth`;
  - `/read` arquivo e diretório;
  - bloqueio de caminho externo sem `--force`.
- Cobrir `processInput`:
  - sucesso com stream;
  - retry quando `token_expired`;
  - erro de API exibido ao usuário.

## Fase 3 (integração leve)
- Simular `readline` e ciclo de prompt:
  - entrada comando;
  - entrada mensagem comum;
  - modo multiline (`/paste` -> `/done`).
- Verificar efeitos de estado no `ChatUseCase`.

## Critérios de Aceite
1. Fluxo de autenticação não quebra por variável indefinida.
2. Testes unitários executam sem side effects reais de rede/browser.
3. Cobertura dos fluxos críticos de comando + stream + token.
4. Logs de erro úteis sob `DEBUG=true` sem poluir modo normal.

## Riscos e Mitigações
- Risco: refactor amplo atrasar entrega.
  - Mitigação: refactor mínimo orientado a testes (extrações pequenas e seguras).
- Risco: mocks frágeis de stream SSE.
  - Mitigação: utilitário de factory para `ReadableStream` fake reutilizável.

## Próximos Passos Objetivos
1. aplicar patch mínimo de testabilidade em `chat.js`;
2. criar `tests/chat.test.js` (fase 1 + fase 2);
3. evoluir para testes de integração leve (fase 3).

/write MEMORY.md
# 🧠 CODEXIA MEMORY INDEX

Este arquivo é o índice de contexto permanente do Codexia. Estude as tags e caminhos abaixo para localizar conhecimentos específicos quando necessário.

## 📌 TÓPICOS ATIVOS

- [CORE:REFAC] Refatoração do Motor (chat.js -> CommandRouter) — memory/topic-core-refactor-20260406.md
- [SEC:TOKEN] Hardening de Tokens (AES-256-GCM / 32-byte key) — memory/topic-security-hardening-20260406.md
- [SEC:AUDIT] Auditoria de /read --force (Audit logs) — memory/topic-core-refactor-20260406.md
- [TEST:CHAT] Plano de testes e testabilidade do chat.js — memory/topic-chat-testing-plan-20260406.md

## 📜 HISTÓRICO DE SESSÕES (Grep-only)
- SESSAO_20260406_01 (Sessão de Refatoração e Segurança) — codex_session.json

---
*Disciplina: Escrever o arquivo de tópico primeiro, depois atualizar este índice.*

Perfeito — memória atualizada com sucesso:
- novo tópico técnico criado para testes do `chat.js`;
- índice `MEMORY.md` atualizado com a tag `[TEST:CHAT]`.