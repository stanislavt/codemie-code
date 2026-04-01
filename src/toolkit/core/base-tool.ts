/**
 * Abstract base class for all RemoteTool implementations.
 *
 * Handles:
 * - Input sanitization via allowed/denied pattern validation
 * - NATS subject name prefixing (tool name → _tool_name)
 */

import { PathSecurityError, ToolExecutionError } from '../../utils/errors.js';
import type { RemoteTool, RemoteToolMetadata } from './types.js';

export abstract class BaseRemoteTool implements RemoteTool {
  abstract readonly metadata: RemoteToolMetadata;
  abstract getArgsSchema(): Record<string, unknown>;
  abstract execute(input: Record<string, unknown>): Promise<string>;

  /**
   * Tool name prefixed with `_` for NATS subject routing.
   * Python convention: `read_file` → `_read_file`
   */
  get prefixedName(): string {
    return `_${this.metadata.name}`;
  }

  /**
   * Validates a string value against the tool's allowed/denied pattern lists.
   * Throws PathSecurityError if a denied pattern matches or no allowed pattern matches.
   *
   * @param fieldName - Name of the field being validated (for error messages)
   * @param value - String value to validate
   */
  protected validatePatterns(fieldName: string, value: string): void {
    const { deniedPatterns = [], allowedPatterns = [] } = this.metadata;

    for (const [label, pattern] of deniedPatterns) {
      const re = new RegExp(pattern, 'i');
      if (re.test(value)) {
        throw new PathSecurityError(value, `matches denied pattern [${label}]: ${pattern}`);
      }
    }

    if (allowedPatterns.length > 0) {
      const matched = allowedPatterns.some(([, pattern]) =>
        new RegExp(pattern, 'i').test(value)
      );
      if (!matched) {
        throw new PathSecurityError(
          value,
          `does not match any allowed pattern for tool '${this.metadata.name}'`
        );
      }
    }
  }

  /**
   * Validates the full input object, extracting string values and checking patterns.
   * Subclasses should call this at the start of execute() for string inputs.
   */
  protected sanitizeInput(input: Record<string, unknown>): void {
    const hasPatterns =
      (this.metadata.deniedPatterns?.length ?? 0) > 0 ||
      (this.metadata.allowedPatterns?.length ?? 0) > 0;

    if (!hasPatterns) return;

    for (const [key, value] of Object.entries(input)) {
      if (typeof value === 'string') {
        this.validatePatterns(key, value);
      }
    }
  }

  /**
   * Wraps execute() with error normalization — ensures errors always return string messages.
   */
  async safeExecute(input: Record<string, unknown>): Promise<string> {
    try {
      return await this.execute(input);
    } catch (error) {
      if (error instanceof PathSecurityError || error instanceof ToolExecutionError) {
        throw error;
      }
      throw new ToolExecutionError(
        this.metadata.name,
        error instanceof Error ? error.message : String(error)
      );
    }
  }
}
