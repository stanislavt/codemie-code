/**
 * ToolkitConfigLoader — manages ~/.codemie/toolkit.json configuration.
 *
 * Config priority (highest to lowest):
 *   1. Environment variables (PLUGIN_KEY, PLUGIN_ENGINE_URI, PLUGIN_LABEL)
 *   2. ~/.codemie/toolkit.json stored config
 *   3. Defaults
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { randomUUID } from 'crypto';
import { getCodemiePath } from '../../utils/paths.js';
import { ConfigurationError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import type { PluginConfig, ToolkitStoredConfig } from './types.js';

const CONFIG_FILENAME = 'toolkit.json';

export class ToolkitConfigLoader {
  /**
   * Reads ~/.codemie/toolkit.json. Returns empty object if file doesn't exist.
   */
  static load(): ToolkitStoredConfig {
    const configPath = getCodemiePath(CONFIG_FILENAME);
    if (!existsSync(configPath)) {
      return {};
    }
    try {
      const raw = readFileSync(configPath, 'utf-8');
      return JSON.parse(raw) as ToolkitStoredConfig;
    } catch {
      logger.warn(`ToolkitConfigLoader: failed to parse ${configPath}, using defaults`);
      return {};
    }
  }

  /**
   * Writes the given config to ~/.codemie/toolkit.json.
   */
  static async save(config: ToolkitStoredConfig): Promise<void> {
    const configPath = getCodemiePath(CONFIG_FILENAME);
    const dir = dirname(configPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    logger.debug(`ToolkitConfigLoader: saved to ${configPath}`);
  }

  /**
   * Sets a single key in the stored config.
   */
  static async set(key: keyof ToolkitStoredConfig, value: string | number): Promise<void> {
    const config = ToolkitConfigLoader.load();
    (config as Record<string, unknown>)[key] = value;
    await ToolkitConfigLoader.save(config);
  }

  /**
   * Builds a PluginConfig by merging env vars (priority) with stored config.
   * Throws ConfigurationError if pluginKey is not available.
   */
  static buildPluginConfig(): PluginConfig {
    const stored = ToolkitConfigLoader.load();

    const pluginKey = process.env['PLUGIN_KEY'] ?? stored.pluginKey;
    if (!pluginKey) {
      throw new ConfigurationError(
        'PLUGIN_KEY is required. Set it via the PLUGIN_KEY environment variable or run:\n' +
        '  codemie plugins config generate-key\n' +
        '  codemie plugins config set pluginKey <key>'
      );
    }

    const engineUri =
      process.env['PLUGIN_ENGINE_URI'] ??
      stored.engineUri ??
      'nats://nats-codemie.epmd-edp-anthos.eu.gcp.cloudapp.epam.com:443';

    const pluginLabel = process.env['PLUGIN_LABEL'];

    return {
      pluginKey,
      engineUri,
      pluginLabel,
    };
  }

  /**
   * Generates a new unique plugin key (UUID v4).
   */
  static generatePluginKey(): string {
    return randomUUID();
  }

  /**
   * Returns a display-safe version of the stored config (masks sensitive values).
   */
  static getDisplayConfig(): Record<string, string> {
    const stored = ToolkitConfigLoader.load();
    const display: Record<string, string> = {};

    for (const [key, value] of Object.entries(stored)) {
      if (value === undefined || value === null) continue;
      const isSensitive = ['pluginKey', 'smtpPassword'].includes(key);
      display[key] = isSensitive
        ? `${String(value).slice(0, 4)}${'*'.repeat(8)}`
        : String(value);
    }

    // Also show env var overrides
    if (process.env['PLUGIN_KEY']) display['PLUGIN_KEY (env)'] = '****';
    if (process.env['PLUGIN_ENGINE_URI']) display['PLUGIN_ENGINE_URI (env)'] = process.env['PLUGIN_ENGINE_URI'];
    if (process.env['PLUGIN_LABEL']) display['PLUGIN_LABEL (env)'] = process.env['PLUGIN_LABEL'];

    return display;
  }
}
