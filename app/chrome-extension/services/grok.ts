import { GrokMessage, GrokResponse, GrokTool, BrowserContext, TaskResult } from '../types/grok';
import { BACKGROUND_MESSAGE_TYPES } from '../common/message-types';

export class GrokService {
  private apiKey: string | null = null;
  private baseUrl = 'https://api.x.ai/v1';
  private model: string = 'grok-4-fast-reasoning';

  constructor() {
    this.loadApiKey();
    this.loadModel();
  }

  private async loadApiKey(): Promise<void> {
    try {
      const result = await chrome.storage.sync.get(['grok_api_key']);
      this.apiKey = result.grok_api_key || null;
    } catch (error) {
      console.error('Failed to load Grok API key:', error);
    }
  }

  async setApiKey(apiKey: string): Promise<void> {
    this.apiKey = apiKey;
    try {
      await chrome.storage.sync.set({ grok_api_key: apiKey });
    } catch (error) {
      console.error('Failed to save Grok API key:', error);
      throw error;
    }
  }

  private async loadModel(): Promise<void> {
    try {
      const result = await chrome.storage.sync.get(['grok_model']);
      this.model = result.grok_model || 'grok-4-fast-reasoning';
    } catch (error) {
      console.error('Failed to load Grok model:', error);
    }
  }

  async setModel(model: string): Promise<void> {
    this.model = model;
    try {
      await chrome.storage.sync.set({ grok_model: model });
    } catch (error) {
      console.error('Failed to save Grok model:', error);
      throw error;
    }
  }

  async chat(
    messages: GrokMessage[],
    tools?: GrokTool[],
    systemPrompt?: string,
    options?: { concise?: boolean; maxTokens?: number; temperature?: number },
  ): Promise<GrokResponse> {
    if (!this.apiKey) {
      throw new Error('Grok API key not set. Please configure it in settings.');
    }

    const finalMessages: GrokMessage[] = [];

    if (systemPrompt) {
      finalMessages.push({ role: 'system', content: systemPrompt });
    }

    // Inject concise style instruction if requested
    if (options?.concise) {
      finalMessages.unshift({
        role: 'system',
        content:
          'Respond concisely. Use clean markdown with short headings, bullet points, and code fences only when necessary. Avoid verbose prefaces. Prefer links as markdown, keep line length short, and omit redundant explanations.',
      });
    }

    finalMessages.push(...messages);

    const requestBody: any = {
      model: this.model,
      messages: finalMessages,
      max_tokens: options?.maxTokens ?? 800,
      temperature: options?.temperature ?? (options?.concise ? 0.3 : 0.7),
    };

    if (tools && tools.length > 0) {
      requestBody.tools = tools;
      requestBody.tool_choice = 'auto';
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Grok API error (${response.status}): ${error}`);
    }

    return response.json();
  }

  async executeWithPrompt(
    conversationHistory: GrokMessage[],
    promptContent: string,
    context: BrowserContext,
    tools: GrokTool[] = [],
    onThinkingData?: (toolCall: { name: string; description: string; result?: any }) => void,
  ): Promise<TaskResult> {
    try {
      const systemPrompt = this.enrichPromptWithContext(promptContent, context);

      const messages: GrokMessage[] = [...conversationHistory];

      let finalText: string = '';
      const executedToolCalls: { name: string; description: string; result: any }[] = [];

      // Tool call loop: send messages, execute any tool calls, append results, repeat
      for (let step = 0; step < 10; step++) {
        // Increased from 6 to 10 to allow more tool calls
        const response = await this.chat(messages, tools, systemPrompt, {
          concise: true,
          maxTokens: 800,
          temperature: 0.3,
        });
        const choice = response.choices[0];
        if (!choice) {
          throw new Error('No response from Grok');
        }

        // Push assistant turn (with tool_calls if present)
        const assistantTurn: GrokMessage = {
          role: 'assistant',
          content: choice.message.content || '',
          tool_calls: choice.message.tool_calls,
        };
        messages.push(assistantTurn);

        const toolCalls = choice.message.tool_calls || [];
        const content = choice.message.content || '';

        // Extract and emit planning information from assistant response
        if (content && !toolCalls.length) {
          // Look for planning patterns in the response
          const planningPatterns = [
            /I'?ll?\s+(?:plan|need|should|will)\s+to\s+(.+?)(?:\n|$|\.)/gi,
            /First,?\s+(.+?)(?:\n|$|\.)/gi,
            /Then,?\s+(.+?)(?:\n|$|\.)/gi,
            /Next,?\s+(.+?)(?:\n|$|\.)/gi,
            /Finally,?\s+(.+?)(?:\n|$|\.)/gi,
            /Let me\s+(.+?)(?:\n|$|\.)/gi,
            /I'?m\s+going\s+to\s+(.+?)(?:\n|$|\.)/gi,
            /My\s+plan\s+is\s+(.+?)(?:\n|$|\.)/gi,
            /Steps?\s*:\s*(.+?)(?:\n|$|\.)/gi,
            /(\d+)\.\s+(.+?)(?:\n|$|\.)/gi,
          ];

          for (const pattern of planningPatterns) {
            const matches = content.matchAll(pattern);
            for (const match of matches) {
              const planningStep = match[1] || match[2];
              if (planningStep && planningStep.length > 10 && planningStep.length < 200) {
                onThinkingData?.({
                  name: 'Planning',
                  description: `Planning: ${planningStep.trim()}`,
                });
              }
            }
          }
        }

        // If no tool calls, this is the final response
        if (toolCalls.length === 0) {
          finalText = content;
          break;
        }

        // If we've reached the maximum iterations and still have tool calls,
        // break and use whatever content we have, or get a final summary
        if (step === 9 && toolCalls.length > 0) {
          // Make one final call to get the AI's summary without tools
          const finalResponse = await this.chat(messages, [], systemPrompt, {
            concise: true,
            maxTokens: 800,
            temperature: 0.3,
          });
          const finalChoice = finalResponse.choices[0];
          if (finalChoice) {
            finalText =
              finalChoice.message.content || content || 'Task completed with tool executions.';
          } else {
            finalText = content || 'Task completed with tool executions.';
          }
          break;
        }

        // Execute each tool via background proxy
        for (const call of toolCalls) {
          // Emit thinking data when starting tool execution
          onThinkingData?.({
            name: call.function.name,
            description: `Executing ${call.function.name}...`,
          });

          const args = safeParseJson(call.function.arguments);
          const exec = await chrome.runtime.sendMessage({
            type: BACKGROUND_MESSAGE_TYPES.EXECUTE_TOOL,
            name: call.function.name,
            args,
          });

          if (!exec?.success) {
            messages.push({
              role: 'tool',
              name: call.function.name,
              tool_call_id: call.id,
              content: `{"error": ${JSON.stringify(exec?.error || 'tool execution failed')}}`,
            });
            const toolCallResult = {
              name: call.function.name,
              description: `Error executing ${call.function.name}`,
              result: { error: exec?.error },
            };
            executedToolCalls.push(toolCallResult);
            // Emit thinking data with result
            onThinkingData?.(toolCallResult);
          } else {
            const toolResult = exec.result;
            const textPayload = Array.isArray(toolResult?.content)
              ? toolResult.content.find((c: any) => c?.type === 'text')?.text || ''
              : JSON.stringify(toolResult ?? {});
            messages.push({
              role: 'tool',
              name: call.function.name,
              tool_call_id: call.id,
              content: String(textPayload),
            });
            const toolCallResult = {
              name: call.function.name,
              description: `Executed ${call.function.name}`,
              result: toolResult,
            };
            executedToolCalls.push(toolCallResult);
            // Emit thinking data with result
            onThinkingData?.(toolCallResult);
          }
        }
      }

      return {
        success: true,
        message:
          finalText ||
          (executedToolCalls.length > 0
            ? 'Task completed successfully with tool executions.'
            : 'Task completed successfully.'),
        toolCalls: executedToolCalls,
      };
    } catch (error) {
      console.error('Grok execution error:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  private enrichPromptWithContext(prompt: string, context: BrowserContext): string {
    return `${prompt}

## Current Browser Context:
- URL: ${context.url}
- Title: ${context.title}
${context.selectedText ? `- Selected Text: ${context.selectedText}` : ''}
${context.content ? `- Page Content: ${context.content.substring(0, 2000)}...` : ''}

Use this context to better understand the user's current situation and provide more relevant assistance.`;
  }

  async getCurrentBrowserContext(): Promise<BrowserContext> {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab.id || !tab.url || !tab.title) {
        throw new Error('Unable to get current tab information');
      }

      const context: BrowserContext = {
        url: tab.url,
        title: tab.title,
      };

      // Try to get selected text
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => window.getSelection()?.toString() || '',
        });
        if (results[0]?.result) {
          context.selectedText = results[0].result;
        }
      } catch (error) {
        console.warn('Could not get selected text:', error);
      }

      return context;
    } catch (error) {
      console.error('Failed to get browser context:', error);
      throw error;
    }
  }
}

function safeParseJson(input: string): any {
  try {
    return input ? JSON.parse(input) : {};
  } catch {
    return {};
  }
}
