# Tópico: Refatoração do Motor Core (2026-04-06)

## Contexto
O arquivo `chat.js` estava crescendo demais (~500 linhas), misturando lógica de I/O, inicialização e tratamento de comandos. Isso dificultava a manutenção e a escrita de testes unitários.

## Mudanças Realizadas
1.  **Extração do CommandRouter**:
    - Criado `src/interface/CommandRouter.js`.
    - Toda a lógica do `switch(cmd)` foi movida para lá.
    - O router agora recebe dependências via injeção (`deps`), eliminando variáveis globais.
2.  **Segurança e Auditoria**:
    - Implementado log de `[AUDIT]` para o comando `/read` quando usado com a flag `--force` para acessar arquivos fora do workspace.
3.  **Melhoria de Stream**:
    - Adicionado suporte a `DEBUG=true` no parser SSE (`streamResponse`) para capturar e exibir JSON malformado sem quebrar o fluxo.

## Arquivos Relacionados
- `chat.js`: Agora focado apenas no ciclo de vida da CLI.
- `src/interface/CommandRouter.js`: Cérebro da interação de comandos.
- `tests/interface/CommandRouter.test.js`: Suite de testes dedicada.
