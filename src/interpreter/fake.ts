// The scenario interpreter (`AGENT_INTERPRETER=fake`): the "model" returns whatever JSON object the message body is, so
// scenarios script valid and hostile outputs alike. Never the network (testing rule).

import type { Interpreter, ModelOutput } from './types.js';

export const FAKE_MODEL = 'fake';

export function createFakeInterpreter(): Interpreter {
  return {
    interpret: (request): Promise<ModelOutput> => {
      const body = request.body.trim();
      if (body === '@fail') return Promise.reject(new Error('fake interpreter failure'));
      let raw: unknown = { intent: 'unclear', times: [], exclusions: [], quote: body.slice(0, 200) };
      if (body.startsWith('{')) {
        try {
          raw = JSON.parse(body);
        } catch {
          raw = body; // not JSON after all: invalid output, as a broken model answer would be
        }
      }
      return Promise.resolve({ raw, model: FAKE_MODEL, latencyMs: 0, tokens: { input: 0, output: 0 } });
    },
  };
}
