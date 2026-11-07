#!/usr/bin/env node

/**
 * Deploys the vajra skill to the Antigravity global skills directory (~/.gemini/config/skills/vajra).
 *
 * Usage:
 *   node .agents/scripts/deploy-global-skill.mjs [options]
 *
 * Options:
 *   --status, -s         Show current deployed skill status and exit
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
let showStatus = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--ref' && args[i + 1]) {
    targetRef = args[++i];
  } else if (args[i] === '--dest' && args[i + 1]) {
    customDest = args[++i];
  } else if (args[i] === '--worktree' || args[i] === '--wip') {
    useWorktree = true;
  } else if (args[i] === '--dry-run') {
    isDryRun = true;
  } else if (args[i] === '--status' || args[i] === '-s') {
    showStatus = true;
  }
}

// Destination path
const destDir = customDest || path.join(os.homedir(), '.gemini', 'config', 'skills', 'vajra');
const infoFile = path.join(destDir, '.deploy-info.json');

// --- Status Command ---
if (showStatus) {
  console.log(`📌 Checking deployed vajra skill status...`);
  console.log(`   Destination:  ${destDir}`);

  if (!fs.existsSync(destDir)) {
    console.log(`   Status:       ❌ Not deployed (directory does not exist)`);
    process.exit(0);
  }

  const skillFile = path.join(destDir, 'SKILL.md');
  if (!fs.existsSync(skillFile)) {
    console.log(`   Status:       ⚠️ Directory exists, but SKILL.md is missing.`);
    process.exit(0);
  }

  if (fs.existsSync(infoFile)) {
    try {
      const info = JSON.parse(fs.readFileSync(infoFile, 'utf8'));
      console.log(`   Status:       ✅ Deployed`);
      console.log(`   Mode:         ${info.mode === 'worktree' ? '🛠️ Worktree (uncommitted WIP changes)' : '📦 Git snapshot'}`);
      console.log(`   Source Ref:   ${info.ref || 'N/A'}${info.commit ? ` (${info.commit})` : ''}`);
      if (info.commitMessage) {
        console.log(`   Commit:       "${info.commitMessage}"`);
      }
      console.log(`   Deployed At:  ${info.deployedAt || 'N/A'}`);
      process.exit(0);
    } catch (e) {
      console.log(`   Status:       ⚠️ Deployed, but .deploy-info.json is corrupted: ${e.message}`);
    }
  } else {
    console.log(`   Status:       ℹ️ Deployed (legacy or manual copy without .deploy-info.json)`);
  }
  process.exit(0);
}

// --- Deploy Execution ---

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

let deployInfo = {
  deployedAt: new Date().toISOString(),
  mode: useWorktree ? 'worktree' : 'git-ref',
};

if (useWorktree) {
  // Mode 1: Direct copy from working tree (uncommitted WIP)
  const sourceDir = path.join(REPO_ROOT, 'skills', 'vajra');
  if (!fs.existsSync(sourceDir)) {
    console.error(`❌ Source directory not found: ${sourceDir}`);
    process.exit(1);
  }

  let currentBranch = 'HEAD';
  let headCommit = '';
  try {
    currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
    headCommit = execSync('git rev-parse --short HEAD', { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  } catch {}

  deployInfo.ref = currentBranch;
  deployInfo.commit = headCommit;
  deployInfo.commitMessage = `Worktree sync based on ${currentBranch} (${headCommit})`;

  const files = getFiles(sourceDir);
  console.log(`   Source:       Working tree (${sourceDir})`);
  console.log(`   Files found:  ${files.length} files (including uncommitted WIP changes)`);

  if (!isDryRun) {
    fs.rmSync(destDir, { recursive: true, force: true });
    fs.mkdirSync(destDir, { recursive: true });
    fs.cpSync(sourceDir, destDir, { recursive: true });
    fs.writeFileSync(infoFile, JSON.stringify(deployInfo, null, 2), 'utf8');
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
  let commitMsg = '';
  try {
    commitHash = execSync(`git rev-parse --short ${refToUse}`, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
    commitMsg = execSync(`git log -1 --format=%s ${refToUse}`, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  } catch (e) {
    console.error(`❌ Failed to resolve git ref "${refToUse}": ${e.message}`);
    process.exit(1);
  }

  deployInfo.ref = refToUse;
  deployInfo.commit = commitHash;
  deployInfo.commitMessage = commitMsg;

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
      fs.writeFileSync(infoFile, JSON.stringify(deployInfo, null, 2), 'utf8');
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
