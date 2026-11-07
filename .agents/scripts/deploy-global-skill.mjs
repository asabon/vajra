#!/usr/bin/env node

/**
 * Deploys the vajra skill to the Antigravity global skills directory (~/.gemini/config/skills/vajra).
 *
 * Usage:
 *   node .agents/scripts/deploy-global-skill.mjs [options]
 *
 * Options:
 *   --worktree, --wip    Deploy directly from working tree (including uncommitted changes)
 *   --ref <ref>          Deploy clean snapshot from specific git branch/tag/commit (default: current HEAD)
 *   --dest <path>        Custom destination path (default: ~/.gemini/config/skills/vajra)
 *   --dry-run            Simulate deployment without modifying any files
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

const args = process.argv.slice(2);
let targetRef = null;
let customDest = null;
let isDryRun = false;
let useWorktree = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--ref' && args[i + 1]) {
    targetRef = args[++i];
  } else if (args[i] === '--dest' && args[i + 1]) {
    customDest = args[++i];
  } else if (args[i] === '--worktree' || args[i] === '--wip') {
    useWorktree = true;
  } else if (args[i] === '--dry-run') {
    isDryRun = true;
  }
}

// Destination path
const destDir = customDest || path.join(os.homedir(), '.gemini', 'config', 'skills', 'vajra');

function getFiles(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (fs.statSync(p).isDirectory()) getFiles(p, files);
    else files.push(p);
  }
  return files;
}

console.log(`📦 Deploying vajra skill to Antigravity global directory...`);
console.log(`   Destination:  ${destDir}`);
if (isDryRun) {
  console.log(`   Mode:         Dry-run (no files will be modified)`);
}

if (useWorktree) {
  // Mode 1: Direct copy from working tree (uncommitted WIP)
  const sourceDir = path.join(REPO_ROOT, 'skills', 'vajra');
  if (!fs.existsSync(sourceDir)) {
    console.error(`❌ Source directory not found: ${sourceDir}`);
    process.exit(1);
  }

  const files = getFiles(sourceDir);
  console.log(`   Source:       Working tree (${sourceDir})`);
  console.log(`   Files found:  ${files.length} files (including uncommitted WIP changes)`);

  if (!isDryRun) {
    fs.rmSync(destDir, { recursive: true, force: true });
    fs.mkdirSync(destDir, { recursive: true });
    fs.cpSync(sourceDir, destDir, { recursive: true });
    console.log(`✅ Successfully deployed working tree to Antigravity global skills directory!`);
    console.log(`   ${destDir}`);
  } else {
    console.log(`ℹ️ [Dry-run] Would copy ${files.length} files from working tree to ${destDir}`);
  }
} else {
  // Mode 2: Clean snapshot from Git commit/branch
  let branchName = 'HEAD';
  try {
    branchName = execSync('git rev-parse --abbrev-ref HEAD', { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  } catch {}

  const refToUse = targetRef || (branchName !== 'HEAD' ? branchName : 'HEAD');
  let commitHash = '';
  try {
    commitHash = execSync(`git rev-parse --short ${refToUse}`, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  } catch (e) {
    console.error(`❌ Failed to resolve git ref "${refToUse}": ${e.message}`);
    process.exit(1);
  }

  console.log(`   Source Ref:   ${refToUse} (${commitHash})`);

  // Check for uncommitted changes in skills/vajra and display friendly notice
  try {
    const uncommitted = execSync('git status --porcelain skills/vajra', { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
    if (uncommitted && !targetRef) {
      console.log(`   ⚠️ Notice:     Uncommitted changes exist in skills/vajra.`);
      console.log(`                 Deploying last committed state (${commitHash}).`);
      console.log(`                 To include uncommitted WIP changes, use: --worktree (or --wip)`);
    }
  } catch {}

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vajra-deploy-'));
  try {
    execSync(`git archive ${refToUse} skills/vajra | tar -x -C "${tmpDir}"`, { cwd: REPO_ROOT, stdio: 'pipe' });
    const extractedDir = path.join(tmpDir, 'skills', 'vajra');
    if (!fs.existsSync(extractedDir)) {
      throw new Error(`Extracted archive did not contain skills/vajra/`);
    }

    const files = getFiles(extractedDir);
    console.log(`   Files found:  ${files.length} files`);

    if (!isDryRun) {
      fs.rmSync(destDir, { recursive: true, force: true });
      fs.mkdirSync(destDir, { recursive: true });
      fs.cpSync(extractedDir, destDir, { recursive: true });
      console.log(`✅ Successfully deployed ${refToUse} (${commitHash}) to Antigravity global skills directory!`);
      console.log(`   ${destDir}`);
    } else {
      console.log(`ℹ️ [Dry-run] Would copy ${files.length} files to ${destDir}`);
    }
  } catch (e) {
    console.error(`❌ Deployment failed: ${e.message}`);
    process.exit(1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
