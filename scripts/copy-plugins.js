#!/usr/bin/env node

/**
 * Cross-platform script to copy plugin assets from src/ to dist/
 * Works on Windows, macOS, and Linux
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { rmSync, mkdirSync, cpSync, existsSync, copyFileSync, statSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

const copyConfigs = [
  {
    name: 'Claude plugin',
    src: join(rootDir, 'src/agents/plugins/claude/plugin'),
    dest: join(rootDir, 'dist/agents/plugins/claude/plugin')
  },
  {
    name: 'Gemini extension',
    src: join(rootDir, 'src/agents/plugins/gemini/extension'),
    dest: join(rootDir, 'dist/agents/plugins/gemini/extension')
  },
  {
    name: 'MCP toolkit servers.json',
    src: join(rootDir, 'src/toolkit/plugins/mcp/servers.json'),
    dest: join(rootDir, 'dist/toolkit/plugins/mcp/servers.json')
  }
];

console.log('Copying plugin assets...\n');

for (const config of copyConfigs) {
  console.log(`Processing ${config.name}:`);

  // Remove destination if it exists
  if (existsSync(config.dest)) {
    console.log(`  - Removing old ${config.dest}`);
    rmSync(config.dest, { recursive: true, force: true });
  }

  // Check if source exists
  if (!existsSync(config.src)) {
    console.log(`  - Warning: Source ${config.src} does not exist, skipping...`);
    continue;
  }

  // Create parent directories
  const srcStat2 = statSync(config.src);
  const destDir = srcStat2.isDirectory() ? config.dest : dirname(config.dest);
  console.log(`  - Creating ${destDir}`);
  mkdirSync(destDir, { recursive: true });

  // Copy recursively (directory) or as single file
  console.log(`  - Copying from ${config.src}`);
  const srcStat = statSync(config.src);
  if (srcStat.isDirectory()) {
    cpSync(config.src, config.dest, { recursive: true });
  } else {
    copyFileSync(config.src, config.dest);
  }

  console.log(`  ✓ ${config.name} copied successfully\n`);
}

console.log('Plugin assets copied successfully!');
