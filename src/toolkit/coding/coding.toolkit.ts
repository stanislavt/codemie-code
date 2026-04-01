/**
 * CodingToolkit — assembles the 11 filesystem/shell tools for the coding agent.
 */

import type { DynamicStructuredTool } from '@langchain/core/tools';
import { createCodingTools } from './coding.tools.js';

export interface CodingToolkitOptions {
  allowedDirs: string[];
}

export class CodingToolkit {
  private readonly allowedDirs: string[];

  constructor(options: CodingToolkitOptions) {
    this.allowedDirs = options.allowedDirs.length > 0
      ? options.allowedDirs
      : [process.cwd()];
  }

  getTools(): DynamicStructuredTool[] {
    return createCodingTools(this.allowedDirs);
  }
}
