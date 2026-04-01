/**
 * Coding agent tools — 11 filesystem + shell tools as DynamicStructuredTool
 * (LangChain) with Zod schemas.
 *
 * These are compatible with createReactAgent from @langchain/langgraph.
 */

import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { readFile, writeFile, mkdir, readdir, rename } from 'fs/promises';
import { resolve, dirname, join } from 'path';
import fg from 'fast-glob';
import { exec } from '../../utils/exec.js';
import { isPathWithinDirectory } from '../../utils/paths.js';
import { PathSecurityError, ToolExecutionError } from '../../utils/errors.js';
import { DiffUpdateService } from '../plugins/development/services/diff-update.service.js';

const diffService = new DiffUpdateService();

// ---------------------------------------------------------------------------
// Path validation helper
// ---------------------------------------------------------------------------

function validatePath(allowedDirs: string[], inputPath: string): string {
  const resolved = resolve(inputPath);
  const allowed = allowedDirs.some(dir => isPathWithinDirectory(dir, resolved));
  if (!allowed) {
    throw new PathSecurityError(
      inputPath,
      `path is outside the allowed directories: ${allowedDirs.join(', ')}`
    );
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createCodingTools(allowedDirs: string[]): DynamicStructuredTool[] {
  return [

    // 1. read_file
    new DynamicStructuredTool({
      name: 'read_file',
      description: 'Read the complete content of a file.',
      schema: z.object({
        path: z.string().describe('File path to read'),
      }),
      func: async ({ path }) => {
        const resolved = validatePath(allowedDirs, path);
        try {
          return await readFile(resolved, 'utf-8');
        } catch (err) {
          throw new ToolExecutionError('read_file', (err as Error).message);
        }
      },
    }),

    // 2. read_multiple_files
    new DynamicStructuredTool({
      name: 'read_multiple_files',
      description: 'Read multiple files at once. Returns each file path followed by its content.',
      schema: z.object({
        paths: z.array(z.string()).describe('Array of file paths to read'),
      }),
      func: async ({ paths }) => {
        const results: string[] = [];
        for (const path of paths) {
          try {
            const resolved = validatePath(allowedDirs, path);
            const content = await readFile(resolved, 'utf-8');
            results.push(`=== ${path} ===\n${content}`);
          } catch (err) {
            results.push(`=== ${path} ===\nERROR: ${(err as Error).message}`);
          }
        }
        return results.join('\n\n');
      },
    }),

    // 3. write_file
    new DynamicStructuredTool({
      name: 'write_file',
      description: 'Write content to a file, creating parent directories as needed.',
      schema: z.object({
        path: z.string().describe('File path to write'),
        content: z.string().describe('Content to write'),
      }),
      func: async ({ path, content }) => {
        const resolved = validatePath(allowedDirs, path);
        await mkdir(dirname(resolved), { recursive: true });
        await writeFile(resolved, content, 'utf-8');
        return `File written: ${path}`;
      },
    }),

    // 4. edit_file
    new DynamicStructuredTool({
      name: 'edit_file',
      description:
        'Edit a file using SEARCH/REPLACE blocks. Format:\n' +
        '<<<<<<< SEARCH\n<content to find>\n=======\n<replacement>\n>>>>>>> REPLACE',
      schema: z.object({
        path: z.string().describe('File path to edit'),
        diff: z.string().describe('SEARCH/REPLACE diff blocks'),
      }),
      func: async ({ path, diff }) => {
        const resolved = validatePath(allowedDirs, path);
        const original = await readFile(resolved, 'utf-8');
        const updated = diffService.applyDiff(original, diff);
        await writeFile(resolved, updated, 'utf-8');
        return `File edited: ${path}`;
      },
    }),

    // 5. create_directory
    new DynamicStructuredTool({
      name: 'create_directory',
      description: 'Create a directory (and any necessary parent directories).',
      schema: z.object({
        path: z.string().describe('Directory path to create'),
      }),
      func: async ({ path }) => {
        const resolved = validatePath(allowedDirs, path);
        await mkdir(resolved, { recursive: true });
        return `Directory created: ${path}`;
      },
    }),

    // 6. list_directory
    new DynamicStructuredTool({
      name: 'list_directory',
      description: 'List files and subdirectories in a directory.',
      schema: z.object({
        path: z.string().describe('Directory path to list'),
      }),
      func: async ({ path }) => {
        const resolved = validatePath(allowedDirs, path);
        try {
          const entries = await readdir(resolved, { withFileTypes: true });
          return entries
            .map(e => `${e.isDirectory() ? '[DIR] ' : '[FILE]'} ${e.name}`)
            .join('\n') || '(empty)';
        } catch (err) {
          throw new ToolExecutionError('list_directory', (err as Error).message);
        }
      },
    }),

    // 7. directory_tree
    new DynamicStructuredTool({
      name: 'directory_tree',
      description: 'Show a tree view of a directory structure.',
      schema: z.object({
        path: z.string().describe('Root directory path'),
        depth: z.number().optional().describe('Maximum depth (default: 3)'),
      }),
      func: async ({ path, depth = 3 }) => {
        const resolved = validatePath(allowedDirs, path);
        return buildTree(resolved, '', depth, 0);
      },
    }),

    // 8. move_file
    new DynamicStructuredTool({
      name: 'move_file',
      description: 'Move or rename a file or directory.',
      schema: z.object({
        source: z.string().describe('Source path'),
        destination: z.string().describe('Destination path'),
      }),
      func: async ({ source, destination }) => {
        const resolvedSrc = validatePath(allowedDirs, source);
        const resolvedDst = validatePath(allowedDirs, destination);
        await mkdir(dirname(resolvedDst), { recursive: true });
        await rename(resolvedSrc, resolvedDst);
        return `Moved: ${source} → ${destination}`;
      },
    }),

    // 9. search_files
    new DynamicStructuredTool({
      name: 'search_files',
      description: 'Search for files matching a glob pattern or search for text content in files.',
      schema: z.object({
        pattern: z.string().describe('Glob pattern (e.g. "**/*.ts") or text to search for'),
        path: z.string().optional().describe('Base directory to search in (defaults to first allowed dir)'),
        is_content_search: z.boolean().optional().describe('If true, search file contents for the pattern'),
      }),
      func: async ({ pattern, path, is_content_search }) => {
        const basePath = path
          ? validatePath(allowedDirs, path)
          : (allowedDirs[0] ?? process.cwd());

        if (is_content_search) {
          // Content search using grep-like approach
          const files = await fg('**/*', {
            cwd: basePath,
            onlyFiles: true,
            ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**'],
          });

          const matches: string[] = [];
          const re = new RegExp(pattern, 'i');
          for (const file of files.slice(0, 500)) {
            try {
              const content = await readFile(join(basePath, file), 'utf-8');
              const lines = content.split('\n');
              for (let i = 0; i < lines.length; i++) {
                if (re.test(lines[i]!)) {
                  matches.push(`${file}:${i + 1}: ${lines[i]}`);
                }
              }
            } catch {
              // skip unreadable files
            }
          }
          return matches.length > 0 ? matches.join('\n') : '(no matches)';
        }

        // File search by glob pattern
        const files = await fg(pattern, {
          cwd: basePath,
          onlyFiles: false,
          ignore: ['**/node_modules/**', '**/.git/**'],
        });

        return files.length > 0 ? files.join('\n') : '(no files found)';
      },
    }),

    // 10. list_allowed_directories
    new DynamicStructuredTool({
      name: 'list_allowed_directories',
      description: 'List the directories you are allowed to access.',
      schema: z.object({}),
      func: async () => {
        return `Allowed directories:\n${allowedDirs.join('\n')}`;
      },
    }),

    // 11. execute_command
    new DynamicStructuredTool({
      name: 'execute_command',
      description: 'Execute a shell command. Returns stdout and stderr.',
      schema: z.object({
        command: z.string().describe('Shell command to execute'),
        cwd: z.string().optional().describe('Working directory for the command'),
      }),
      func: async ({ command, cwd }) => {
        const workingDir = cwd
          ? validatePath(allowedDirs, cwd)
          : (allowedDirs[0] ?? process.cwd());

        const result = await exec('sh', ['-c', command], {
          cwd: workingDir,
          shell: false,
          timeout: 60_000,
        });

        const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
        return output
          ? `Exit code ${result.code}:\n${output}`
          : `Exit code ${result.code}: (no output)`;
      },
    }),

  ];
}

// ---------------------------------------------------------------------------
// Tree builder helper
// ---------------------------------------------------------------------------

async function buildTree(
  dirPath: string,
  prefix: string,
  maxDepth: number,
  currentDepth: number
): Promise<string> {
  if (currentDepth >= maxDepth) return `${prefix}...\n`;

  let result = '';
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!;
      const isLast = i === entries.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      const childPrefix = isLast ? `${prefix}    ` : `${prefix}│   `;

      if (entry.name.startsWith('.') || ['node_modules', 'dist'].includes(entry.name)) {
        continue;
      }

      result += `${prefix}${connector}${entry.name}${entry.isDirectory() ? '/' : ''}\n`;

      if (entry.isDirectory()) {
        result += await buildTree(
          join(dirPath, entry.name),
          childPrefix,
          maxDepth,
          currentDepth + 1
        );
      }
    }
  } catch {
    // skip unreadable directories
  }
  return result;
}
