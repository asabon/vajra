#!/usr/bin/env node

/**
 * Checks branch isolation rules:
 * - feature/* or fix/*: Must ONLY contain upstream code (e.g., skills/, tests/, examples/, evals/, package.json).
 *   FORBIDDEN: AGENTS.md, .agents/**, docs/**, .githooks/**
 * - docs/*: Must ONLY contain documentation (e.g., docs/**).
 *   FORBIDDEN: skills/**, tests/**, etc.
 * - chore/*: Must ONLY contain harness/tooling (e.g., AGENTS.md, .agents/**, .githooks/**).
 *   FORBIDDEN: skills/**, tests/**, etc.
 *
 * Usage:
 *   node check-branch-isolation.mjs [--branch <branch>] [--base <base_ref>]
 */

import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

const args = process.argv.slice(2);
let branchName = null;
let baseRef = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--branch') {
    branchName = args[i + 1];
    i++;
  } else if (args[i] === '--base') {
    baseRef = args[i + 1];
    i++;
  }
}

// 1. Determine current branch name
if (!branchName) {
  try {
    branchName = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
    }).trim();
  } catch (err) {
    console.error('Failed to get current branch name via git:', err.message);
    process.exit(1);
  }
}

// If on main, develop or detached HEAD, skip branch isolation check
if (branchName === 'main' || branchName === 'develop' || branchName === 'HEAD') {
  console.log(`ℹ️ [Branch Isolation] Skipped on branch: ${branchName}`);
  process.exit(0);
}

// 2. Identify branch type
let branchType = null;
if (branchName.startsWith('feature/') || branchName.startsWith('fix/')) {
  branchType = 'upstream-code';
} else if (branchName.startsWith('docs/')) {
  branchType = 'docs';
} else if (branchName.startsWith('chore/')) {
  branchType = 'harness';
} else if (branchName.startsWith('pr/')) {
  branchType = 'pr';
} else {
  console.log(`ℹ️ [Branch Isolation] Non-prefixed branch: ${branchName} (no strict isolation rules applied)`);
  process.exit(0);
}

// 3. Determine base ref for git diff
if (!baseRef) {
  baseRef = 'develop';
}

console.log(`🔍 [Branch Isolation] Checking ${branchName} against ${baseRef} (Type: ${branchType})...`);

let changedFiles = [];
try {
  const diffOutput = execSync(`git diff --name-only ${baseRef}...HEAD`, {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
  }).trim();
  if (diffOutput) {
    changedFiles = diffOutput.split(/\r?\n/).map(f => f.trim()).filter(Boolean);
  }
} catch (err) {
  console.error(`Failed to get diff against ${baseRef}:`, err.message);
  process.exit(1);
}

if (changedFiles.length === 0) {
  console.log('✅ [Branch Isolation] No changed files detected.');
  process.exit(0);
}

// 4. Rule definitions
const HARNESS_PATTERNS = [
  /^AGENTS\.md$/,
  /^\.agents\//,
  /^\.githooks\//,
  /^\.coderabbit\.ya?ml$/,
  /^docs\//,
];

const CODE_PATTERNS = [
  /^skills\//,
  /^tests\//,
  /^examples\//,
  /^evals\//,
  /^package\.json$/,
  /^package-lock\.json$/,
];

let violations = [];

if (branchType === 'upstream-code' || branchType === 'pr') {
  // Must NOT touch harness files
  for (const file of changedFiles) {
    if (HARNESS_PATTERNS.some(regex => regex.test(file))) {
      violations.push(`[FORBIDDEN] ${file} (Harness/docs files are forbidden in ${branchName})`);
    }
  }
} else if (branchType === 'docs') {
  // Must ONLY touch docs/
  for (const file of changedFiles) {
    if (!file.startsWith('docs/')) {
      violations.push(`[FORBIDDEN] ${file} (Non-doc files are forbidden in ${branchName})`);
    }
  }
} else if (branchType === 'harness') {
  // Must NOT touch core code
  for (const file of changedFiles) {
    if (CODE_PATTERNS.some(regex => regex.test(file))) {
      violations.push(`[FORBIDDEN] ${file} (Core code changes are forbidden in ${branchName})`);
    }
  }
}

// 5. Result
if (violations.length > 0) {
  console.error('\n❌ ==============================================================');
  console.error(' [Branch Isolation Violation Detected]');
  console.error(` Branch: ${branchName}`);
  console.error(' Violations:');
  violations.forEach(v => console.error(`   - ${v}`));
  console.error('==============================================================\n');
  process.exit(1);
}

console.log(`✅ [Branch Isolation] All ${changedFiles.length} changed files comply with branch policy.`);
process.exit(0);
