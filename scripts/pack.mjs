#!/usr/bin/env node
/**
 * Cross-platform wrapper around `starlight pack`.
 *
 * Usage:
 *   node scripts/pack.mjs [output-dir] [--release]
 *
 * The output directory defaults to `dist`. Starlight refuses to write into a
 * directory that does not exist yet, so we create it first. `--release` builds
 * an optimized bundle for tagged releases.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const release = args.includes('--release');
const outDir = args.find((arg) => !arg.startsWith('--')) ?? 'dist';
mkdirSync(outDir, { recursive: true });

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const bin = join(
  root,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'starlight.cmd' : 'starlight',
);
const command = ['pack', '-o', outDir];
if (release) command.push('--release');

const result = spawnSync(bin, command, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

process.exit(result.status ?? 1);
