/**
 * Development toolkit tools — filesystem + git + diff operations.
 *
 * All tools validate file paths against the configured repoPath using
 * isPathWithinDirectory() from src/utils/paths.ts to prevent directory traversal.
 */

import { readFile, writeFile, readdir, mkdir } from 'fs/promises';
import { resolve, dirname } from 'path';
import fg from 'fast-glob';
import { BaseRemoteTool } from '../../core/base-tool.js';
import { isPathWithinDirectory } from '../../../utils/paths.js';
import { PathSecurityError, ToolExecutionError } from '../../../utils/errors.js';
import { exec } from '../../../utils/exec.js';
import type { RemoteToolMetadata } from '../../core/types.js';
import {
  READ_FILE_META,
  WRITE_FILE_META,
  LIST_DIRECTORY_META,
  RECURSIVE_FILE_RETRIEVAL_META,
  COMMAND_LINE_META,
  DIFF_UPDATE_FILE_META,
  GENERIC_GIT_META,
} from './development.vars.js';
import { DiffUpdateService } from './services/diff-update.service.js';
import { GitService } from './services/git.service.js';

// ---------------------------------------------------------------------------
// Shared path validation helper
// ---------------------------------------------------------------------------

function validatePath(repoPath: string, inputPath: string): string {
  const resolved = resolve(repoPath, inputPath);
  if (!isPathWithinDirectory(repoPath, resolved)) {
    throw new PathSecurityError(
      inputPath,
      `path is outside the allowed repository directory '${repoPath}'`
    );
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// ReadFileTool
// ---------------------------------------------------------------------------

export class ReadFileTool extends BaseRemoteTool {
  readonly metadata: RemoteToolMetadata = READ_FILE_META;

  constructor(private readonly repoPath: string) {
    super();
  }

  getArgsSchema(): Record<string, unknown> {
    return {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to the file (relative or absolute within repo)' },
      },
      required: ['file_path'],
    };
  }

  async execute(input: Record<string, unknown>): Promise<string> {
    const filePath = String(input['file_path'] ?? '');
    const resolved = validatePath(this.repoPath, filePath);
    try {
      const content = await readFile(resolved, 'utf-8');
      return content;
    } catch (err) {
      throw new ToolExecutionError('read_file', `Cannot read '${filePath}': ${(err as Error).message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// WriteFileTool
// ---------------------------------------------------------------------------

export class WriteFileTool extends BaseRemoteTool {
  readonly metadata: RemoteToolMetadata = WRITE_FILE_META;

  constructor(private readonly repoPath: string) {
    super();
  }

  getArgsSchema(): Record<string, unknown> {
    return {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to write (relative or absolute within repo)' },
        content: { type: 'string', description: 'File content to write' },
      },
      required: ['file_path', 'content'],
    };
  }

  async execute(input: Record<string, unknown>): Promise<string> {
    const filePath = String(input['file_path'] ?? '');
    const content = String(input['content'] ?? '');
    const resolved = validatePath(this.repoPath, filePath);
    await mkdir(dirname(resolved), { recursive: true });
    await writeFile(resolved, content, 'utf-8');
    return `File written: ${filePath}`;
  }
}

// ---------------------------------------------------------------------------
// ListDirectoryTool
// ---------------------------------------------------------------------------

export class ListDirectoryTool extends BaseRemoteTool {
  readonly metadata: RemoteToolMetadata = LIST_DIRECTORY_META;

  constructor(private readonly repoPath: string) {
    super();
  }

  getArgsSchema(): Record<string, unknown> {
    return {
      type: 'object',
      properties: {
        directory: { type: 'string', description: 'Directory path to list' },
      },
      required: ['directory'],
    };
  }

  async execute(input: Record<string, unknown>): Promise<string> {
    const directory = String(input['directory'] ?? '.');
    const resolved = validatePath(this.repoPath, directory);

    try {
      const entries = await readdir(resolved, { withFileTypes: true });
      const lines = entries.map(e => `${e.isDirectory() ? 'd' : 'f'} ${e.name}`);
      return lines.join('\n') || '(empty directory)';
    } catch (err) {
      throw new ToolExecutionError('list_directory', `Cannot list '${directory}': ${(err as Error).message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// RecursiveFileRetrievalTool
// ---------------------------------------------------------------------------

export class RecursiveFileRetrievalTool extends BaseRemoteTool {
  readonly metadata: RemoteToolMetadata = RECURSIVE_FILE_RETRIEVAL_META;

  constructor(private readonly repoPath: string) {
    super();
  }

  getArgsSchema(): Record<string, unknown> {
    return {
      type: 'object',
      properties: {
        directory: { type: 'string', description: 'Base directory to search in' },
        pattern: { type: 'string', description: 'Glob pattern to filter files (e.g. "**/*.ts")' },
      },
      required: ['directory'],
    };
  }

  async execute(input: Record<string, unknown>): Promise<string> {
    const directory = String(input['directory'] ?? '.');
    const pattern = input['pattern'] ? String(input['pattern']) : '**/*';
    const resolved = validatePath(this.repoPath, directory);

    const files = await fg(pattern, {
      cwd: resolved,
      onlyFiles: true,
      ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**'],
    });

    if (files.length === 0) return '(no files found)';
    return files.join('\n');
  }
}

// ---------------------------------------------------------------------------
// CommandLineTool
// ---------------------------------------------------------------------------

export class CommandLineTool extends BaseRemoteTool {
  readonly metadata: RemoteToolMetadata = COMMAND_LINE_META;

  constructor(private readonly repoPath: string) {
    super();
  }

  getArgsSchema(): Record<string, unknown> {
    return {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute' },
        working_dir: { type: 'string', description: 'Working directory (relative to repo root)' },
      },
      required: ['command'],
    };
  }

  async execute(input: Record<string, unknown>): Promise<string> {
    const command = String(input['command'] ?? '');
    const workingDirRel = input['working_dir'] ? String(input['working_dir']) : '.';
    const cwd = validatePath(this.repoPath, workingDirRel);

    const result = await exec('sh', ['-c', command], {
      cwd,
      shell: false,
      timeout: 30_000,
    });

    const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
    if (result.code !== 0) {
      return `Exit code ${result.code}:\n${output}`;
    }
    return output || '(no output)';
  }
}

// ---------------------------------------------------------------------------
// DiffUpdateFileTool
// ---------------------------------------------------------------------------

const diffService = new DiffUpdateService();

export class DiffUpdateFileTool extends BaseRemoteTool {
  readonly metadata: RemoteToolMetadata = DIFF_UPDATE_FILE_META;

  constructor(private readonly repoPath: string) {
    super();
  }

  getArgsSchema(): Record<string, unknown> {
    return {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to the file to update' },
        diff_content: {
          type: 'string',
          description:
            'SEARCH/REPLACE blocks. Format:\n' +
            '<<<<<<< SEARCH\n<old content>\n=======\n<new content>\n>>>>>>> REPLACE',
        },
      },
      required: ['file_path', 'diff_content'],
    };
  }

  async execute(input: Record<string, unknown>): Promise<string> {
    const filePath = String(input['file_path'] ?? '');
    const diffContent = String(input['diff_content'] ?? '');
    const resolved = validatePath(this.repoPath, filePath);

    let original = '';
    try {
      original = await readFile(resolved, 'utf-8');
    } catch (err) {
      throw new ToolExecutionError('diff_update_file', `Cannot read '${filePath}': ${(err as Error).message}`);
    }

    const updated = diffService.applyDiff(original, diffContent);
    await writeFile(resolved, updated, 'utf-8');
    return `File updated: ${filePath}`;
  }
}

// ---------------------------------------------------------------------------
// GenericGitTool
// ---------------------------------------------------------------------------

export class GenericGitTool extends BaseRemoteTool {
  readonly metadata: RemoteToolMetadata = GENERIC_GIT_META;

  constructor(private readonly gitService: GitService) {
    super();
  }

  getArgsSchema(): Record<string, unknown> {
    return {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Git subcommand (e.g. "status", "add", "commit")' },
        args: {
          type: 'array',
          items: { type: 'string' },
          description: 'Additional arguments for the git command',
        },
      },
      required: ['command'],
    };
  }

  async execute(input: Record<string, unknown>): Promise<string> {
    const command = String(input['command'] ?? '');
    const args = Array.isArray(input['args'])
      ? (input['args'] as unknown[]).map(String)
      : [];
    return this.gitService.execute(command, args);
  }
}
