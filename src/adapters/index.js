import { CodexRuntime } from './codex.js';
import { ClaudeRuntime } from './claude.js';
import { DeepSeekRuntime } from './acp.js';
import { OpenCodeRuntime } from './opencode.js';
import { providerCommand } from '../core/process.js';
export const runtimeFactory = (provider, context) => {
  const runtimes = { codex: CodexRuntime, claude: ClaudeRuntime, dsh: DeepSeekRuntime, opencode: OpenCodeRuntime };
  if (!runtimes[provider]) throw new Error('Unsupported provider: ' + provider);
  return runtimes[provider].create(context, providerCommand(provider));
};
