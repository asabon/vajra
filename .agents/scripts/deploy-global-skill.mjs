#!/usr/bin/env node

/**
 * Deploys the vajra skill from a clean git ref to the Antigravity global skills directory.
 * Target: ~/.gemini/config/skills/vajra
 *
 * Usage:
 *   node .agents/scripts/deploy-global-skill.mjs [--ref <ref>] [--dest <path>] [--dry-run]
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

const args = process.argv.slice(2);
let targetRef = null;
let customDest = null;
let isDryRun = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--ref' && args[i + 1]) {
    targetRef = args[++i];
  } else if (args[i] === '--dest' && args[i + 1]) {
    customDest = args[++i];
  } else if (args[i] === '--dry-run') {
    isDryRun = true;
  }
}

// 1. Determine target git ref
if (!targetRef) {
  try {
    execSync('git rev-parse --verify develop', { stdio: 'ignore' });
    targetRef = 'develop';
  } catch {
    targetRef = 'HEAD';
  }
}

// Resolve commit hash
let commitHash = '';
try {
  commitHash = execSync(`git rev-parse --short ${targetRef}`, { encoding: 'utf8' }).trim();
} catch (e) {
  console.error(`❌ Failed to resolve git ref "${targetRef}": ${e.message}`);
  process.exit(1);
}

// 2. Determine target destination directory
const destDir = customDest || path.join(os.homedir(), '.gemini', 'config', 'skills', 'vajra');

console.log(`📦 Deploying vajra skill to Antigravity global directory...`);
console.log(`   Source Ref:   ${targetRef} (${commitHash})`);
console.log(`   Destination:  ${destDir}`);
if (isDryRun) {
  console.log(`   Mode:         Dry-run (no files will be modified)`);
}

// 3. Extract skills/vajra from git archive to temporary directory
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vajra-deploy-'));
try {
  execSync(`git archive ${targetRef} skills/vajra | tar -x -C "${tmpDir}"`, { stdio: 'pipe' });
  const extractedDir = path.join(tmpDir, 'skills', 'vajra');
  if (!fs.existsSync(extractedDir)) {
    throw new Error(`Extracted archive did not contain skills/vajra/`);
  }

  // Count files to deploy
  function getFiles(dir, files = []) {
    for (const entry of fs.readdirSync(dir)) {
      const p = path.join(dir, entry);
      if (fs.statSync(p).isDirectory()) getFiles(p, files);
      else files.push(p);
    }
    return files;
  }
  const files = getFiles(extractedDir);
  console.log(`   Files found:  ${files.length} files`);

  if (!isDryRun) {
    // 4. Overwrite destination
    fs.rmSync(destDir, { recursive: true, force: true });
    fs.mkdirSync(destDir, { recursive: true });
    fs.cpSync(extractedDir, destDir, { recursive: true });
    console.log(`✅ Successfully deployed vajra skill (${commitHash}) to:`);
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
