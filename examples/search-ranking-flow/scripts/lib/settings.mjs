// The agents' hook settings and where the rails live: which files run or switch off the hooks,
// and whether an edit of one drops this skill's hooks. Shared by the hook checks.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const norm = (t) => t.replace(/\\/g, "/").toLowerCase();

// The rails' own definition: the skill (playbooks, profile, these scripts) and the agents' hook
// settings. They change only while the human has suspended the rails, so the agent cannot switch
// its own rails off (rails: advisory, a deleted guard, a removed hook, disableAllHooks).
// Files whose settings run or switch off the hooks: Claude Code's (which Copilot reads too), Codex's
// and Copilot's own settings (they can hold hooks and disableAllHooks). VS Code's settings can turn
// hooks off too (chat.useHooks) but are read often, so code that merely names them is not refused.
export const HOOK_CONFIGS = [".claude/settings.json", ".claude/settings.local.json", ".codex/hooks.json", ".codex/config.toml", ".github/copilot/settings.json", ".github/copilot/settings.local.json", ".agents/hooks.json"];
export function railsPaths(root, skillDir) {
  const configs = [...HOOK_CONFIGS, ".vscode/settings.json", `.github/hooks/${path.basename(skillDir)}.json`].map((f) => path.join(root, f));
  configs.push(...[".claude/settings.json", ".codex/config.toml", ".copilot/settings.json"].map((f) => path.join(os.homedir(), f)));
  // Copilot runs every file in .github/hooks/, so a new one is a new hook.
  return { skill: skillDir, configs, state: path.join(root, ".flow"), hookDir: path.join(root, ".github", "hooks") };
}
// Paths compared as the most permissive file system would: any case, either slash.
export const samePath = (a, b) => norm(a) === norm(b);
export const inside = (p, dir) => samePath(p, dir) || norm(p).startsWith(norm(dir).replace(/\/$/, "") + "/");
// Hook settings may change except where an edit drops a flow.mjs hook or turns hooks off.
export const DISABLES_HOOKS = /disableAllHooks|codex_hooks\s*=\s*false|chat\.useHooks["']?\s*[:=]\s*false/i;
// Codex: hooks = false under [features] (or features.hooks = false).
const TOML_OFF = /\bhooks\s*=\s*false\b/;

const stripJsonComments = (t) => t.replace(/"(?:\\.|[^"\\])*"|\/\*[\s\S]*?\*\/|\/\/.*/g, (m) => (m[0] === '"' ? m : ""));

function disabledKeys(abs, text) {
  const keys = new Set();
  if (!text) return keys;
  if (/\.toml$/i.test(abs)) {
    const clean = text.replace(/#.*$/gm, "");
    let table = "";
    for (const rawLine of clean.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      const hdr = line.match(/^\[([^\]]+)\]$/);
      if (hdr) { table = hdr[1].trim(); continue; }
      if (/^codex_hooks\s*=\s*false\b/i.test(line)) keys.add(`toml:${table}:codex_hooks`);
      if (/^(?:features\.)?hooks\s*=\s*false\b/i.test(line)) keys.add(`toml:${line.startsWith("features.") ? "features" : table}:hooks`);
      const inline = line.match(/^features\s*=\s*\{([^}]*)\}/i);
      if (inline && /\bhooks\s*=\s*false\b/i.test(inline[1])) keys.add("toml:features:hooks");
    }
    return keys;
  }
  try {
    const scan = (obj, kp) => {
      if (!obj || typeof obj !== "object") return;
      if (Array.isArray(obj)) { for (const x of obj) scan(x, kp); return; }
      if (obj.disableAllHooks === true) keys.add(JSON.stringify([...kp, "disableAllHooks"]));
      if (obj.enabled === false) keys.add(JSON.stringify([...kp, "enabled"]));
      if (obj["chat.useHooks"] === false) keys.add(JSON.stringify([...kp, "chat.useHooks"]));
      if (obj.chat?.useHooks === false) keys.add(JSON.stringify([...kp, "chat", "useHooks"]));
      for (const [k, v] of Object.entries(obj)) {
        if (HOOK_FILES_SETTING.test(k) && v && (typeof v !== "object" || Object.keys(v).length > 0)) keys.add(JSON.stringify([...kp, k, v]));
        scan(v, [...kp, k]);
      }
    };
    scan(JSON.parse(stripJsonComments(text)), []);
    return keys;
  } catch {
    if (/"disableAllHooks"\s*:\s*true\b/i.test(text)) keys.add("raw:disableAllHooks");
    if (/"chat\.useHooks"\s*:\s*false\b/i.test(text)) keys.add("raw:chat.useHooks");
    if (/"enabled"\s*:\s*false\b/i.test(text)) keys.add("raw:enabled");
    if (HOOK_FILES_SETTING.test(text)) keys.add("raw:hookFilesLocations");
    return keys;
  }
}

function jsonCommands(text) {
  if (!text || !text.trim()) return [];
  try {
    const out = [];
    const walk = (obj) => {
      if (!obj || typeof obj !== "object") return;
      if (Array.isArray(obj)) { for (const x of obj) walk(x); return; }
      for (const [k, v] of Object.entries(obj)) {
        if (/^(?:command|bash|powershell)$/i.test(k) && typeof v === "string") out.push(v);
        else if (/^args$/i.test(k) && Array.isArray(v)) out.push(JSON.stringify(v));
        else walk(v);
      }
    };
    walk(JSON.parse(stripJsonComments(text)));
    return out;
  } catch {
    return null;
  }
}

function hookEntries(text) {
  if (!text) return [];
  const entries = [];
  const collect = (obj, keyPath, enabled) => {
    if (!obj || typeof obj !== "object") return;
    if (Array.isArray(obj)) { for (const x of obj) collect(x, keyPath, enabled); return; }
    const pathId = JSON.stringify(keyPath);
    const nextEnabled = typeof obj.enabled === "boolean" ? obj.enabled : enabled;
    const matcher = typeof obj.matcher === "string" ? obj.matcher : undefined;
    if (Array.isArray(obj.hooks)) {
      for (const h of obj.hooks) {
        if (typeof h?.command === "string" && /(?<![\w-])flow\.mjs\b/.test(h.command)) {
          entries.push({ keyPath: pathId, command: h.command.trim(), matcher, type: typeof h.type === "string" ? h.type : undefined, enabled: nextEnabled !== false });
        }
      }
    }
    if (typeof obj.command === "string" && /(?<![\w-])flow\.mjs\b/.test(obj.command)) {
      entries.push({ keyPath: pathId, command: obj.command.trim(), matcher, type: typeof obj.type === "string" ? obj.type : undefined, enabled: nextEnabled !== false });
    }
    for (const [k, v] of Object.entries(obj)) {
      if (k === "hooks" && Array.isArray(v)) continue;
      collect(v, [...keyPath, k], nextEnabled);
    }
  };
  try {
    collect(JSON.parse(stripJsonComments(text)), [], true);
  } catch {
    return null;
  }
  return entries;
}

// Whether an edit of a hook settings file changes what the hooks run: removes a flow.mjs hook,
// turns hooks off, points the agent at other hook files, or adds a command. A command the agent
// adds would run at the next lifecycle event, outside the tool hook, where it could write the run
// state or answer a gate. Other settings (permissions, models, editor options) may change.
export function dropsHooks(abs, act) {
  const { removed, added, whole, apply } = act.change;
  const off = (t) => DISABLES_HOOKS.test(t) || HOOK_FILES_SETTING.test(t) || (/\.toml$/i.test(abs) && TOML_OFF.test(t));
  if (whole === undefined && (off(added) || /"enabled"\s*:\s*false/i.test(added))) return true;
  // A hook command taken out must come back in the same edit: re-indenting or editing next to it is fine.
  const hookCommands = (t) => [...t.matchAll(/[^"'\n]*(?<![\w-])flow\.mjs[^"'\n]*/g)].map((m) => m[0].trim());
  if (hookCommands(removed).some((c) => !added.includes(c))) return true;
  if (commands(added).some((c) => !commands(removed).includes(c))) return true;
  let before = "";
  try { before = fs.readFileSync(abs, "utf8"); } catch {}
  const after = typeof apply === "function" ? apply(before, abs) : whole;
  const beforeHooks = hookEntries(before);
  const hadHooks = (beforeHooks && beforeHooks.length > 0) || hookCommands(before).length > 0;
  if (after === undefined) return hadHooks;
  const beforeDisabled = disabledKeys(abs, before);
  const afterDisabled = disabledKeys(abs, after);
  if ([...afterDisabled].some((k) => !beforeDisabled.has(k))) return true;
  if (beforeHooks && beforeHooks.length > 0) {
    const afterHooks = hookEntries(after);
    if (!afterHooks) return true;
    if (beforeHooks.some((b) => !afterHooks.some((a) => a.keyPath === b.keyPath && a.command === b.command && a.matcher === b.matcher && a.type === b.type && (!b.enabled || a.enabled)))) return true;
  }
  const beforeCmds = jsonCommands(before);
  const afterCmds = jsonCommands(after);
  const addedCmd = beforeCmds && afterCmds ? afterCmds.some((c) => !beforeCmds.includes(c)) : commands(after).some((c) => !commands(before).includes(c));
  return hookCommands(before).some((c) => !after.includes(c)) || addedCmd;
}
// The commands a settings file runs: values of `command` keys (JSON and TOML), and argument lists.
const commands = (t) => [...String(t).matchAll(/["']?\b(?:command|bash|powershell|args)["']?\s*[:=]\s*("(?:[^"\\]|\\.)*"|'[^']*'|\[[^\]]*\])/g)].map((m) => m[1]);
// VS Code loads hook files from the folders this setting lists.
const HOOK_FILES_SETTING = /hookFilesLocations/i;
