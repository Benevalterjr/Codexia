# 🛠️ Codexia — Guia de Comandos e Automações

> **O Codexia é um motor de terminal de elite projetado para precisão e autonomia. Abaixo está a documentação detalhada de todas as operações disponíveis.**

---

## 🧭 Comandos de Sessão e Estado

### `/help` ou `/h`
Exibe o menu de ajuda rápido com a lista de comandos e modelos suportados.

### `/model <id>`
Troca o modelo de IA em tempo Real.
- **Exemplo**: `/model gpt-5.3-codex` ou `/model codex-mini-latest`
- **Nota**: A preferência de modelo é salva automaticamente em `codex_session.json`.

### `/new` ou `/clear`
Inicia uma **nova conversa limpa**.
- **O que faz**: Reseta o histórico local (Codex) e o ID de resposta remota (Chat), garantindo um contexto novo sem interferências de prompts anteriores.

### `/tokens`
Exibe o status atual de autenticação criptografada.
- **Informações**: Data de obtenção, data de expiração (PT-BR) e se o token atual ainda é válido.
- **Segurança**: Tokens são armazenados com criptografia `AES-256-GCM` em `codex_tokens.json`.

---

## 📂 Comandos de Workspace e Contexto

### `/read <caminho>`
Comando de introspecção do workspace com sandbox ativo.
- **Arquivos**: Lê o conteúdo de um arquivo e carrega no buffer para análise.
- **Diretórios**: Lista o conteúdo de uma pasta para consciência estrutural.
- **Segurança**: Bloqueia caminhos fora do workspace por padrão. Use `--force` para autorizar acessos externos (gera log de auditoria).

### `/fetch <url>`
Navegação web integrada.
- **O que faz**: Utiliza o motor **Playwright** para extrair o texto principal de qualquer URL pública.
- **Uso**: Útil para carregar documentações de APIs ou bibliotecas externas.

### `/paste` ou `/multiline`
Entra no modo de **colagem múltipla**.
- **Fluxo**: Cole seu código ou texto longo e digite `/done` em uma nova linha para enviar.

### `/write <path> <content>`
Persistência de arquivos via Agente ou Manual.
- **O que faz**: Grava conteúdo em disco.
- **Uso Agêntico**: A IA pode propor este comando para criar memórias (`memory/`) ou atualizar o índice (`MEMORY.md`).
- **Segurança**: Requer autorização explícita (y/N) no terminal e validação de sandbox.

---

## 🚀 Motor de Automação

### `/run <arquivo>.yaml [--inject]`
Executa uma automação declarativa baseada em templates.
- **Parâmetros**:
  - `arquivo`: Nome do arquivo dentro da pasta `/automations`.
  - `--inject`: Insere o resultado da automação no seu histórico de chat atual.

---

## 🔑 Autenticação e Segurança

### `/reauth`
Força o reinício do fluxo de autenticação e regera a chave secreta local.

### `/exit` ou `/q`
Encerra o motor e fecha todas as conexões.

---

## 🛡️ Notas de Hardening (Segurança)

1. **Workspace Sync**: O Codexia opera preferencialmente dentro da pasta raiz do projeto. Qualquer tentativa de leitura ou escrita em arquivos do sistema será barrada pelo sandbox, exigindo o parâmetro `--force`.
2. **Auditoria**: Todas as operações forçadas geram uma tag `[AUDIT]` no log do terminal para garantir transparência total do comportamento da IA sobre o seu sistema de arquivos.
3. **Criptografia**: Se você perder o arquivo `.codex_secret`, seus tokens em `codex_tokens.json` não poderão ser lidos e você precisará de um `/reauth`.

---
<p align="center">
  <i>Documentação sincronizada pelo Assistente Antigravity para o Motor Codexia.</i>
</p>
