export interface ProviderCallOptions {
  systemPrompt?: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  temperature?: number;
  maxTokens?: number;
}

export interface ProviderCallResult {
  content: string;
  tokensIn: number;
  tokensOut: number;
  modelUsed: string;
  providerUsed: string;
}

export interface AiProvider {
  name: string;
  call(options: ProviderCallOptions): Promise<ProviderCallResult>;
}
