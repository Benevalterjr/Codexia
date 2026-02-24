# Codexia - Technical Specification

## 1. Overview
A professional-grade terminal chat interface designed to bridge standard OpenAI Chat models and the specialized Codex API. It features persistent sessions, declarative automation through YAML templates, and custom protocol handling to ensure multi-turn conversation stability.

## 2. Architecture

### 2.1 Component Diagram
```mermaid
graph TD
    User([User]) <--> CLI[chat.js]
    CLI <--> Auth[auth_codex.js]
    CLI <--> API[OpenAI Codex API]
    CLI <--> Storage[(Local Persistence)]
    
    subgraph Local Persistence
        Tokens[openai_tokens.json]
        Session[openai_session.json]
        Auto[automations/*.yaml]
    end
```

### 2.2 Core Files
- `chat.js`: Main entry point, UI loop, and stream management.
- `auth_codex.js`: OAuth 2.0 Device Code Flow implementation.
- `openai_tokens.json`: Secure (local) storage for access and refresh tokens.
- `openai_session.json`: Conversation state (history, model, last response ID).
- `automations/`: Directory for declarative prompt templates.

## 3. Authentication Flow
The application uses the **Device Code Flow** to authenticate ChatGPT accounts (Free/Plus):
1. User receives a 8-character code and a URL.
2. User authenticates via web browser.
3. CLI polls OpenAI for a Bearer Token.
4. Tokens are stored locally and automatically refreshed via `refresh_token` when expired.

## 4. Hybrid Protocol Handling
The engine dynamically adjusts its request payload based on the selected model family:

### 4.1 Chat Models (e.g., `gpt-5.1`)
- **Input Type**: Simple text string.
- **State Management**: Uses `previous_response_id` (Server-side chaining).
- **Instructions**: Sent via the root `instructions` field.

### 4.2 Codex Models (e.g., `gpt-5.1-codex`)
- **Input Type**: Array of structured message objects (`[{ role, content: [{ type, text }] }]`).
- **State Management**: **Manual History Injection**. The CLI sends the last 40 token-messages in every request.
- **Protocol Requirements**: 
    - `store: false` must be explicit.
    - `instructions` (root) is mandatory for API validation but semantically ignored.
    - **Behavior Control**: Real instructions must be injected as a `system` role message at index 0 of the `input` array.

## 5. Automation Engine (/run)
The `/run` command allows execution of YAML-defined tasks:
- **Schema**: Supports `meta`, `context`, `objective`, `style`, and `quality` metrics.
- **Modes**:
    - **Isolated (Default)**: Executes a stateless prompt, displays results in real-time stream, but does not alter active history.
    - **Injected (`--inject`)**: Merges the automation result into the persistent `conversationHistory` for subsequent turn context.

## 6. Persistence Details
Session state is synced to `openai_session.json` after every AI response:
- `currentModel`: Last used model.
- `lastResponseId`: Server ID for Chat models.
- `conversationHistory`: Local buffer for Codex models.

## 7. Commands Reference
- `/help`: Detailed command list.
- `/model <id>`: Switch model and update persistence.
- `/run <file> [--inject]`: Execute a YAML template.
- `/new`: Hard reset of local history and server-side session.
- `/tokens`: Diagnostic view of authentication status and expiration.
