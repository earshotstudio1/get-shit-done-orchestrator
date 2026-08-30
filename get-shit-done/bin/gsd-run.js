#!/usr/bin/env node

/**
 * GSD Run — autonomous controller loop (orchestrator fork addition).
 *
 * Runs GSD to completion across multiple headless Claude Code sessions. Each
 * cycle is a fresh `claude -p` invocation with a clean context window; continuity
 * comes from .planning/ on disk, which is where GSD keeps it anyway. That is
 * strictly better than trying to keep one conversation alive: a fresh window
 * every cycle removes the failure mode where quality degrades as the window
 * fills, and the context guard's handover file makes the seam explicit.
 *
 * Usage:
 *   node gsd-run.js [--max-cycles N] [--mode batched|unattended|supervised]
 *                   [--dir PATH] [--model NAME] [--permission-mode MODE]
 *                   [--dry-run] [--claude-bin PATH]
 *
 * Exit codes: 0 complete, 1 usage/precondition error, 2 blocked, 3 cycle cap reached.
 *
 * Safety: this never pushes, never opens PRs, never deletes. Cleanup runs
 * dry-run only in unattended modes (see lib/autonomy.cjs).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const autonomy = require('./lib/autonomy.cjs');

const EXIT_COMPLETE = 0;
const EXIT_ERROR = 1;
const EXIT_BLOCKED = 2;
const EXIT_CAP = 3;

const RUN_LOG = path.join('.planning', 'AUTONOMOUS-LOG.md');

// ─── Arguments ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = {
    maxCycles: null,
    mode: 'batched',
    dir: process.cwd(),
    model: null,
    permissionMode: 'acceptEdits',
    dryRun: false,
    claudeBin: 'claude',
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined || value.startsWith('--')) {
        fail(`Missing value for ${arg}`);
      }
      return value;
    };

    switch (arg) {
      case '--max-cycles': opts.maxCycles = parseInt(next(), 10); break;
      case '--mode': opts.mode = next(); break;
      case '--dir': opts.dir = path.resolve(next()); break;
      case '--model': opts.model = next(); break;
      case '--permission-mode': opts.permissionMode = next(); break;
      case '--claude-bin': opts.claudeBin = next(); break;
      case '--dry-run': opts.dryRun = true; break;
      case '--help': case '-h': opts.help = true; break;
      default: fail(`Unknown argument: ${arg}`);
    }
  }

  if (opts.maxCycles !== null && (!Number.isFinite(opts.maxCycles) || opts.maxCycles < 1)) {
    fail('--max-cycles must be a positive integer');
  }
  if (!autonomy.VALID_MODES.includes(opts.mode)) {
    fail(`--mode must be one of: ${autonomy.VALID_MODES.join(', ')}`);
  }

  return opts;
}

function fail(message) {
  process.stderr.write(`Error: ${message}\n`);
  process.exit(EXIT_ERROR);
}

const USAGE = `
GSD Run — autonomous controller loop

  node gsd-run.js [options]

Options:
  --max-cycles N        Max headless sessions to spawn (default: autonomy.max_cycles, or 10)
  --mode MODE           supervised | batched | unattended (default: batched)
  --dir PATH            Project directory (default: cwd)
  --model NAME          Model passed through to claude
  --permission-mode M   Passed to claude (default: acceptEdits)
  --dry-run             Print what each cycle would invoke, run nothing
  --claude-bin PATH     Claude executable (default: claude)
  -h, --help            This message

Stops when the milestone completes, a blocker needs you, progress stalls, or
the cycle cap is reached. Read .planning/DECISIONS-DEFERRED.md afterwards.
`;

// ─── Preconditions ────────────────────────────────────────────────────────────

function checkPreconditions(dir) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    fail(`Not a directory: ${dir}`);
  }
  const planning = path.join(dir, '.planning');
  if (!fs.existsSync(planning)) {
    fail(`No .planning/ in ${dir}. Run /gsd:new-project and /gsd:new-milestone first.`);
  }
  for (const file of ['ROADMAP.md', 'STATE.md']) {
    if (!fs.existsSync(path.join(planning, file))) {
      fail(`No .planning/${file}. Run /gsd:new-milestone first.`);
    }
  }
}

// ─── Handover detection ───────────────────────────────────────────────────────

/**
 * The context guard writes .continue-here.md when it hands over mid-step. A
 * fresh cycle must consume that rather than starting the phase again, or the
 * handover was pointless.
 */
function findHandover(dir) {
  const phasesDir = path.join(dir, '.planning', 'phases');
  if (!fs.existsSync(phasesDir)) return null;

  try {
    for (const entry of fs.readdirSync(phasesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(phasesDir, entry.name, '.continue-here.md');
      if (fs.existsSync(candidate)) {
        return path.join('.planning', 'phases', entry.name, '.continue-here.md');
      }
    }
  } catch {
    // Unreadable phases dir is not fatal — fall through to a normal cycle.
  }
  return null;
}

function buildPrompt(handoverPath) {
  if (handoverPath) {
    return `/gsd:resume-work\n\nA context handover is pending at ${handoverPath}. Read it, continue from its "Exact next action", resolve it when the step truly completes, then continue the milestone autonomously.`;
  }
  return '/gsd:autonomous';
}

// ─── Run log ──────────────────────────────────────────────────────────────────

function appendRunLog(dir, line) {
  const logPath = path.join(dir, RUN_LOG);
  if (!fs.existsSync(logPath)) {
    fs.writeFileSync(
      logPath,
      '# Autonomous Run Log\n\nOne row per controller cycle.\n\n' +
        '| When | Cycle | Prompt | Exit | Status | Reason |\n' +
        '|------|-------|--------|------|--------|--------|\n',
      'utf-8'
    );
  }
  fs.appendFileSync(logPath, line, 'utf-8');
}

function logCycle(dir, cycle, prompt, exitCode, status) {
  const cell = v => String(v ?? '—').replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim();
  appendRunLog(
    dir,
    `| ${new Date().toISOString()} | ${cycle} | ${cell(prompt.split('\n')[0])} ` +
      `| ${exitCode} | ${cell(status.status)} | ${cell(status.reason)} |\n`
  );
}

// ─── Cycle execution ──────────────────────────────────────────────────────────

function runCycle(opts, prompt) {
  const args = ['-p', prompt, '--permission-mode', opts.permissionMode];
  if (opts.model) args.push('--model', opts.model);

  const result = spawnSync(opts.claudeBin, args, {
    cwd: opts.dir,
    stdio: 'inherit',
    env: { ...process.env, GSD_AUTONOMY_MODE: opts.mode },
  });

  if (result.error) {
    if (result.error.code === 'ENOENT') {
      fail(`Could not run "${opts.claudeBin}". Is Claude Code installed and on PATH?`);
    }
    fail(`Failed to spawn ${opts.claudeBin}: ${result.error.message}`);
  }

  return result.status ?? EXIT_ERROR;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    process.stdout.write(USAGE);
    process.exit(EXIT_COMPLETE);
  }

  checkPreconditions(opts.dir);

  const maxCycles = opts.maxCycles ?? readConfiguredCap(opts.dir);

  process.stdout.write(
    `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      ` GSD ► RUN\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      ` Project: ${opts.dir}\n` +
      ` Mode:    ${opts.mode}\n` +
      ` Cycles:  up to ${maxCycles}\n\n`
  );

  // A cycle that leaves the sentinel untouched has made no decision the
  // controller can act on. One such cycle is tolerable (a crash mid-phase);
  // two in a row means we are looping without progress, so stop.
  let lastStamp = autonomy.readStatus(opts.dir).updated_at ?? null;
  let staleCycles = 0;

  for (let cycle = 1; cycle <= maxCycles; cycle++) {
    const handover = findHandover(opts.dir);
    const prompt = buildPrompt(handover);

    process.stdout.write(
      `\n─── Cycle ${cycle}/${maxCycles} ${handover ? '(resuming handover)' : ''}\n`
    );

    if (opts.dryRun) {
      process.stdout.write(
        `  would run: ${opts.claudeBin} -p "${prompt.split('\n')[0]}" ` +
          `--permission-mode ${opts.permissionMode}${opts.model ? ` --model ${opts.model}` : ''}\n` +
          `  with GSD_AUTONOMY_MODE=${opts.mode}\n`
      );
      continue;
    }

    const exitCode = runCycle(opts, prompt);
    const status = autonomy.readStatus(opts.dir);
    logCycle(opts.dir, cycle, prompt, exitCode, status);

    if (status.status === 'complete') {
      process.stdout.write(`\n✅ Milestone complete after ${cycle} cycle(s).\n`);
      reportDeferred(opts.dir);
      process.exit(EXIT_COMPLETE);
    }

    if (status.status === 'blocked') {
      process.stdout.write(`\n⛔ Blocked: ${status.reason ?? 'no reason recorded'}\n`);
      if (status.phase) process.stdout.write(`   Phase: ${status.phase}\n`);
      reportDeferred(opts.dir);
      process.exit(EXIT_BLOCKED);
    }

    const stamp = status.updated_at ?? null;
    staleCycles = stamp && stamp !== lastStamp ? 0 : staleCycles + 1;
    lastStamp = stamp;

    if (staleCycles >= 2) {
      process.stdout.write(
        `\n⛔ Stopping: two cycles produced no status update (last claude exit: ${exitCode}).\n` +
          `   Check .planning/STATE.md and ${RUN_LOG}.\n`
      );
      reportDeferred(opts.dir);
      process.exit(EXIT_BLOCKED);
    }
  }

  if (opts.dryRun) {
    process.stdout.write(`\nDry run — nothing executed.\n`);
    process.exit(EXIT_COMPLETE);
  }

  process.stdout.write(
    `\n⏸ Cycle cap (${maxCycles}) reached without completing.\n` +
      `   Re-run to continue, or raise --max-cycles.\n`
  );
  reportDeferred(opts.dir);
  process.exit(EXIT_CAP);
}

/** Cycle cap from .planning/config.json, defaulting to 10 — config may be absent. */
function readConfiguredCap(dir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, '.planning', 'config.json'), 'utf-8'));
    const cap = Number(parsed.autonomy?.max_cycles);
    return Number.isFinite(cap) && cap >= 1 ? cap : 10;
  } catch {
    return 10;
  }
}

function reportDeferred(dir) {
  const logPath = path.join(dir, autonomy.DECISION_LOG);
  if (!fs.existsSync(logPath)) return;
  const rows = fs
    .readFileSync(logPath, 'utf-8')
    .split('\n')
    .filter(line => /^\| \d{4}-/.test(line));
  if (rows.length > 0) {
    process.stdout.write(`\n📋 ${rows.length} decision(s) made without you — see ${autonomy.DECISION_LOG}\n`);
  }
}

if (require.main === module) {
  main();
}

module.exports = { parseArgs, findHandover, buildPrompt, checkPreconditions, readConfiguredCap };
