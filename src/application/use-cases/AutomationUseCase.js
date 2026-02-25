const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { CONFIG } = require('../../domain/constants');

class AutomationUseCase {
    constructor(chatUseCase) {
        this.chatUseCase = chatUseCase;
    }

    buildPrompt(config) {
        const context = config.context?.description || "";
        const objective = config.objective?.description || "";
        const style = config.style ? `
Estilo:
- Verbosidade: ${config.style.verbosity || "normal"}
- Foco: ${config.style.foco || ""}
- Linguagem: ${config.style.linguagem || ""}
` : "";

        const quality = (config.quality?.criteria || []).length > 0 
            ? `\nCritérios de Qualidade:\n${config.quality.criteria.map(c => `- ${c}`).join('\n')}`
            : "";

        return `
${context}

Objetivo:
${objective}
${style}${quality}
`.trim();
    }

    async execute(accessToken, fileName, inject = false) {
        const filePath = path.join(CONFIG.AUTOMATIONS_DIR, fileName.endsWith('.yaml') ? fileName : `${fileName}.yaml`);

        if (!fs.existsSync(filePath)) {
            throw new Error(`Arquivo não encontrado: ${filePath}`);
        }

        const raw = fs.readFileSync(filePath, 'utf-8');
        const config = yaml.load(raw);
        const prompt = this.buildPrompt(config);
        const targetModel = config.model?.name || this.chatUseCase.state.currentModel;

        const result = await this.chatUseCase.sendMessage(
            accessToken, 
            prompt, 
            targetModel, 
            inject ? this.chatUseCase.state.lastResponseId : null
        );

        return { ...result, config, prompt, targetModel };
    }
}

module.exports = AutomationUseCase;
