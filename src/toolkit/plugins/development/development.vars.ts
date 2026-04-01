/**
 * RemoteToolMetadata constants for the development toolkit tools.
 */

import type { RemoteToolMetadata } from '../../core/types.js';

export const READ_FILE_META: RemoteToolMetadata = {
  name: 'read_file',
  label: 'development',
  description: 'Read the content of a file from the repository',
  reactDescription: 'Use this to read the content of a file. Input: file_path (string).',
};

export const WRITE_FILE_META: RemoteToolMetadata = {
  name: 'write_file',
  label: 'development',
  description: 'Write content to a file in the repository',
  reactDescription: 'Use this to write or overwrite a file. Creates parent directories if needed. Input: file_path (string), content (string).',
};

export const LIST_DIRECTORY_META: RemoteToolMetadata = {
  name: 'list_directory',
  label: 'development',
  description: 'List files and directories at a given path',
  reactDescription: 'Use this to list the contents of a directory. Input: directory (string).',
};

export const RECURSIVE_FILE_RETRIEVAL_META: RemoteToolMetadata = {
  name: 'recursive_file_retrieval',
  label: 'development',
  description: 'Recursively list all files matching an optional glob pattern',
  reactDescription: 'Use this to recursively find files. Input: directory (string), pattern (optional glob string).',
};

export const COMMAND_LINE_META: RemoteToolMetadata = {
  name: 'command_line',
  label: 'development',
  description: 'Execute a shell command in the repository directory',
  reactDescription: 'Use this to run shell commands. Input: command (string), working_dir (optional string).',
};

export const DIFF_UPDATE_FILE_META: RemoteToolMetadata = {
  name: 'diff_update_file',
  label: 'development',
  description: 'Apply SEARCH/REPLACE diff blocks to a file',
  reactDescription:
    'Use this to edit a file using SEARCH/REPLACE blocks. ' +
    'Format: <<<<<<< SEARCH\\n<old content>\\n=======\\n<new content>\\n>>>>>>> REPLACE\\n' +
    'Input: file_path (string), diff_content (string).',
};

export const GENERIC_GIT_META: RemoteToolMetadata = {
  name: 'generic_git',
  label: 'development',
  description: 'Execute a git command in the repository',
  reactDescription: 'Use this to run git commands. Input: command (string, e.g. "status"), args (optional string[]).',
};
