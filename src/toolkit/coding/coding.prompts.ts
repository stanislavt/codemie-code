/**
 * System prompts for the interactive coding agent.
 *
 * Loads a custom prompt from .codemie/prompt.txt if it exists in the cwd,
 * otherwise uses the default CODING_AGENT_PROMPT.
 */

import { readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { logger } from '../../utils/logger.js';

export const CODING_AGENT_PROMPT = `You are an expert software engineer and coding assistant with deep knowledge of software development, system design, and best practices.

You have access to tools that allow you to:
- Read and write files in the allowed directories
- Search for files and content
- Execute shell commands
- Navigate directory structures

Guidelines:
1. Always read a file before modifying it to understand its current content
2. Make targeted, minimal changes — avoid rewriting entire files when a small edit suffices
3. Explain what you are doing and why before taking actions
4. If you are unsure about something, read more context before proceeding
5. Use the search_files tool to find relevant files rather than guessing paths
6. Prefer editing existing files over creating new ones
7. When executing commands, explain what they do and check the output
8. Never hardcode secrets, credentials, or sensitive data into files

When you encounter an error:
1. Read the full error message carefully
2. Look at the relevant code
3. Diagnose the root cause before attempting a fix
4. Test your fix by re-running the relevant code/tests

Always strive for clean, readable, and maintainable code.`;

/**
 * Loads the system prompt.
 * Priority:
 *   1. .codemie/prompt.txt in the current working directory
 *   2. Default CODING_AGENT_PROMPT
 */
export async function loadSystemPrompt(cwd: string = process.cwd()): Promise<string> {
  const localPromptPath = join(cwd, '.codemie', 'prompt.txt');
  if (existsSync(localPromptPath)) {
    try {
      const custom = await readFile(localPromptPath, 'utf-8');
      logger.debug(`CodingAgent: using custom prompt from ${localPromptPath}`);
      return custom.trim();
    } catch {
      logger.warn(`CodingAgent: failed to read custom prompt from ${localPromptPath}, using default`);
    }
  }
  return CODING_AGENT_PROMPT;
}
