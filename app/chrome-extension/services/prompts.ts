export interface Prompt {
  id: string;
  name: string;
  description: string;
  content: string;
  category: 'analysis' | 'modification' | 'visualization';
}

export class PromptService {
  private prompts: Map<string, Prompt> = new Map();
  private initialized = false;

  constructor() {
    this.loadPrompts();
  }

  private async loadPrompts(): Promise<void> {
    if (this.initialized) return;

    try {
      // Load prompts from the prompt folder
      const contentAnalyzePrompt: Prompt = {
        id: 'content-analyze',
        name: 'Content Analysis',
        description: 'Analyze and visualize web content with Excalidraw diagrams',
        category: 'analysis',
        content: await this.loadPromptContent('content-analize.md'),
      };

      const modifyWebPrompt: Prompt = {
        id: 'modify-web',
        name: 'Web Modification',
        description: 'Safely modify web pages through content scripts',
        category: 'modification',
        content: await this.loadPromptContent('modify-web.md'),
      };

      const excalidrawPrompt: Prompt = {
        id: 'excalidraw',
        name: 'Excalidraw Control',
        description: 'Create and manipulate Excalidraw diagrams programmatically',
        category: 'visualization',
        content: await this.loadPromptContent('excalidraw-prompt.md'),
      };

      const priceMatchingPrompt: Prompt = {
        id: 'price-matching',
        name: 'Price Matching',
        description: 'Compare prices across popular retailers to find the best deals',
        category: 'analysis',
        content: await this.loadPromptContent('price-matching.md'),
      };

      const movieShowtimesPrompt: Prompt = {
        id: 'movie-showtimes',
        name: 'Movie Showtimes',
        description: 'Find movie showtimes and tickets at local theaters',
        category: 'analysis',
        content: await this.loadPromptContent('movie-showtimes.md'),
      };

      this.prompts.set('content-analyze', contentAnalyzePrompt);
      this.prompts.set('modify-web', modifyWebPrompt);
      this.prompts.set('excalidraw', excalidrawPrompt);
      this.prompts.set('price-matching', priceMatchingPrompt);
      this.prompts.set('movie-showtimes', movieShowtimesPrompt);

      this.initialized = true;
    } catch (error) {
      console.error('Failed to load prompts:', error);
    }
  }

  private async loadPromptContent(filename: string): Promise<string> {
    try {
      // Load prompts from extension resources
      const promptUrl = chrome.runtime.getURL(`prompt/${filename}`);
      const response = await fetch(promptUrl);
      if (!response.ok) {
        throw new Error(`Failed to load prompt: ${response.status} ${response.statusText}`);
      }
      return await response.text();
    } catch (error) {
      console.error(`Failed to load prompt content for ${filename}:`, error);
      throw error;
    }
  }

  async getPrompt(id: string): Promise<Prompt | null> {
    await this.loadPrompts();
    return this.prompts.get(id) || null;
  }

  async getAllPrompts(): Promise<Prompt[]> {
    await this.loadPrompts();
    return Array.from(this.prompts.values());
  }

  async getPromptsByCategory(category: Prompt['category']): Promise<Prompt[]> {
    await this.loadPrompts();
    return Array.from(this.prompts.values()).filter((p) => p.category === category);
  }

  selectPromptByIntent(userMessage: string): string | null {
    const message = userMessage.toLowerCase();

    // Intent detection based on keywords
    if (
      message.includes('movie') ||
      message.includes('showtime') ||
      message.includes('showtimes') ||
      message.includes('theater') ||
      message.includes('theatre') ||
      message.includes('cinema') ||
      message.includes('tickets') ||
      message.includes('playing')
    ) {
      return 'movie-showtimes';
    }

    if (
      message.includes('price') ||
      message.includes('compare') ||
      message.includes('best price') ||
      message.includes('cheapest') ||
      message.includes('retailers') ||
      message.includes('shopping')
    ) {
      return 'price-matching';
    }

    if (
      message.includes('analyze') ||
      message.includes('understand') ||
      message.includes('summarize') ||
      message.includes('diagram')
    ) {
      return 'content-analyze';
    }

    if (
      message.includes('modify') ||
      message.includes('change') ||
      message.includes('remove') ||
      message.includes('add') ||
      message.includes('script')
    ) {
      return 'modify-web';
    }

    if (
      message.includes('excalidraw') ||
      message.includes('draw') ||
      message.includes('create diagram') ||
      message.includes('visualization')
    ) {
      return 'excalidraw';
    }

    // Default to content analysis for general queries
    return 'content-analyze';
  }
}
