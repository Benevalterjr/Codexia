'use strict';

const { CONFIG } = require('../domain/constants');

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_MODEL_LABEL   = 'desconhecido';
const DEFAULT_MEMORY_LIMIT  = 2000;
const MEMORY_TRUNCATE_SUFFIX =
    '\n...[MEMORY TRUNCADO — use /read MEMORY.md para ver completo]';

// ─── Memory ───────────────────────────────────────────────────────────────────

/**
 * Truncates a memory index string to the configured character limit.
 *
 * @param {string | null | undefined} memoryIndex
 * @returns {string} Truncated (or original) string, never null/undefined.
 */
function truncateMemory(memoryIndex) {
    if (!memoryIndex) return '';

    const limit = CONFIG.MAX_MEMORY_INJECT_CHARS ?? DEFAULT_MEMORY_LIMIT;

    return memoryIndex.length <= limit
        ? memoryIndex
        : memoryIndex.slice(0, limit) + MEMORY_TRUNCATE_SUFFIX;
}

// ─── Section builders ─────────────────────────────────────────────────────────

/**
 * Builds the memory block injected into system prompts, or returns an empty
 * string when there is no memory to inject.
 *
 * @param {string | null | undefined} memoryIndex
 * @param {{ header?: string; footer?: string; emptyLabel?: string }} [opts]
 * @returns {string}
 */
function buildMemorySection(memoryIndex, opts = {}) {
    const {
        header     = '--- 🧠 MEMORY INDEX (Contexto Permanente) ---',
        footer     = '--------------------------------------------',
        emptyLabel = null,
    } = opts;

    const content = truncateMemory(memoryIndex);

    if (!content) {
        return emptyLabel ? `${header}\n${emptyLabel}\n${footer}` : '';
    }

    return `\n${header}\n${content}\n${footer}\n`;
}

// ─── Prompt builders ──────────────────────────────────────────────────────────

/**
 * Builds the default (chat) system prompt.
 *
 * @param {string | null | undefined} model
 * @param {string | null | undefined} memoryIndex
 * @returns {string}
 */
function buildDefaultInstructions(model, memoryIndex) {
    const modelLabel    = model || DEFAULT_MODEL_LABEL;
    const memorySection = buildMemorySection(memoryIndex);

    return `\
Você é o motor cognitivo do Codexia, um terminal avançado para Codex e Chat.
MODELO ATUAL: ${modelLabel}

Você possui comandos especiais que o usuário executa:
- /read <caminho>: Lê um arquivo ou lista um diretório.
- /fetch <url>: Busca conteúdo web.
- /run <automation>: Executa tarefas YAML.
- /paste: Modo de colagem múltipla.

Quando o usuário usa /read em uma pasta, eu injetarei a lista de arquivos para você. \
Use essa informação para ajudar o usuário a navegar e analisar o código. \
Suas respostas devem ser precisas e você tem consciência situacional de que está rodando \
em um terminal Node.js.
${memorySection}`;
}

/**
 * Builds the Codex (agent) system prompt with memory-management instructions.
 *
 * @param {string | null | undefined} currentModel
 * @param {string | null | undefined} memoryIndex
 * @returns {string}
 */
function buildCodexInstructions(currentModel, memoryIndex) {
    const modelLabel    = currentModel || DEFAULT_MODEL_LABEL;
    const memorySection = buildMemorySection(memoryIndex, {
        header     : '--- 🧠 MEMORY INDEX ATUAL (Contexto Permanente) ---',
        footer     : '--------------------------------------------------',
        emptyLabel : 'O índice de memória está vazio no momento.',
    });

    return `\
# ROLE: ${modelLabel} — Codexia Advanced Assistant

Você é um assistente de engenharia altamente técnico e proativo operando no Codexia CLI.

SEU OBJETIVO: Atuar como um AGENTE que não apenas resolve problemas, mas gerencia a própria \
memória de longo prazo do projeto para garantir continuidade.

## 🧠 AUTOGESTÃO DE MEMÓRIA (Disciplina Claude Code)

Você é o CURADOR da memória do projeto. Sua tarefa é manter o arquivo \`MEMORY.md\` (Índice) \
e a pasta \`memory/\` (Tópicos) sempre atualizados.

Sempre que houver um progresso significativo, uma decisão de arquitetura ou um bug complexo resolvido:
1. Use \`/write memory/topic-<contexto>-<data>.md\` para salvar os detalhes técnicos.
2. Use \`/write MEMORY.md\` para atualizar o índice com o novo ponteiro (máximo 150 chars/linha).
3. Mantenha o índice conciso e denso.

## 🛠️ COMANDOS DISPONÍVEIS (Modo Agente)

- \`/write <path>\`: Cria ou atualiza arquivos. O conteúdo deve vir imediatamente após o caminho.
- \`/read <path>\`: Leia arquivos ou liste diretórios.
- \`/fetch <url>\`: Busque conteúdo web para contexto.
- \`/run <automation.yaml>\`: Execute fluxos de automação.

## 📝 FORMATO DO ÍNDICE (MEMORY.md)

Mantenha este padrão estrito:
  [TAG:ID] Descrição curta — memory/topic-nome-data.md

${memorySection}
HISTÓRICO DA SESSÃO ATUAL:`;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
    buildDefaultInstructions,
    buildCodexInstructions,
    // exported for unit testing
    _truncateMemory : truncateMemory,
    _buildMemorySection: buildMemorySection,
};
