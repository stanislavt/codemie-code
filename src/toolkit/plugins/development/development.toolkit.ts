/**
 * FileSystemAndCommandToolkit — development toolkit for repository operations.
 *
 * Tools:
 *   - ReadFile, ListDirectory, RecursiveFileRetrieval
 *   - DiffUpdateFile (default) or WriteFile (--write-mode write)
 *   - CommandLine (shell execution)
 *   - GenericGit (git operations)
 */

import { BaseRemoteToolkit } from '../../core/base-toolkit.js';
import type { RemoteTool } from '../../core/types.js';
import {
  ReadFileTool,
  WriteFileTool,
  ListDirectoryTool,
  RecursiveFileRetrievalTool,
  CommandLineTool,
  DiffUpdateFileTool,
  GenericGitTool,
} from './development.tools.js';
import { GitService } from './services/git.service.js';

export class FileSystemAndCommandToolkit extends BaseRemoteToolkit {
  readonly label = 'development';
  readonly description = 'Filesystem, shell command, and git operations for a code repository';

  constructor(
    private readonly repoPath: string = process.cwd(),
    private readonly useDiffWrite: boolean = true
  ) {
    super();
  }

  getTools(): RemoteTool[] {
    const gitService = new GitService(this.repoPath);
    return [
      new ReadFileTool(this.repoPath),
      new ListDirectoryTool(this.repoPath),
      new RecursiveFileRetrievalTool(this.repoPath),
      this.useDiffWrite
        ? new DiffUpdateFileTool(this.repoPath)
        : new WriteFileTool(this.repoPath),
      new CommandLineTool(this.repoPath),
      new GenericGitTool(gitService),
    ];
  }
}
