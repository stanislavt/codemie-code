/**
 * McpToolAdapter — wraps a tool from an MCP server as a RemoteTool.
 *
 * Bridges the MCP tool interface (listTools/callTool) with the RemoteTool
 * interface used by the CodeMie NATS toolkit system.
 */

import { BaseRemoteTool } from '../../core/base-tool.js';
import { ToolExecutionError } from '../../../utils/errors.js';
import type { RemoteToolMetadata } from '../../core/types.js';
import type { Tool as McpToolDef } from '@modelcontextprotocol/sdk/types.js';

export interface McpToolCaller {
  callTool(name: string, args: Record<string, unknown>): Promise<string>;
}

export class McpToolAdapter extends BaseRemoteTool {
  readonly metadata: RemoteToolMetadata;
  private readonly schema: Record<string, unknown>;

  constructor(
    private readonly mcpTool: McpToolDef,
    private readonly serverName: string,
    private readonly caller: McpToolCaller
  ) {
    super();
    this.metadata = {
      name: mcpTool.name,
      label: serverName,
      description: mcpTool.description ?? `MCP tool: ${mcpTool.name} (server: ${serverName})`,
    };
    // Store the JSON Schema from the MCP tool definition
    this.schema = (mcpTool.inputSchema ?? { type: 'object', properties: {} }) as Record<string, unknown>;
  }

  getArgsSchema(): Record<string, unknown> {
    return this.schema;
  }

  async execute(input: Record<string, unknown>): Promise<string> {
    try {
      return await this.caller.callTool(this.mcpTool.name, input);
    } catch (err) {
      throw new ToolExecutionError(
        this.mcpTool.name,
        err instanceof Error ? err.message : String(err)
      );
    }
  }
}
