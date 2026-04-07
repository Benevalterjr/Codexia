# 🌌 Codexia 🧬

> **A professional-grade Agentic Engineering Terminal. Optimized for autonomous memory, enterprise-level security, and declarative automations.**

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Node.js](https://img.shields.io/badge/Node.js-v16%2B-green.svg)](https://nodejs.org/)
[![Security](https://img.shields.io/badge/Security-AES--256--GCM-blueviolet.svg)](https://en.wikipedia.org/wiki/Galois/Counter_Mode)

---

## 🚀 O que é a Codexia?

O **Codexia** evoluiu de um simples cliente de chat para um **Motor de Engenharia Autônomo**. Ele é projetado para desenvolvedores que precisam de um agente capaz de gerenciar contexto técnico complexo em longas sessões, com segurança criptográfica e consciência de workspace.

---

## ✨ Funcionalidades Avançadas

- 🧠 **Memória Agêntica Autônoma**: A IA atua como Curadora de Memória, criando tópicos técnicos (`memory/`) e atualizando o índice (`MEMORY.md`) com autorização humana. Toda essa pasta é protegida de versionamento (privada ao usuário).
- 💤 **AutoDream (Consolidação Assíncrona)**: O motor grava silenciosamente telemetria de sessão em `sessions.jsonl` e auto-sintetiza contextos em tópicos `[AUTO:DREAM]`, aliviando o uso de tokens.
- 🛡️ **Hardening de Segurança**: Tokens criptografados com **AES-256-GCM** e sandbox de arquivos que impede acesso fora do workspace por padrão.
- 🧊 **Context Collapse**: Sistema de compressão inteligente que sumariza o histórico de curto prazo ao atingir 40 mensagens.
- 📂 **Introspecção de Workspace**: Comandos integrados para ler arquivos (`/read`), buscar documentações web (`/fetch`) e persistir mudanças (`/write`).
- ⚡ **Real-time Streaming**: Respostas geradas token por token com suporte a modo multiline (`/paste`).

---

## 🛠️ Instalação

1. **Clone o repositório**:
   ```bash
   git clone https://github.com/Benevalterjr/Codexia.git
   cd Codexia
   ```

2. **Instale as dependências**:
   ```bash
   npm install
   ```

3. **Inicie o motor**:
   ```bash
   node chat.js
   ```

---

## 💡 Comandos Essenciais

- `/new` — Reseta estado do servidor local (clear context).
- `/read <path>` — Lê arquivos ou pastas com validação de sandbox.
- `/fetch <url>` — Extrai conteúdo textual de páginas web usando Playwright.
- `/write <path>` — Escrita de arquivos sugerida pelo agente (Human-in-the-Loop).
- `/run <file>.yaml` — Executa padrões declarativos via YAML.
- `/model <id>` — Troca de modelo e persistência de preferência.
- `/tokens` — Diagnóstico de autenticação criptografada.

---

## 📐 Arquitetura

O projeto utiliza **Clean Architecture** para gerenciar a complexidade de um agente autônomo:
- **Domain**: Constantes globais e regras de validação.
- **Infrastructure**: Gateways de API e Repositórios Criptografados.
- **Application**: Casos de uso de Chat, Automação e Sumarização.
- **Interface**: Roteamento desacoplado de comandos via `CommandRouter.js`.

Para detalhes técnicos profundos, consulte o [spec.md](spec.md) e o [COMMANDS.md](COMMANDS.md).

---

## ⚖️ Licença

Distribuído sob a licença **Apache 2.0**. Veja `LICENSE` para mais informações.

---
<p align="center">
  Criado com 💎 pela <b>Dyad Apps</b>
</p>
