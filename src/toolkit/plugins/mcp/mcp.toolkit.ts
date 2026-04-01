/**
 * McpAdapterToolkit — bridges MCP servers to the NATS toolkit system.
 *
 * Launches the requested MCP servers as child processes (via stdio transport),
 * discovers their tools via listTools(), and wraps each as a McpToolAdapter
 * (RemoteTool). These are then exposed to the NATS broker via PluginClient.
 *
 * initialize() must be called before getTools() or connect().
 */

import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getDirname } from '../../../utils/paths.js';
import { logger } from '../../../utils/logger.js';
import { ConfigurationError } from '../../../utils/errors.js';
import { BaseRemoteToolkit } from '../../core/base-toolkit.js';
import { McpToolAdapter, type McpToolCaller } from './mcp.adapter.js';
import type { RemoteTool } from '../../core/types.js';

const __dirname = getDirname(import.meta.url);

interface McpServerDefinition {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  description?: string;
}

class McpServerCaller implements McpToolCaller {
  constructor(private readonly client: McpClient, private readonly serverName: string) {}

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const result = await this.client.callTool({ name, arguments: args });
    // MCP callTool returns { content: Array<{ type, text? }> }
    const content = result.content as Array<{ type: string; text?: string }>;
    const text = content.map(c => c.text ?? '').join('\n');
    return text || JSON.stringify(result);
  }
}

export class McpAdapterToolkit extends BaseRemoteToolkit {
  readonly label = 'mcp';
  readonly description = 'MCP server adapter — exposes MCP server tools via NATS';

  private tools: RemoteTool[] = [];
  private clients: McpClient[] = [];

  constructor(
    private readonly serverNames: string[],
    private readonly extraEnv?: Record<string, string>
  ) {
    super();
  }

  /**
   * Launches MCP servers and discovers their tools.
   * Must be called before getTools() or PluginClient.connect().
   */
  async initialize(): Promise<void> {
    const serverDefs = this.loadServerDefinitions();

    for (const serverName of this.serverNames) {
      const def = serverDefs[serverName];
      if (!def) {
        logger.warn(`McpAdapterToolkit: unknown server '${serverName}', skipping`);
        continue;
      }

      try {
        const toolAdapters = await this.connectServer(serverName, def);
        this.tools.push(...toolAdapters);
        logger.debug(`McpAdapterToolkit: loaded ${toolAdapters.length} tools from '${serverName}'`);
      } catch (err) {
        logger.warn(`McpAdapterToolkit: failed to connect to '${serverName}': ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (this.tools.length === 0) {
      throw new ConfigurationError(
        `No MCP tools discovered. Check server names: ${this.serverNames.join(', ')}`
      );
    }

    logger.success(`McpAdapterToolkit: initialized with ${this.tools.length} tools from ${this.clients.length} server(s)`);
  }

  getTools(): RemoteTool[] {
    return this.tools;
  }

  /**
   * Disconnects all MCP server clients.
   */
  async close(): Promise<void> {
    for (const client of this.clients) {
      try {
        await client.close();
      } catch {
        // best effort
      }
    }
  }

  private async connectServer(
    serverName: string,
    def: McpServerDefinition
  ): Promise<McpToolAdapter[]> {
    // Substitute ${FILE_PATHS} and ${DEFAULT_PATH} env var placeholders in args
    const args = (def.args ?? []).map(arg => {
      return arg
        .replace('${FILE_PATHS}', process.env['FILE_PATHS'] ?? process.env['DEFAULT_PATH'] ?? process.cwd())
        .replace('${DEFAULT_PATH}', process.env['DEFAULT_PATH'] ?? process.cwd());
    });

    const transport = new StdioClientTransport({
      command: def.command,
      args,
      env: {
        ...process.env as Record<string, string>,
        ...def.env,
        ...this.extraEnv,
      },
    });

    const client = new McpClient(
      { name: 'codemie-toolkit', version: '1.0.0' },
      { capabilities: {} }
    );

    await client.connect(transport);
    this.clients.push(client);

    const { tools } = await client.listTools();
    const caller = new McpServerCaller(client, serverName);

    return tools.map(tool => new McpToolAdapter(tool, serverName, caller));
  }

  /**
   * Loads server definitions from the bundled servers.json.
   */
  private loadServerDefinitions(): Record<string, McpServerDefinition> {
    const serversPath = join(__dirname, 'servers.json');
    if (!existsSync(serversPath)) {
      return {};
    }
    try {
      return JSON.parse(readFileSync(serversPath, 'utf-8')) as Record<string, McpServerDefinition>;
    } catch {
      return {};
    }
  }

  /**
   * Returns the list of available server names from servers.json.
   */
  static getAvailableServers(): string[] {
    try {
      const serversPath = join(getDirname(import.meta.url), 'servers.json');
      if (!existsSync(serversPath)) return [];
      const defs = JSON.parse(readFileSync(serversPath, 'utf-8')) as Record<string, { description?: string }>;
      return Object.keys(defs);
    } catch {
      return [];
    }
  }

  /**
   * Returns server definitions with descriptions for display.
   */
  static getServerDescriptions(): Record<string, string> {
    try {
      const serversPath = join(getDirname(import.meta.url), 'servers.json');
      if (!existsSync(serversPath)) return {};
      const defs = JSON.parse(readFileSync(serversPath, 'utf-8')) as Record<string, McpServerDefinition>;
      return Object.fromEntries(
        Object.entries(defs).map(([name, def]) => [name, def.description ?? name])
      );
    } catch {
      return {};
    }
  }
}
