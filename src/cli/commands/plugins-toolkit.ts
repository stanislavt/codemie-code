/**
 * `codemie plugins` command group — CodeMie Toolkit subsystem.
 *
 * Provides NATS-connected toolkit servers and an interactive coding agent.
 * This is a SEPARATE command group from `codemie plugin` (singular), which
 * manages user extensions (install/uninstall/enable/disable).
 *
 * Commands:
 *   codemie plugins development run
 *   codemie plugins mcp list | run
 *   codemie plugins logs run
 *   codemie plugins notification run
 *   codemie plugins code
 *   codemie plugins config list | get | set | generate-key | local-prompt
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { logger } from '../../utils/logger.js';
import { PluginClient } from '../../toolkit/core/plugin-client.js';
import { ToolkitConfigLoader } from '../../toolkit/core/config.js';
import { FileSystemAndCommandToolkit } from '../../toolkit/plugins/development/development.toolkit.js';
import { McpAdapterToolkit } from '../../toolkit/plugins/mcp/mcp.toolkit.js';
import { LogsAnalysisToolkit } from '../../toolkit/plugins/logs-analysis/logs.toolkit.js';
import { NotificationToolkit } from '../../toolkit/plugins/notification/notification.toolkit.js';
import { CodingAgent } from '../../toolkit/coding/coding.agent.js';
import type { RemoteToolkit } from '../../toolkit/core/types.js';

// ---------------------------------------------------------------------------
// Shared toolkit server runner
// ---------------------------------------------------------------------------

async function runToolkitServer(toolkit: RemoteToolkit, timeoutSec: number): Promise<void> {
  const config = ToolkitConfigLoader.buildPluginConfig();
  const client = new PluginClient(toolkit.getTools(), config);
  await client.connect();

  const shutdown = async (): Promise<void> => {
    console.log(chalk.dim('\nShutting down...'));
    await client.disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  if (timeoutSec > 0) {
    setTimeout(() => void shutdown(), timeoutSec * 1000);
  }

  logger.success(`${toolkit.label} toolkit running. Press Ctrl+C to stop.`);
  await new Promise(() => { /* keep alive */ });
}

// ---------------------------------------------------------------------------
// development
// ---------------------------------------------------------------------------

function createDevelopmentCommand(): Command {
  const cmd = new Command('development').description('Filesystem, git, and diff tools via NATS');

  cmd
    .command('run')
    .description('Start the development toolkit and connect to NATS')
    .option('--repo-path <path>', 'Repository root path', process.cwd())
    .option('--timeout <seconds>', 'Auto-disconnect after N seconds (0 = no timeout)', '0')
    .option('--write-mode <mode>', 'Write mode: "diff" (SEARCH/REPLACE) or "write" (overwrite)', 'diff')
    .action(async (opts) => {
      try {
        const useDiffWrite = opts.writeMode !== 'write';
        const toolkit = new FileSystemAndCommandToolkit(opts.repoPath, useDiffWrite);
        await runToolkitServer(toolkit, Number(opts.timeout));
      } catch (err) {
        console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
      }
    });

  return cmd;
}

// ---------------------------------------------------------------------------
// mcp
// ---------------------------------------------------------------------------

function createMcpCommand(): Command {
  const cmd = new Command('mcp').description('MCP server adapter toolkit via NATS');

  cmd
    .command('list')
    .description('List available MCP servers')
    .action(() => {
      const descriptions = McpAdapterToolkit.getServerDescriptions();
      if (Object.keys(descriptions).length === 0) {
        console.log(chalk.yellow('No MCP servers configured.'));
        return;
      }
      console.log(chalk.bold('\nAvailable MCP servers:\n'));
      for (const [name, desc] of Object.entries(descriptions)) {
        console.log(`  ${chalk.cyan(name.padEnd(16))} ${chalk.dim(desc)}`);
      }
      console.log('');
    });

  cmd
    .command('run')
    .description('Start MCP adapter toolkit and connect to NATS')
    .requiredOption('-s, --servers <servers>', 'Comma-separated list of MCP server names')
    .option('-e, --env <env>', 'Environment variables as KEY=VAL pairs (comma-separated)')
    .option('--timeout <seconds>', 'Auto-disconnect after N seconds (0 = no timeout)', '0')
    .action(async (opts) => {
      try {
        const serverNames = String(opts.servers).split(',').map((s: string) => s.trim());
        const extraEnv: Record<string, string> = {};

        if (opts.env) {
          for (const pair of String(opts.env).split(',')) {
            const [key, ...rest] = pair.trim().split('=');
            if (key && rest.length > 0) extraEnv[key] = rest.join('=');
          }
        }

        const toolkit = new McpAdapterToolkit(serverNames, extraEnv);
        await toolkit.initialize();
        await runToolkitServer(toolkit, Number(opts.timeout));
      } catch (err) {
        console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
      }
    });

  return cmd;
}

// ---------------------------------------------------------------------------
// logs
// ---------------------------------------------------------------------------

function createLogsCommand(): Command {
  const cmd = new Command('logs').description('Log file analysis toolkit via NATS');

  cmd
    .command('run')
    .description('Start the logs analysis toolkit and connect to NATS')
    .option('--base-path <path>', 'Base directory for log files', process.cwd())
    .option('--timeout <seconds>', 'Auto-disconnect after N seconds (0 = no timeout)', '0')
    .action(async (opts) => {
      try {
        const toolkit = new LogsAnalysisToolkit(opts.basePath);
        await runToolkitServer(toolkit, Number(opts.timeout));
      } catch (err) {
        console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
      }
    });

  return cmd;
}

// ---------------------------------------------------------------------------
// notification
// ---------------------------------------------------------------------------

function createNotificationCommand(): Command {
  const cmd = new Command('notification').description('Email notification toolkit via NATS');

  cmd
    .command('run')
    .description('Start the notification toolkit and connect to NATS')
    .option('--timeout <seconds>', 'Auto-disconnect after N seconds (0 = no timeout)', '0')
    .action(async (opts) => {
      try {
        const toolkit = new NotificationToolkit();
        await runToolkitServer(toolkit, Number(opts.timeout));
      } catch (err) {
        console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
      }
    });

  return cmd;
}

// ---------------------------------------------------------------------------
// code (interactive coding agent)
// ---------------------------------------------------------------------------

function createCodeCommand(): Command {
  return new Command('code')
    .description('Start an interactive coding agent (local, no NATS required)')
    .option('--model <model>', 'LLM model name')
    .option('--base-url <url>', 'LLM API base URL')
    .option('--api-key <key>', 'LLM API key')
    .option('--temperature <temp>', 'Sampling temperature (0.0-1.0)', '0.2')
    .option('--allowed-dir <path>', 'Allowed directory for file access (repeatable)', collectValues, [] as string[])
    .option('--mcp-servers <servers>', 'Comma-separated MCP server names to include')
    .option('--debug', 'Enable debug logging')
    .action(async (opts) => {
      try {
        if (opts.debug) process.env['CODEMIE_DEBUG'] = 'true';

        const allowedDirs: string[] = (opts.allowedDir as string[]).length > 0
          ? opts.allowedDir as string[]
          : [process.cwd()];

        const agent = new CodingAgent({
          allowedDirs,
          model: opts.model as string | undefined,
          baseUrl: opts.baseUrl as string | undefined,
          apiKey: opts.apiKey as string | undefined,
          temperature: Number(opts.temperature),
          debug: opts.debug as boolean,
        });

        await agent.initialize();
        await agent.runInteractive();
      } catch (err) {
        console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
      }
    });
}

// ---------------------------------------------------------------------------
// config
// ---------------------------------------------------------------------------

function createConfigCommand(): Command {
  const cmd = new Command('config').description('Manage toolkit configuration (~/.codemie/toolkit.json)');

  cmd
    .command('list')
    .description('Show all toolkit configuration values')
    .action(() => {
      const display = ToolkitConfigLoader.getDisplayConfig();
      if (Object.keys(display).length === 0) {
        console.log(chalk.yellow('\nNo toolkit configuration set.\n'));
        console.log(chalk.dim('Run: codemie plugins config generate-key'));
        return;
      }
      console.log(chalk.bold('\nToolkit configuration:\n'));
      for (const [key, value] of Object.entries(display)) {
        console.log(`  ${chalk.cyan(key.padEnd(24))} ${value}`);
      }
      console.log('');
    });

  cmd
    .command('get <key>')
    .description('Get a configuration value')
    .action((key: string) => {
      const config = ToolkitConfigLoader.load();
      const value = (config as Record<string, unknown>)[key];
      if (value === undefined) {
        console.log(chalk.yellow(`Key '${key}' not set`));
      } else {
        console.log(String(value));
      }
    });

  cmd
    .command('set <key> <value>')
    .description('Set a configuration value')
    .action(async (key: string, value: string) => {
      try {
        const parsed = isNaN(Number(value)) ? value : Number(value);
        await ToolkitConfigLoader.set(key as keyof import('../../toolkit/core/types.js').ToolkitStoredConfig, parsed);
        console.log(chalk.green(`✓ Set ${key} = ${String(parsed)}`));
      } catch (err) {
        console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
      }
    });

  cmd
    .command('generate-key')
    .description('Generate a new plugin key (UUID)')
    .action(async () => {
      const key = ToolkitConfigLoader.generatePluginKey();
      console.log(chalk.bold('\nGenerated plugin key:'));
      console.log(chalk.cyan(key));
      console.log(chalk.dim('\nSave it with:'));
      console.log(chalk.dim(`  codemie plugins config set pluginKey ${key}\n`));

      // Optionally auto-save
      await ToolkitConfigLoader.set('pluginKey', key);
      console.log(chalk.green('✓ Saved to ~/.codemie/toolkit.json'));
    });

  cmd
    .command('local-prompt')
    .description('Manage the local coding agent system prompt (.codemie/prompt.txt)')
    .addCommand(
      new Command('show')
        .description('Show the current local prompt (or default)')
        .action(async () => {
          const promptPath = join(process.cwd(), '.codemie', 'prompt.txt');
          if (existsSync(promptPath)) {
            const content = await readFile(promptPath, 'utf-8');
            console.log(chalk.bold('\nLocal prompt (.codemie/prompt.txt):\n'));
            console.log(content);
          } else {
            console.log(chalk.dim('No local prompt set. Using default CODING_AGENT_PROMPT.'));
          }
        })
    )
    .addCommand(
      new Command('set')
        .description('Set the local coding agent prompt')
        .argument('<text>', 'Prompt text to save')
        .action(async (text: string) => {
          const dir = join(process.cwd(), '.codemie');
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
          const promptPath = join(dir, 'prompt.txt');
          writeFileSync(promptPath, text, 'utf-8');
          console.log(chalk.green(`✓ Prompt saved to ${promptPath}`));
        })
    );

  return cmd;
}

// ---------------------------------------------------------------------------
// Helper: collect repeatable option values
// ---------------------------------------------------------------------------

function collectValues(value: string, prev: string[]): string[] {
  return [...prev, value];
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function createPluginsCommand(): Command {
  const plugins = new Command('plugins')
    .description('CodeMie toolkit: NATS-connected tool servers and interactive coding agent');

  plugins.addCommand(createDevelopmentCommand());
  plugins.addCommand(createMcpCommand());
  plugins.addCommand(createLogsCommand());
  plugins.addCommand(createNotificationCommand());
  plugins.addCommand(createCodeCommand());
  plugins.addCommand(createConfigCommand());

  return plugins;
}
