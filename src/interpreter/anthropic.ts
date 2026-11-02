// The real interpreter: Claude Haiku through the SDK with a schema-constrained response (ADR 0004). Imported only by the
// entry point when the fake is not selected, so `pnpm test` never loads it. Retries and timeouts belong to the SDK.

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { ModelOutputSchema } from './schema.js';
import type { Interpreter, ModelOutput } from './types.js';

export const MODEL = 'claude-haiku-5-5';

export interface AnthropicInterpreterOptions {
  /** Monotonic milliseconds, injected so the adapter never reads the clock itself (TIME-1). */
  elapsed: () => number;
  model?: string;
}

export function createAnthropicInterpreter(options: AnthropicInterpreterOptions): Interpreter {
  // Credentials come from the environment (ANTHROPIC_API_KEY, REQ-DL-2). A missing key fails on the first call, never here.
  const client = new Anthropic({ maxRetries: 2, timeout: 30_000 });
  const model = options.model ?? MODEL;
  return {
    interpret: async (_request, prompt): Promise<ModelOutput> => {
      const started = options.elapsed();
      const response = await client.messages.parse({
        model,
        max_tokens: 1024,
        system: prompt.system,
        messages: [{ role: 'user', content: prompt.user }],
        output_config: { format: zodOutputFormat(ModelOutputSchema), effort: 'low' },
      });
      const text = response.content.map((block) => (block.type === 'text' ? block.text : '')).join('');
      return {
        raw: response.parsed_output ?? text,
        model: response.model,
        latencyMs: Math.round(options.elapsed() - started),
        tokens: { input: response.usage.input_tokens, output: response.usage.output_tokens },
      };
    },
    answer: async (_request, prompt): Promise<ModelOutput> => {
      const started = options.elapsed();
      const response = await client.messages.create({
        model,
        max_tokens: 300,
        system: prompt.system,
        messages: [{ role: 'user', content: prompt.user }],
        output_config: { effort: 'low' },
      });
      const text = response.content.map((block) => (block.type === 'text' ? block.text : '')).join('');
      return {
        raw: text,
        model: response.model,
        latencyMs: Math.round(options.elapsed() - started),
        tokens: { input: response.usage.input_tokens, output: response.usage.output_tokens },
      };
    },
  };
}
