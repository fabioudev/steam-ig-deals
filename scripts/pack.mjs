#!/usr/bin/env node
/**
 * Cross-platform wrapper around `starlight pack`.
 *
 * Usage:
 *   node scripts/pack.mjs [output-dir]
 *
 * The output directory defaults to `dist`. Starlight refuses to write into a
 * directory that does not exist yet, so we create it first.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const outDir = process.argv[2] ?? 'dist';
mkdirSync(outDir, { recursive: true });

const bin = process.platform === 'win32' ? 'starlight.cmd' : 'starlight';
const result = spawnSync(bin, ['pack', '-o', outDir], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

process.exit(result.status ?? 1);
