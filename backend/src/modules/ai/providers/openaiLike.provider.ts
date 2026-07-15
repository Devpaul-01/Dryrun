import axios from 'axios';
import { AiProvider, ProviderCallOptions, ProviderCallResult } from './types';

interface OpenAiLikeConfig {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

/**
 * Cerebras, Groq, and OpenAI all expose the same OpenAI-compatible
 * `/chat/completions` shape, so one implementation covers all three —
 * avoiding three near-duplicate provider files that would drift out of
 * sync over time.
 */
export function createOpenAiLikeProvider(config: OpenAiLikeConfig): AiProvider {
  return {
    name: config.name,
    async call(options: ProviderCallOptions): Promise<ProviderCallResult> {
      const response = await axios.post(
        `${config.baseUrl}/chat/completions`,
        {
          model: config.model,
          temperature: options.temperature ?? 0.7,
          max_tokens: options.maxTokens ?? 1200,
          messages: [
            ...(options.systemPrompt ? [{ role: 'system', content: options.systemPrompt }] : []),
            ...options.messages,
          ],
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiKey}`,
          },
          timeout: 30000,
        }
      );

      const choice = response.data?.choices?.[0]?.message?.content ?? '';
      const usage = response.data?.usage ?? {};

      return {
        content: choice,
        tokensIn: usage.prompt_tokens ?? 0,
        tokensOut: usage.completion_tokens ?? 0,
        modelUsed: config.model,
        providerUsed: config.name,
      };
    },
  };
}
