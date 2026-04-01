/**
 * GitService — wraps git CLI operations via exec().
 *
 * Only a curated allowlist of git commands is permitted to prevent
 * arbitrary shell execution.
 */

import { exec } from '../../../../utils/exec.js';
import { ToolExecutionError } from '../../../../utils/errors.js';

const ALLOWED_GIT_COMMANDS = new Set([
  'add', 'commit', 'push', 'pull', 'status', 'diff',
  'log', 'checkout', 'branch', 'fetch', 'stash', 'merge',
  'show', 'reset', 'rebase', 'tag', 'remote',
]);

export class GitService {
  constructor(private readonly repoPath: string) {}

  /**
   * Executes a git command in the repository directory.
   * @returns stdout of the git command
   */
  async execute(command: string, args: string[] = []): Promise<string> {
    if (!ALLOWED_GIT_COMMANDS.has(command)) {
      throw new ToolExecutionError(
        'git',
        `Command '${command}' is not in the allowed list. Allowed: ${[...ALLOWED_GIT_COMMANDS].join(', ')}`
      );
    }

    const result = await exec('git', [command, ...args], {
      cwd: this.repoPath,
      timeout: 60_000,
    });

    if (result.code !== 0) {
      throw new ToolExecutionError(
        'git',
        `'git ${command}' exited with code ${result.code}: ${result.stderr || result.stdout}`
      );
    }

    return result.stdout;
  }
}
