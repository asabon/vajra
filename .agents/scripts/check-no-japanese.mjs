#!/usr/bin/env node

/**
 * Checks for Japanese characters (Hiragana, Katakana, Kanji, Half-width kana) in upstream code.
 *
 * Scans: skills/vajra/scripts/
 * Skips: README.ja.md, AGENTS.md, .agents/, docs/, tests/ (contains i18n test cases)
 *
 * Usage:
 *   1. Full scan: node check-no-japanese.mjs --all
 *   2. Diff scan: node check-no-japanese.mjs --diff <base-ref>
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

// Target directories for checking (core scripts for upstream)
const TARGET_DIRS = ['skills/vajra/scripts'];

// Regex matching Japanese characters:
// Hiragana: \u3040-\u309F
// Katakana: \u30A0-\u30FF
// Kanji (CJK Unified Ideographs): \u4E00-\u9FFF
// Half-width Katakana: \uFF66-\uFF9F
const JAPANESE_REGEX = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\uFF66-\uFF9F]/;

const args = process.argv.slice(2);
let diffBase = null;
let mode = 'all';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--diff') {
    mode = 'diff';
    diffBase = args[i + 1] || 'HEAD~1';
    i++;
  } else if (args[i] === '--all') {
    mode = 'all';
  }
}

let hasError = false;

function scanText(content, filename) {
  const lines = content.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (JAPANESE_REGEX.test(line)) {
      console.error(`❌ [Japanese detected] ${filename}:${index + 1}`);
      console.error(`   ${line.trim()}`);
      hasError = true;
    }
  });
}

function getAllFiles(dirPath, arrayOfFiles = []) {
  if (!fs.existsSync(dirPath)) return arrayOfFiles;
  const files = fs.readdirSync(dirPath);

  files.forEach(file => {
    const fullPath = path.join(dirPath, file);
    if (fs.statSync(fullPath).isDirectory()) {
      getAllFiles(fullPath, arrayOfFiles);
    } else {
      arrayOfFiles.push(fullPath);
    }
  });

  return arrayOfFiles;
}

if (mode === 'all') {
  console.log('🔍 [check-no-japanese] Running full scan on core script directories...');
  let checkedCount = 0;

  for (const target of TARGET_DIRS) {
    const targetPath = path.join(REPO_ROOT, target);
    const files = getAllFiles(targetPath);

    for (const filePath of files) {
      const ext = path.extname(filePath).toLowerCase();
      if (['.js', '.mjs', '.cjs', '.ts', '.json', '.md', '.sh'].includes(ext)) {
        const relativePath = path.relative(REPO_ROOT, filePath).replace(/\\/g, '/');
        const content = fs.readFileSync(filePath, 'utf-8');
        scanText(content, relativePath);
        checkedCount++;
      }
    }
  }

  console.log(`Scan completed. Checked ${checkedCount} files.`);
} else if (mode === 'diff') {
  console.log(`🔍 [check-no-japanese] Running diff scan against ${diffBase}...`);
  try {
    const diffFiles = execSync(`git diff --name-only ${diffBase} HEAD`, {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
    }).trim().split(/\r?\n/).filter(Boolean);

    let checkedCount = 0;
    for (const file of diffFiles) {
      const normalized = file.replace(/\\/g, '/');
      const isTarget = TARGET_DIRS.some(dir => normalized.startsWith(`${dir}/`));
      if (!isTarget) continue;

      const ext = path.extname(normalized).toLowerCase();
      if (!['.js', '.mjs', '.cjs', '.ts', '.json', '.md', '.sh'].includes(ext)) continue;

      const fullPath = path.join(REPO_ROOT, file);
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        scanText(content, normalized);
        checkedCount++;
      }
    }
    console.log(`Diff scan completed. Checked ${checkedCount} modified files.`);
  } catch (err) {
    console.error(`Failed to execute git diff:`, err.message);
    process.exit(1);
  }
}

if (hasError) {
  console.error('\n❌ Japanese characters detected in upstream code files!');
  console.error('All code comments, logs, and docs for upstream must be written in English.');
  process.exit(1);
} else {
  console.log('✅ No Japanese characters found in checked files.');
  process.exit(0);
}
