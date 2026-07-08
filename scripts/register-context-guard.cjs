#!/usr/bin/env node
// One-time, human-run registration for the fork's context guard.
//
//   node scripts/register-context-guard.cjs             # monitor -> guard
//   node scripts/register-context-guard.cjs --restore-monitor   # guard -> monitor
//
// Copies hooks/gsd-context-guard.js into ~/.claude/hooks/ and swaps the
// PostToolUse registration in ~/.claude/settings.json (backing it up first).
// Claude Code was deliberately not allowed to do this autonomously — hook
// registration changes every session, so a human runs this script.
//
// After running: restart Claude Code sessions (or open /hooks once) so the
// settings reload.

const fs = require('fs');
const os = require('os');
const path = require('path');

const restore = process.argv.includes('--restore-monitor');

const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const settingsPath = path.join(claudeDir, 'settings.json');
const hooksDir = path.join(claudeDir, 'hooks');
const guardSrc = path.join(__dirname, '..', 'hooks', 'gsd-context-guard.js');
const guardDest = path.join(hooksDir, 'gsd-context-guard.js');

const GUARD_CMD = `node "${guardDest.replace(/\\/g, '/')}"`;
const MONITOR_CMD = `node "${path.join(hooksDir, 'gsd-context-monitor.js').replace(/\\/g, '/')}"`;

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(settingsPath)) fail(`settings.json not found at ${settingsPath}`);

// 1. Copy the hook file (skip on restore)
if (!restore) {
  if (!fs.existsSync(guardSrc)) fail(`guard source missing: ${guardSrc}`);
  fs.mkdirSync(hooksDir, { recursive: true });
  fs.copyFileSync(guardSrc, guardDest);
  console.log(`✓ Copied gsd-context-guard.js -> ${guardDest}`);
}

// 2. Back up settings.json
const backup = `${settingsPath}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
fs.copyFileSync(settingsPath, backup);
console.log(`✓ Backed up settings.json -> ${backup}`);

// 3. Swap the PostToolUse command
const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
const fromName = restore ? 'gsd-context-guard' : 'gsd-context-monitor';
const toCmd = restore ? MONITOR_CMD : GUARD_CMD;
const toName = restore ? 'gsd-context-monitor.js' : 'gsd-context-guard.js';

settings.hooks = settings.hooks || {};
settings.hooks.PostToolUse = settings.hooks.PostToolUse || [];

let swapped = false;
for (const entry of settings.hooks.PostToolUse) {
  for (const h of entry.hooks || []) {
    if (h.type === 'command' && typeof h.command === 'string' && h.command.includes(fromName)) {
      h.command = toCmd;
      swapped = true;
    }
  }
}

if (!swapped) {
  // Nothing to swap: check it isn't already registered, then append.
  const already = settings.hooks.PostToolUse.some((e) =>
    (e.hooks || []).some((h) => h.command && h.command.includes(toName))
  );
  if (already) {
    console.log(`✓ ${toName} already registered — nothing to do`);
    process.exit(0);
  }
  settings.hooks.PostToolUse.push({ hooks: [{ type: 'command', command: toCmd }] });
  console.log(`✓ No ${fromName} entry found — appended a new PostToolUse entry`);
} else {
  console.log(`✓ Swapped PostToolUse: ${fromName}* -> ${toName}`);
}

fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
console.log(`✓ Wrote ${settingsPath}`);
console.log('\nDone. Restart Claude Code sessions (or open /hooks once) to load the change.');
console.log(restore ? 'Restored the upstream context monitor.' : 'The context guard is now registered (150k soft / 250k hard; override via GSD_CTX_SOFT_TOKENS / GSD_CTX_HARD_TOKENS).');
