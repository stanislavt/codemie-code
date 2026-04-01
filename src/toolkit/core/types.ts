/**
 * Core interfaces and types for the CodeMie Toolkit subsystem.
 *
 * Toolkits are collections of RemoteTool instances that can be connected to a
 * NATS broker and exposed to a remote AI orchestrator (e.g. EPAM DIAL / CodeMie platform).
 */

export interface RemoteToolMetadata {
  /** Tool name — will be prefixed with `_` in NATS subjects */
  name: string;
  /** Toolkit label (e.g. 'development', 'mcp') */
  label?: string;
  /** Human-readable description shown to the remote agent */
  description?: string;
  /** Extended description used in ReAct agent prompts */
  reactDescription?: string;
  /** Allow-list: [label, regex] pairs — input must match ALL patterns */
  allowedPatterns?: [string, string][];
  /** Block-list: [label, regex] pairs — input must not match ANY pattern */
  deniedPatterns?: [string, string][];
}

export interface RemoteTool {
  metadata: RemoteToolMetadata;
  /** Returns JSON Schema for the tool's input parameters */
  getArgsSchema(): Record<string, unknown>;
  /** Executes the tool and returns a string result */
  execute(input: Record<string, unknown>): Promise<string>;
}

export interface RemoteToolkit {
  /** Unique label for this toolkit (used in NATS subjects) */
  readonly label: string;
  readonly description?: string;
  getTools(): RemoteTool[];
}

export interface PluginConfig {
  /** PLUGIN_KEY env var — used as NATS bearer auth token */
  pluginKey: string;
  /** PLUGIN_ENGINE_URI env var — NATS server URL */
  engineUri: string;
  /** PLUGIN_LABEL env var — optional label appended to tool descriptions */
  pluginLabel?: string;
  /** Auto-disconnect timeout in seconds (0 = no timeout) */
  timeout?: number;
}

export interface ToolkitStoredConfig {
  pluginKey?: string;
  engineUri?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPassword?: string;
}
