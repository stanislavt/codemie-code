/**
 * DiffUpdateService — applies SEARCH/REPLACE block diffs to file content.
 *
 * Block format (used by AI coding assistants like Aider, Cursor, etc.):
 *
 *   <<<<<<< SEARCH
 *   content to find (must match exactly or with whitespace normalization)
 *   =======
 *   replacement content
 *   >>>>>>> REPLACE
 *
 * Multiple blocks are applied sequentially.
 * Throws ToolExecutionError if a SEARCH block cannot be found in the content.
 */

import { ToolExecutionError } from '../../../../utils/errors.js';

const SEARCH_MARKER = '<<<<<<< SEARCH';
const SEP_MARKER = '=======';
const REPLACE_MARKER = '>>>>>>> REPLACE';

export interface DiffBlock {
  search: string;
  replace: string;
}

export class DiffUpdateService {
  /**
   * Parses diff content and applies all SEARCH/REPLACE blocks to fileContent.
   * Returns the updated file content.
   */
  applyDiff(fileContent: string, diffContent: string): string {
    const blocks = this.parseBlocks(diffContent);

    if (blocks.length === 0) {
      throw new ToolExecutionError('DiffUpdateService', 'No SEARCH/REPLACE blocks found in diff content');
    }

    let result = fileContent;
    for (const block of blocks) {
      result = this.applyBlock(result, block.search, block.replace);
    }
    return result;
  }

  /**
   * Parses SEARCH/REPLACE blocks from a diff string.
   */
  parseBlocks(diffContent: string): DiffBlock[] {
    const blocks: DiffBlock[] = [];
    const lines = diffContent.split('\n');

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];

      if (line === undefined || !line.trimEnd().endsWith(SEARCH_MARKER.trimStart())) {
        // More flexible: check if line contains the SEARCH marker (handles leading whitespace)
        if (line !== undefined && line.includes(SEARCH_MARKER)) {
          // fall through to block parsing
        } else {
          i++;
          continue;
        }
      }

      // Find the start of this block
      if (line !== undefined && !line.includes(SEARCH_MARKER)) {
        i++;
        continue;
      }

      // Collect SEARCH content
      const searchLines: string[] = [];
      i++;
      while (i < lines.length && lines[i] !== undefined && !lines[i]!.includes(SEP_MARKER)) {
        searchLines.push(lines[i]!);
        i++;
      }

      // Skip === separator
      if (i >= lines.length || lines[i] === undefined || !lines[i]!.includes(SEP_MARKER)) {
        break;
      }
      i++;

      // Collect REPLACE content
      const replaceLines: string[] = [];
      while (i < lines.length && lines[i] !== undefined && !lines[i]!.includes(REPLACE_MARKER)) {
        replaceLines.push(lines[i]!);
        i++;
      }

      // Skip >>>>>>> REPLACE
      i++;

      blocks.push({
        search: searchLines.join('\n'),
        replace: replaceLines.join('\n'),
      });
    }

    return blocks;
  }

  /**
   * Applies a single SEARCH/REPLACE block to content.
   * Strategy:
   *   1. Exact string match
   *   2. Whitespace-normalized match (collapse runs of spaces/tabs)
   */
  private applyBlock(content: string, search: string, replace: string): string {
    // Strategy 1: exact match
    if (content.includes(search)) {
      return content.replace(search, replace);
    }

    // Strategy 2: whitespace-normalized match
    const normalizedContent = this.normalizeWhitespace(content);
    const normalizedSearch = this.normalizeWhitespace(search);

    if (normalizedContent.includes(normalizedSearch)) {
      // Re-apply using the normalized version — rebuild original with replacement
      // Map normalized index back to original content using character-level scan
      const originalIdx = this.findOriginalIndex(content, search);
      if (originalIdx !== -1) {
        const originalMatch = this.findOriginalMatch(content, search);
        if (originalMatch !== null) {
          return content.slice(0, originalMatch.start) + replace + content.slice(originalMatch.end);
        }
      }
      // Fallback: apply on normalized then return (last resort)
      return normalizedContent.replace(normalizedSearch, replace);
    }

    throw new ToolExecutionError(
      'DiffUpdateService',
      `SEARCH block not found in file content.\n` +
      `Search pattern (first 200 chars):\n${search.slice(0, 200)}`
    );
  }

  private normalizeWhitespace(text: string): string {
    // Collapse multiple spaces/tabs to single space, normalize line endings
    return text.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ');
  }

  /**
   * Finds the start index of a (whitespace-flexible) match in original content.
   * Returns -1 if not found.
   */
  private findOriginalIndex(content: string, search: string): number {
    const searchLines = search.split('\n');
    const contentLines = content.split('\n');

    for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
      let match = true;
      for (let j = 0; j < searchLines.length; j++) {
        const cl = contentLines[i + j]?.trim() ?? '';
        const sl = searchLines[j]?.trim() ?? '';
        if (cl !== sl) {
          match = false;
          break;
        }
      }
      if (match) return i;
    }
    return -1;
  }

  /**
   * Returns { start, end } character offsets of the whitespace-flexible match.
   */
  private findOriginalMatch(
    content: string,
    search: string
  ): { start: number; end: number } | null {
    const searchLines = search.split('\n');
    const contentLines = content.split('\n');

    for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
      let match = true;
      for (let j = 0; j < searchLines.length; j++) {
        const cl = contentLines[i + j]?.trim() ?? '';
        const sl = searchLines[j]?.trim() ?? '';
        if (cl !== sl) {
          match = false;
          break;
        }
      }
      if (match) {
        // Compute character positions
        const linesBefore = contentLines.slice(0, i).join('\n');
        const start = linesBefore.length + (i > 0 ? 1 : 0);
        const matchedLines = contentLines.slice(i, i + searchLines.length).join('\n');
        const end = start + matchedLines.length;
        return { start, end };
      }
    }
    return null;
  }
}
