/**
 * LogsAnalysisToolkit — toolkit for log file inspection and analysis.
 *
 * Tools: ReadFile, ListDirectory, WriteFile, ParseLogFile
 */

import { BaseRemoteToolkit } from '../../core/base-toolkit.js';
import type { RemoteTool } from '../../core/types.js';
import {
  ReadFileTool,
  ListDirectoryTool,
  WriteFileTool,
  ParseLogFileTool,
} from './logs.tools.js';

export class LogsAnalysisToolkit extends BaseRemoteToolkit {
  readonly label = 'logs';
  readonly description = 'Log file inspection and analysis toolkit';

  constructor(private readonly basePath: string = process.cwd()) {
    super();
  }

  getTools(): RemoteTool[] {
    return [
      new ReadFileTool(this.basePath),
      new ListDirectoryTool(this.basePath),
      new WriteFileTool(this.basePath),
      new ParseLogFileTool(this.basePath),
    ];
  }
}
