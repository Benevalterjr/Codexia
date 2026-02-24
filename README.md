# 🌌 Codexia 🧬

> **A professional-grade Terminal Engine for OpenAI Codex & Chat models. Optimized for speed, persistence, and declarative automations.**

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Node.js](https://img.shields.io/badge/Node.js-v16%2B-green.svg)](https://nodejs.org/)
[![Model](https://img.shields.io/badge/Model-gpt--5.1--codex-magenta.svg)](https://openai.com/)

---

## 🚀 O que é a Codexia?
O **Codexia** não é apenas mais um cliente de chat. Ele é um **motor cognitivo de terminal** projetado para desenvolvedores que precisam de precisão e automação. Ele resolve a lacuna entre os modelos de chat tradicionais e a API especializada do Codex, garantindo estabilidade de contexto e automação via YAML.

---

## ✨ Funcionalidades Key
- 🧊 **Motor Codex Estabilizado**: Injeção manual de histórico e controle de `system messages` para manter a IA focada.
- ⚡ **Real-time Streaming**: Respostas geradas token por token diretamente no seu terminal.
- 📂 **Automações Declarativas**: Execute tarefas complexas usando templates YAML em `/automations`.
- 💾 **Sessões Persistentes**: Suas conversas e configurações são salvas automaticamente em `openai_session.json`.
- 🔑 **Auth de Dispositivo**: Fluxo seguro de autenticação via browser (Device Code Flow).
- 🧬 **Modo Injeção**: Injete resultados de automações diretamente no histórico da conversa ativa com `--inject`.

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

## 💡 Comandos Rápidos
- `/run <file>.yaml` — Executa uma automação isolada.
- `/run <file>.yaml --inject` — Executa e injeta o resultado no seu chat atual.
- `/model <id>` — Troca de modelo em tempo real.
- `/new` — Limpa o histórico e inicia uma nova sessão limpa.
- `/tokens` — Verifica o status e expiração da sua autenticação.

---

## 📐 Arquitetura
O projeto utiliza uma arquitetura híbrida para lidar com múltiplos protocolos de API:
- **Chat Protocol**: Chaveamento via `previous_response_id`.
- **Codex Protocol**: Gerenciamento manual de buffer (últimas 40 mensagens) e injeção estruturada de payloads.

Para detalhes profundos, consulte o [spec.md](spec.md).

---

## ⚖️ Licença
Distribuído sob a licença **Apache 2.0**. Veja `LICENSE` para mais informações.

---
<p align="center">
  Criado com 💎 pela <b>Dyad Apps</b>
</p>
