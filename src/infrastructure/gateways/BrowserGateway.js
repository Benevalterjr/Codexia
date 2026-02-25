const { chromium } = require('playwright');

/**
 * BrowserGateway
 * Fornece capacidades de navegação web para o Codexia.
 */
class BrowserGateway {
    constructor() {
        this.browser = null;
    }

    async fetchPageContent(url) {
        if (!this.browser) {
            this.browser = await chromium.launch({ headless: true });
        }

        const context = await this.browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        });

        const page = await context.newPage();
        
        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            
            // Extrai o texto principal (limpa scripts e estilos)
            const content = await page.evaluate(() => {
                const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
                let node;
                let text = '';
                while (node = walker.nextNode()) {
                    const parent = node.parentElement.tagName.toLowerCase();
                    if (!['script', 'style', 'noscript', 'header', 'footer', 'nav'].includes(parent)) {
                        text += node.textContent.trim() + ' ';
                    }
                }
                return text.replace(/\s\s+/g, ' ').substring(0, 5000); // Limite de 5k chars para context
            });

            await context.close();
            return content || "Não foi possível extrair conteúdo da página.";
        } catch (err) {
            await context.close();
            throw new Error(`Falha ao carregar ${url}: ${err.message}`);
        }
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
    }
}

module.exports = BrowserGateway;
