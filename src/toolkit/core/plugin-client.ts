/**
 * PluginClient — top-level orchestrator for the CodeMie toolkit NATS integration.
 *
 * Enriches tools (appends plugin label to descriptions), then delegates to NatsClient
 * for all NATS communication.
 *
 * Only implements the experimental protocol (NATS via NatsClient).
 * The Python legacy protocol (per-tool ToolService) is not supported.
 */

import { logger } from '../../utils/logger.js';
import { NatsClient } from './nats-client.js';
import type { RemoteTool, PluginConfig } from './types.js';

export class PluginClient {
  private natsClient!: NatsClient;

  constructor(
    private readonly tools: RemoteTool[],
    private readonly config: PluginConfig
  ) {
    this.enrichTools();
  }

  async connect(): Promise<void> {
    this.natsClient = new NatsClient(this.config, this.tools);
    await this.natsClient.connect();
    logger.success(`Connected to plugin engine: ${this.config.engineUri}`);
  }

  async disconnect(): Promise<void> {
    await this.natsClient.disconnect();
    logger.info('Disconnected from plugin engine');
  }

  /**
   * Enriches tool descriptions by appending the plugin label/key suffix.
   * Mirrors Python client.py's `_enrich_tools_details()`.
   */
  private enrichTools(): void {
    if (!this.config.pluginLabel) return;

    for (const tool of this.tools) {
      const current = tool.metadata.description ?? '';
      tool.metadata.description = current
        ? `${current} (plugin: ${this.config.pluginLabel})`
        : `(plugin: ${this.config.pluginLabel})`;
    }
  }
}
