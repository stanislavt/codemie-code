/**
 * Logs analysis toolkit tools.
 */

import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { BaseRemoteTool } from '../../core/base-tool.js';
import { isPathWithinDirectory } from '../../../utils/paths.js';
import { PathSecurityError, ToolExecutionError } from '../../../utils/errors.js';
import { ReadFileTool, ListDirectoryTool, WriteFileTool } from '../development/development.tools.js';
import type { RemoteToolMetadata } from '../../core/types.js';

// Re-export shared tools for use in the toolkit assembly
export { ReadFileTool, ListDirectoryTool, WriteFileTool };

// ---------------------------------------------------------------------------
// ParseLogFileTool
// ---------------------------------------------------------------------------

const PARSE_LOG_META: RemoteToolMetadata = {
  name: 'parse_log_file',
  label: 'logs',
  description: 'Parse and filter a log file, returning relevant lines with statistics',
  reactDescription:
    'Use this to analyze log files. Supports regex filtering and error-only mode. ' +
    'Input: file_path (string), filter_pattern (optional regex), max_lines (optional number), error_only (optional boolean).',
};

export class ParseLogFileTool extends BaseRemoteTool {
  readonly metadata: RemoteToolMetadata = PARSE_LOG_META;

  constructor(private readonly basePath: string = process.cwd()) {
    super();
  }

  getArgsSchema(): Record<string, unknown> {
    return {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to the log file' },
        filter_pattern: {
          type: 'string',
          description: 'Optional regex pattern to filter lines',
        },
        max_lines: {
          type: 'number',
          description: 'Maximum number of lines to return (default: 1000)',
        },
        error_only: {
          type: 'boolean',
          description: 'If true, only return lines matching ERROR/WARN/EXCEPTION/FATAL',
        },
      },
      required: ['file_path'],
    };
  }

  async execute(input: Record<string, unknown>): Promise<string> {
    const filePath = String(input['file_path'] ?? '');
    const filterPattern = input['filter_pattern'] ? String(input['filter_pattern']) : null;
    const maxLines = typeof input['max_lines'] === 'number' ? input['max_lines'] : 1000;
    const errorOnly = input['error_only'] === true;

    const resolved = resolve(this.basePath, filePath);
    if (!isPathWithinDirectory(this.basePath, resolved)) {
      throw new PathSecurityError(filePath, `path is outside the allowed base directory '${this.basePath}'`);
    }

    let content: string;
    try {
      content = await readFile(resolved, 'utf-8');
    } catch (err) {
      throw new ToolExecutionError('parse_log_file', `Cannot read '${filePath}': ${(err as Error).message}`);
    }

    let lines = content.split('\n');
    const totalLines = lines.length;

    // Apply error-only filter
    if (errorOnly) {
      const errorRe = /ERROR|WARN|EXCEPTION|FATAL/i;
      lines = lines.filter(l => errorRe.test(l));
    }

    // Apply custom regex filter
    if (filterPattern) {
      try {
        const re = new RegExp(filterPattern, 'i');
        lines = lines.filter(l => re.test(l));
      } catch {
        throw new ToolExecutionError('parse_log_file', `Invalid filter_pattern regex: ${filterPattern}`);
      }
    }

    const filteredCount = lines.length;

    // Take last max_lines
    if (lines.length > maxLines) {
      lines = lines.slice(lines.length - maxLines);
    }

    const numbered = lines.map((l, i) => `${i + 1}: ${l}`).join('\n');

    const summary = [
      `--- Log Analysis Summary ---`,
      `File: ${filePath}`,
      `Total lines: ${totalLines}`,
      `Matched lines: ${filteredCount}`,
      `Showing: ${lines.length} lines`,
      `---`,
      numbered,
    ].join('\n');

    return summary;
  }
}
