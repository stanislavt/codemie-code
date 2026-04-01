/**
 * CodingAgent — interactive LangGraph ReAct agent for local filesystem coding tasks.
 *
 * Purely local — no NATS connection needed.
 *
 * LLM configuration priority:
 *   1. env vars: LLM_SERVICE_BASE_URL + LLM_SERVICE_API_KEY + LLM_MODEL
 *   2. active codemie profile (ConfigLoader.load) → baseUrl + apiKey + model
 *      (all providers expose OpenAI-compatible API via proxy)
 */

import readline from 'readline';
import chalk from 'chalk';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage, BaseMessage } from '@langchain/core/messages';
import { ConfigLoader } from '../../utils/config.js';
import { logger } from '../../utils/logger.js';
import { ConfigurationError } from '../../utils/errors.js';
import { CodingToolkit } from './coding.toolkit.js';
import { loadSystemPrompt } from './coding.prompts.js';

export interface CodingAgentOptions {
  allowedDirs?: string[];
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  temperature?: number;
  debug?: boolean;
}

type ReactAgent = ReturnType<typeof createReactAgent>;

export class CodingAgent {
  private agent!: ReactAgent;
  private systemPrompt!: string;
  private initialized = false;

  constructor(private readonly options: CodingAgentOptions = {}) {}

  async initialize(): Promise<void> {
    const llm = await this.buildLlm();
    const allowedDirs = this.options.allowedDirs?.length
      ? this.options.allowedDirs
      : [process.cwd()];

    const tools = new CodingToolkit({ allowedDirs }).getTools();
    this.agent = createReactAgent({ llm, tools });
    this.systemPrompt = await loadSystemPrompt(process.cwd());
    this.initialized = true;

    logger.debug('CodingAgent: initialized', {
      allowedDirs,
      model: this.options.model ?? 'from config',
    });
  }

  /**
   * Interactive REPL — reads lines from stdin, streams agent output.
   * Exits on Ctrl+C or empty input after newline.
   */
  async runInteractive(): Promise<void> {
    if (!this.initialized) await this.initialize();

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    console.log(chalk.bold.cyan('\nCodeMie Coding Agent'));
    console.log(chalk.dim(`Allowed dirs: ${this.options.allowedDirs?.join(', ') ?? process.cwd()}`));
    console.log(chalk.dim('Type your request and press Enter. Press Ctrl+C to exit.\n'));

    for await (const line of rl) {
      const input = line.trim();
      if (!input) continue;

      console.log(chalk.dim('\n─────────────────────────────────'));
      try {
        const response = await this.run(input);
        console.log(chalk.white(response));
      } catch (err) {
        console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
      }
      console.log(chalk.dim('─────────────────────────────────\n'));
    }
  }

  /**
   * Single-turn execution — returns the agent's final answer.
   */
  async run(input: string): Promise<string> {
    if (!this.initialized) await this.initialize();

    const messages: BaseMessage[] = [
      new SystemMessage(this.systemPrompt),
      new HumanMessage(input),
    ];

    const result = await this.agent.invoke({ messages });
    const lastMessage = result.messages[result.messages.length - 1];
    return typeof lastMessage?.content === 'string'
      ? lastMessage.content
      : JSON.stringify(lastMessage?.content ?? '');
  }

  // ---------------------------------------------------------------------------

  private async buildLlm(): Promise<ChatOpenAI> {
    // Priority 1: explicit options
    let baseUrl = this.options.baseUrl;
    let apiKey = this.options.apiKey;
    let model = this.options.model;

    // Priority 2: env vars (matching Python behavior)
    if (!baseUrl) baseUrl = process.env['LLM_SERVICE_BASE_URL'];
    if (!apiKey) apiKey = process.env['LLM_SERVICE_API_KEY'];
    if (!model) model = process.env['LLM_MODEL'];

    // Priority 3: active codemie profile
    if (!baseUrl || !apiKey) {
      try {
        const profile = await ConfigLoader.load(process.cwd());
        if (!baseUrl) baseUrl = profile.baseUrl;
        if (!apiKey) apiKey = profile.apiKey;
        if (!model) model = profile.model;
        logger.debug('CodingAgent: using active profile config');
      } catch {
        // No profile configured
      }
    }

    if (!baseUrl || !apiKey) {
      throw new ConfigurationError(
        'LLM configuration required. Set LLM_SERVICE_BASE_URL + LLM_SERVICE_API_KEY env vars, ' +
        'or configure a codemie profile with: codemie setup'
      );
    }

    return new ChatOpenAI({
      configuration: { baseURL: baseUrl },
      openAIApiKey: apiKey,
      modelName: model ?? 'anthropic.claude-3-7-sonnet-20250219-v1:0',
      temperature: this.options.temperature ?? 0.2,
      streaming: false,
    });
  }
}
