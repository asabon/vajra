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
 *   --help, -h           Show this help message and exit
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

/**
 * Prints the CLI usage message and terminates the process.
 *
 * @param {number} [exitCode=0] - The exit code to terminate with.
 * @returns {never}
 */
function printUsageAndExit(exitCode = 0) {
  const msg = `Usage:
  node .agents/scripts/deploy-global-skill.mjs [options]

Options:
  --status, -s         Show current deployed skill status and exit
  --worktree, --wip    Deploy directly from working tree (including uncommitted changes)
  --ref <ref>          Deploy clean snapshot from specific git branch/tag/commit (default: current HEAD)
  --dest <path>        Custom destination path (default: ~/.gemini/config/skills/vajra)
  --dry-run            Simulate deployment without modifying any files
  --help, -h           Show this help message and exit`;

  if (exitCode === 0) {
    console.log(msg);
  } else {
    console.error(msg);
  }
  process.exit(exitCode);
}

const args = process.argv.slice(2);
let targetRef = null;
let customDest = null;
let isDryRun = false;
let useWorktree = false;
let showStatus = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--ref') {
    const val = args[++i];
    if (!val || val.startsWith('-')) {
      console.error('❌ Error: --ref requires a revision or branch name.');
      printUsageAndExit(1);
    }
    targetRef = val;
  } else if (arg.startsWith('--ref=')) {
    targetRef = arg.slice(6);
    if (!targetRef) {
      console.error('❌ Error: --ref requires a revision or branch name.');
      printUsageAndExit(1);
    }
  } else if (arg === '--dest') {
    const val = args[++i];
    if (!val || val.startsWith('-')) {
      console.error('❌ Error: --dest requires a directory path.');
      printUsageAndExit(1);
    }
    customDest = val;
  } else if (arg.startsWith('--dest=')) {
    customDest = arg.slice(7);
    if (!customDest) {
      console.error('❌ Error: --dest requires a directory path.');
      printUsageAndExit(1);
    }
  } else if (arg === '--worktree' || arg === '--wip') {
    useWorktree = true;
  } else if (arg === '--dry-run') {
    isDryRun = true;
  } else if (arg === '--status' || arg === '-s') {
    showStatus = true;
  } else if (arg === '--help' || arg === '-h') {
    printUsageAndExit(0);
  } else {
    console.error(`❌ Error: Unrecognized option "${arg}".`);
    printUsageAndExit(1);
  }
}

// Git runner helper (avoids shell interpolation)
/**
 * Executes a Git command synchronously in the repository root without invoking a shell.
 *
 * @param {string[]} gitArgs - Arguments to pass to the git command.
 * @param {import('node:child_process').ExecFileSyncOptions} [options={}] - Additional execution options.
 * @returns {string} Trimmed standard output from the git command.
 */
function runGit(gitArgs, options = {}) {
  return execFileSync('git', gitArgs, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim();
}

// Destination path validation
/**
 * Validates the deployment destination directory against unsafe paths and accidental overwrites.
 *
 * @param {string} targetPath - The path to validate as deployment destination.
 * @returns {string} The resolved absolute destination path.
 */
function validateDestDir(targetPath) {
  const resolved = path.resolve(targetPath);
  const root = path.parse(resolved).root;
  const home = path.resolve(os.homedir());
  const repo = path.resolve(REPO_ROOT);

  if (resolved === root) {
    console.error(`❌ Error: Destination path cannot be the filesystem root: ${resolved}`);
    process.exit(1);
  }
  if (resolved === home) {
    console.error(`❌ Error: Destination path cannot be the user home directory: ${resolved}`);
    process.exit(1);
  }
  if (resolved === repo) {
    console.error(`❌ Error: Destination path cannot be the repository root: ${resolved}`);
    process.exit(1);
  }

  if (fs.existsSync(resolved)) {
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      console.error(`❌ Error: Destination exists but is not a directory: ${resolved}`);
      process.exit(1);
    }

    const entries = fs.readdirSync(resolved);
    if (entries.length > 0) {
      const hasDeployInfo = fs.existsSync(path.join(resolved, '.deploy-info.json'));
      const hasSkill = fs.existsSync(path.join(resolved, 'SKILL.md'));
      if (!hasDeployInfo && !hasSkill) {
        console.error(`❌ Error: Refusing to overwrite non-empty destination that lacks both .deploy-info.json and SKILL.md: ${resolved}`);
        console.error(`   To prevent accidental data loss, verify the path or clean the directory manually.`);
        process.exit(1);
      }
    }
  }

  return resolved;
}

const destDir = validateDestDir(customDest || path.join(os.homedir(), '.gemini', 'config', 'skills', 'vajra'));
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

// --- Deploy Execution Helpers ---

/**
 * Recursively collects all file paths within a directory.
 *
 * @param {string} dir - Directory path to scan.
 * @param {string[]} [files=[]] - Accumulator array for collected paths.
 * @returns {string[]} Array of file paths found.
 */
function getFiles(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (fs.statSync(p).isDirectory()) getFiles(p, files);
    else files.push(p);
  }
  return files;
}

/**
 * Atomically deploys files from a source directory to the destination directory with rollback on failure.
 *
 * @param {string} sourceDir - The source directory containing the skill files.
 * @param {string} destination - The target deployment directory.
 * @param {Record<string, unknown>} deployMetadata - Deployment metadata to store in .deploy-info.json.
 * @returns {void}
 */
function deployFromDirectory(sourceDir, destination, deployMetadata) {
  const files = getFiles(sourceDir);
  console.log(`   Files found:  ${files.length} files`);

  if (isDryRun) {
    console.log(`ℹ️ [Dry-run] Would copy ${files.length} files to ${destination}`);
    return;
  }

  const parentDir = path.dirname(destination);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  // Stage in a temporary sibling directory to ensure atomic replacement
  const stagingDir = fs.mkdtempSync(path.join(parentDir, '.vajra-staging-'));
  let backupDir = null;

  try {
    fs.cpSync(sourceDir, stagingDir, { recursive: true });
    fs.writeFileSync(path.join(stagingDir, '.deploy-info.json'), JSON.stringify(deployMetadata, null, 2), 'utf8');

    if (fs.existsSync(destination)) {
      backupDir = fs.mkdtempSync(path.join(parentDir, '.vajra-backup-'));
      // Remove empty directory so renameSync can take over the backup name
      fs.rmdirSync(backupDir);
      fs.renameSync(destination, backupDir);
    }

    try {
      fs.renameSync(stagingDir, destination);
    } catch (renameErr) {
      if (backupDir && fs.existsSync(backupDir) && !fs.existsSync(destination)) {
        try {
          fs.renameSync(backupDir, destination);
        } catch {}
      }
      throw renameErr;
    }

    if (backupDir && fs.existsSync(backupDir)) {
      fs.rmSync(backupDir, { recursive: true, force: true });
    }

    console.log(`✅ Successfully deployed to Antigravity global skills directory!`);
    console.log(`   ${destination}`);
  } catch (err) {
    if (fs.existsSync(stagingDir)) {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    }
    throw err;
  }
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
    currentBranch = runGit(['rev-parse', '--abbrev-ref', 'HEAD']);
    headCommit = runGit(['rev-parse', '--short', 'HEAD']);
  } catch {}

  deployInfo.ref = currentBranch;
  deployInfo.commit = headCommit;
  deployInfo.commitMessage = `Worktree sync based on ${currentBranch} (${headCommit})`;

  console.log(`   Source:       Working tree (${sourceDir})`);
  deployFromDirectory(sourceDir, destDir, deployInfo);
} else {
  // Mode 2: Clean snapshot from Git commit/branch
  let branchName = 'HEAD';
  try {
    branchName = runGit(['rev-parse', '--abbrev-ref', 'HEAD']);
  } catch {}

  const refToUse = targetRef || (branchName !== 'HEAD' ? branchName : 'HEAD');
  let commitHash = '';
  let commitMsg = '';
  try {
    commitHash = runGit(['rev-parse', '--short', '--end-of-options', `${refToUse}^{commit}`]);
    commitMsg = runGit(['log', '-1', '--format=%s', '--end-of-options', refToUse]);
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
    const uncommitted = runGit(['status', '--porcelain', '--', 'skills/vajra']);
    if (uncommitted && !targetRef) {
      console.log(`   ⚠️ Notice:     Uncommitted changes exist in skills/vajra.`);
      console.log(`                 Deploying last committed state (${commitHash}).`);
      console.log(`                 To include uncommitted WIP changes, use: --worktree (or --wip)`);
    }
  } catch {}

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vajra-deploy-'));
  try {
    const archivePath = path.join(tmpDir, 'archive.tar');
    execFileSync('git', [
      'archive',
      '--format=tar',
      '-o', archivePath,
      '--end-of-options',
      refToUse,
      'skills/vajra',
    ], { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });

    execFileSync('tar', ['-x', '-f', archivePath, '-C', tmpDir], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const extractedDir = path.join(tmpDir, 'skills', 'vajra');
    if (!fs.existsSync(extractedDir)) {
      throw new Error(`Extracted archive did not contain skills/vajra/`);
    }

    deployFromDirectory(extractedDir, destDir, deployInfo);
  } catch (e) {
    console.error(`❌ Deployment failed: ${e.message}`);
    process.exit(1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
