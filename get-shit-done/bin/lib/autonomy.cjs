/**
 * Autonomy — unattended-run policy, status sentinel, and decision audit trail
 * (orchestrator fork addition).
 *
 * Workflows pause at ~15 decision points. In a headless `claude -p` run there is
 * nobody to answer them, so each pause has to resolve to a documented default
 * instead of blocking forever. This module is the single source of truth for
 * what each gate does in each mode, so both the workflow prose and the
 * controller loop (gsd-run.js) read the same policy.
 *
 * Modes:
 *   supervised — ask the user at every gate (upstream behaviour, the default)
 *   batched    — user-facing grey areas are front-loaded into one review before
 *                the run; everything after that resolves automatically
 *   unattended — nothing asks; every gate takes its default and is logged
 *
 * See get-shit-done/references/autonomy.md for the human-readable policy.
 */

const fs = require('fs');
const path = require('path');
const { output, error } = require('./core.cjs');

const VALID_MODES = ['supervised', 'batched', 'unattended'];
const VALID_STATUSES = ['continue', 'complete', 'blocked'];

const STATUS_FILE = path.join('.planning', '.autonomous-status.json');
const DECISION_LOG = path.join('.planning', 'DECISIONS-DEFERRED.md');
const PREFERENCES_FILE = path.join('.planning', 'AUTONOMY-PREFERENCES.md');

// ─── Gate policy ──────────────────────────────────────────────────────────────

// action:
//   ask        — pause and ask the user (only reachable in supervised/batched)
//   accept     — take the pre-selected/recommended answer, log it
//   defer      — skip the optional step, log it, keep going
//   retry_once — one automatic remediation attempt, then fall through to `then`
//   dry_run    — perform the non-destructive half only
//   stop       — end the cycle cleanly with status `blocked`
//
// `prefront: true` marks a gate the batched mode hoists into the up-front review.
const GATES = {
  'discuss.grey_area': {
    description: 'Smart-discuss grey area proposals for a phase',
    prefront: true,
    supervised: { action: 'ask' },
    batched: { action: 'accept', note: 'answered in the up-front review, or recommendation accepted' },
    unattended: { action: 'accept', note: 'recommendation accepted unreviewed' },
  },
  'plan.missing_context': {
    description: 'plan-phase found no CONTEXT.md for the phase',
    supervised: { action: 'ask' },
    batched: { action: 'stop', note: 'discuss did not produce context — planning blind is not safe' },
    unattended: { action: 'stop', note: 'discuss did not produce context — planning blind is not safe' },
  },
  'plan.ui_spec_missing': {
    description: 'Frontend phase has no UI-SPEC.md and the UI safety gate is on',
    prefront: true,
    supervised: { action: 'ask' },
    batched: { action: 'defer', note: 'proceeding without a UI design contract' },
    unattended: { action: 'defer', note: 'proceeding without a UI design contract' },
  },
  'verify.human_needed': {
    description: 'Verification produced items needing manual testing',
    supervised: { action: 'ask' },
    batched: { action: 'defer', note: 'manual verification deferred to the end of the run' },
    unattended: { action: 'defer', note: 'manual verification deferred to the end of the run' },
  },
  'verify.gaps_found': {
    description: 'Verification found unmet must-haves',
    supervised: { action: 'ask' },
    batched: { action: 'retry_once', then: 'defer', note: 'one gap-closure attempt, then continue and log' },
    unattended: { action: 'retry_once', then: 'defer', note: 'one gap-closure attempt, then continue and log' },
  },
  'audit.gaps_found': {
    description: 'Milestone audit found gaps',
    supervised: { action: 'ask' },
    batched: { action: 'stop', note: 'a milestone is not completed with known gaps unattended' },
    unattended: { action: 'stop', note: 'a milestone is not completed with known gaps unattended' },
  },
  'audit.tech_debt': {
    description: 'Milestone audit identified tech debt',
    supervised: { action: 'ask' },
    batched: { action: 'stop', note: 'a milestone is not completed with known debt unattended' },
    unattended: { action: 'stop', note: 'a milestone is not completed with known debt unattended' },
  },
  'milestone.cleanup': {
    description: 'Cleanup wants to delete planning artifacts',
    supervised: { action: 'ask' },
    batched: { action: 'dry_run', note: 'deletions are never performed unattended — dry-run only' },
    unattended: { action: 'dry_run', note: 'deletions are never performed unattended — dry-run only' },
  },
  blocker: {
    description: 'A phase operation failed or STATE.md reports a blocker',
    supervised: { action: 'ask' },
    batched: { action: 'stop', note: 'blocker needs a human — stopping cleanly for the controller' },
    unattended: { action: 'stop', note: 'blocker needs a human — stopping cleanly for the controller' },
  },
};

// ─── Mode resolution ──────────────────────────────────────────────────────────

/**
 * Resolve the active autonomy mode.
 * Precedence: explicit override > GSD_AUTONOMY_MODE env > config autonomy.mode > supervised.
 *
 * Defaulting to supervised matters: an interactive session that has never heard
 * of this feature must behave exactly as it does upstream.
 */
function resolveMode(cwd, override) {
  const candidates = [override, process.env.GSD_AUTONOMY_MODE, readConfigMode(cwd)];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const normalized = String(candidate).trim().toLowerCase();
    if (VALID_MODES.includes(normalized)) return normalized;
  }
  return 'supervised';
}

function readConfigMode(cwd) {
  try {
    const raw = fs.readFileSync(path.join(cwd, '.planning', 'config.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed.autonomy?.mode ?? null;
  } catch {
    return null;
  }
}

function readConfigValue(cwd, section, field, fallback) {
  try {
    const raw = fs.readFileSync(path.join(cwd, '.planning', 'config.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    const value = parsed[section]?.[field];
    return value === undefined ? fallback : value;
  } catch {
    return fallback;
  }
}

// ─── Gate resolution ──────────────────────────────────────────────────────────

function resolveGate(cwd, gateId, override) {
  const gate = GATES[gateId];
  if (!gate) {
    error(`Unknown gate: "${gateId}". Valid gates: ${Object.keys(GATES).sort().join(', ')}`);
  }

  const mode = resolveMode(cwd, override);
  const policy = gate[mode];

  return {
    gate: gateId,
    description: gate.description,
    mode,
    action: policy.action,
    then: policy.then ?? null,
    // Only supervised mode is allowed to block on a human; everything else
    // must produce an answer the workflow can act on without a TTY.
    asks_user: policy.action === 'ask',
    stops_cycle: policy.action === 'stop',
    should_log: policy.action !== 'ask',
    prefront: !!gate.prefront && mode === 'batched',
    note: policy.note ?? null,
  };
}

// ─── Status sentinel ──────────────────────────────────────────────────────────

/**
 * The controller loop cannot read terminal banners — it reads this file to
 * decide whether to spawn another cycle. Absent file means "never ran".
 */
function readStatus(cwd) {
  try {
    const raw = fs.readFileSync(path.join(cwd, STATUS_FILE), 'utf-8');
    const parsed = JSON.parse(raw);
    if (!VALID_STATUSES.includes(parsed.status)) {
      return { status: 'unknown', reason: 'status file present but malformed', exists: true };
    }
    return { ...parsed, exists: true };
  } catch {
    return { status: 'unknown', reason: 'no status file written yet', exists: false };
  }
}

function writeStatus(cwd, status, fields = {}) {
  if (!VALID_STATUSES.includes(status)) {
    error(`Invalid status: "${status}". Valid: ${VALID_STATUSES.join(', ')}`);
  }

  const planningDir = path.join(cwd, '.planning');
  if (!fs.existsSync(planningDir)) {
    fs.mkdirSync(planningDir, { recursive: true });
  }

  const payload = {
    status,
    reason: fields.reason ?? null,
    phase: fields.phase ?? null,
    milestone: fields.milestone ?? null,
    updated_at: new Date().toISOString(),
  };

  fs.writeFileSync(path.join(cwd, STATUS_FILE), JSON.stringify(payload, null, 2), 'utf-8');
  return { written: true, path: STATUS_FILE, ...payload };
}

// ─── Decision audit trail ─────────────────────────────────────────────────────

/**
 * Every gate resolved without the user gets a line here. This file is the
 * deliverable of an unattended run just as much as the code is — it is how you
 * find out what was decided on your behalf.
 */
function logDecision(cwd, entry) {
  const planningDir = path.join(cwd, '.planning');
  if (!fs.existsSync(planningDir)) {
    fs.mkdirSync(planningDir, { recursive: true });
  }

  const logPath = path.join(cwd, DECISION_LOG);
  if (!fs.existsSync(logPath)) {
    fs.writeFileSync(
      logPath,
      '# Decisions Deferred\n\n' +
        'Choices made without you during autonomous runs. Each row is something a\n' +
        'supervised run would have asked about. Review before shipping the milestone.\n\n' +
        '| When | Phase | Gate | Action | Note |\n' +
        '|------|-------|------|--------|------|\n',
      'utf-8'
    );
  }

  const cell = value => String(value ?? '—').replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim();
  const row =
    `| ${new Date().toISOString()} ` +
    `| ${cell(entry.phase)} ` +
    `| ${cell(entry.gate)} ` +
    `| ${cell(entry.action)} ` +
    `| ${cell(entry.note)} |\n`;

  fs.appendFileSync(logPath, row, 'utf-8');
  return { logged: true, path: DECISION_LOG };
}

// ─── Commands ─────────────────────────────────────────────────────────────────

function cmdAutonomyMode(cwd, override, raw) {
  const mode = resolveMode(cwd, override);
  const gapRetries = readConfigValue(cwd, 'autonomy', 'gap_retries', 1);
  const stopAtBoundary = readConfigValue(cwd, 'autonomy', 'stop_at_milestone_boundary', true);
  const maxCycles = readConfigValue(cwd, 'autonomy', 'max_cycles', 10);

  output(
    {
      mode,
      unattended: mode !== 'supervised',
      gap_retries: gapRetries,
      stop_at_milestone_boundary: stopAtBoundary,
      max_cycles: maxCycles,
      prefront_gates: Object.keys(GATES).filter(id => GATES[id].prefront),
      preferences_file: PREFERENCES_FILE,
    },
    raw,
    mode
  );
}

function cmdAutonomyResolve(cwd, gateId, override, raw) {
  if (!gateId) {
    error(`Usage: autonomy resolve <gate> [--mode <${VALID_MODES.join('|')}>]`);
  }
  const resolved = resolveGate(cwd, gateId, override);
  output(resolved, raw, resolved.action);
}

function cmdAutonomyStatus(cwd, raw) {
  const status = readStatus(cwd);
  output(status, raw, status.status);
}

function cmdAutonomySetStatus(cwd, status, fields, raw) {
  if (!status) {
    error(`Usage: autonomy set-status <${VALID_STATUSES.join('|')}> [--reason "..."] [--phase N]`);
  }
  const result = writeStatus(cwd, status, fields);
  output(result, raw, result.status);
}

function cmdAutonomyLogDecision(cwd, entry, raw) {
  if (!entry.gate) {
    error('Usage: autonomy log-decision --gate <gate> --action <action> [--phase N] [--note "..."]');
  }
  const result = logDecision(cwd, entry);
  output(result, raw, result.path);
}

function cmdAutonomyGates(cwd, raw) {
  const mode = resolveMode(cwd);
  const gates = Object.keys(GATES)
    .sort()
    .map(id => resolveGate(cwd, id));
  output({ mode, gates }, raw, gates.map(g => `${g.gate}=${g.action}`).join('\n'));
}

module.exports = {
  VALID_MODES,
  VALID_STATUSES,
  GATES,
  STATUS_FILE,
  DECISION_LOG,
  PREFERENCES_FILE,
  resolveMode,
  resolveGate,
  readStatus,
  writeStatus,
  logDecision,
  cmdAutonomyMode,
  cmdAutonomyResolve,
  cmdAutonomyStatus,
  cmdAutonomySetStatus,
  cmdAutonomyLogDecision,
  cmdAutonomyGates,
};
