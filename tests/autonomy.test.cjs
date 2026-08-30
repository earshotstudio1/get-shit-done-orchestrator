/**
 * GSD Tools Tests - autonomy.cjs (orchestrator fork addition)
 *
 * Covers mode resolution precedence, gate policy, the controller status
 * sentinel, and the deferred-decision log, exercised through gsd-tools.cjs.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { runGsdTools, createTempProject, cleanup } = require('./helpers.cjs');

function writeConfig(tmpDir, obj) {
  fs.writeFileSync(
    path.join(tmpDir, '.planning', 'config.json'),
    JSON.stringify(obj, null, 2),
    'utf-8'
  );
}

function json(result) {
  assert.ok(result.success, `Command failed: ${result.error}`);
  return JSON.parse(result.output);
}

// ─── mode resolution ─────────────────────────────────────────────────────────

describe('autonomy mode', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('defaults to supervised with no config — upstream behaviour is preserved', () => {
    const out = json(runGsdTools(['autonomy', 'mode'], tmpDir));
    assert.strictEqual(out.mode, 'supervised');
    assert.strictEqual(out.unattended, false);
  });

  test('reads autonomy.mode from config.json', () => {
    writeConfig(tmpDir, { autonomy: { mode: 'batched' } });
    assert.strictEqual(json(runGsdTools(['autonomy', 'mode'], tmpDir)).mode, 'batched');
  });

  test('--mode flag overrides config', () => {
    writeConfig(tmpDir, { autonomy: { mode: 'batched' } });
    const out = json(runGsdTools(['autonomy', 'mode', '--mode', 'unattended'], tmpDir));
    assert.strictEqual(out.mode, 'unattended');
  });

  test('falls back to supervised when config is malformed', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'config.json'), '{ not json', 'utf-8');
    assert.strictEqual(json(runGsdTools(['autonomy', 'mode'], tmpDir)).mode, 'supervised');
  });

  test('falls back to supervised on an unrecognised mode value', () => {
    writeConfig(tmpDir, { autonomy: { mode: 'yolo' } });
    assert.strictEqual(json(runGsdTools(['autonomy', 'mode'], tmpDir)).mode, 'supervised');
  });

  test('surfaces run limits used by the controller', () => {
    writeConfig(tmpDir, { autonomy: { mode: 'batched', max_cycles: 25, gap_retries: 2 } });
    const out = json(runGsdTools(['autonomy', 'mode'], tmpDir));
    assert.strictEqual(out.max_cycles, 25);
    assert.strictEqual(out.gap_retries, 2);
  });
});

// ─── gate policy ─────────────────────────────────────────────────────────────

describe('autonomy resolve', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('every gate asks in supervised mode', () => {
    const out = json(runGsdTools(['autonomy', 'gates'], tmpDir));
    assert.strictEqual(out.mode, 'supervised');
    for (const gate of out.gates) {
      assert.strictEqual(gate.action, 'ask', `${gate.gate} should ask when supervised`);
      assert.strictEqual(gate.asks_user, true);
    }
  });

  test('no gate asks in unattended mode — nothing can stall a headless run', () => {
    writeConfig(tmpDir, { autonomy: { mode: 'unattended' } });
    const out = json(runGsdTools(['autonomy', 'gates'], tmpDir));
    for (const gate of out.gates) {
      assert.strictEqual(gate.asks_user, false, `${gate.gate} must not ask when unattended`);
    }
  });

  test('no gate asks in batched mode either — the review happens up front', () => {
    writeConfig(tmpDir, { autonomy: { mode: 'batched' } });
    const out = json(runGsdTools(['autonomy', 'gates'], tmpDir));
    for (const gate of out.gates) {
      assert.strictEqual(gate.asks_user, false, `${gate.gate} must not ask when batched`);
    }
  });

  test('grey areas accept the recommendation when not supervised', () => {
    const out = json(runGsdTools(['autonomy', 'resolve', 'discuss.grey_area', '--mode', 'batched'], tmpDir));
    assert.strictEqual(out.action, 'accept');
    assert.strictEqual(out.prefront, true);
    assert.strictEqual(out.should_log, true);
  });

  test('gaps get exactly one retry, then defer', () => {
    const out = json(runGsdTools(['autonomy', 'resolve', 'verify.gaps_found', '--mode', 'unattended'], tmpDir));
    assert.strictEqual(out.action, 'retry_once');
    assert.strictEqual(out.then, 'defer');
  });

  test('audit findings stop rather than complete a milestone unattended', () => {
    for (const gate of ['audit.gaps_found', 'audit.tech_debt']) {
      const out = json(runGsdTools(['autonomy', 'resolve', gate, '--mode', 'unattended'], tmpDir));
      assert.strictEqual(out.action, 'stop', `${gate} must stop`);
      assert.strictEqual(out.stops_cycle, true);
    }
  });

  test('planning without context stops rather than guessing', () => {
    const out = json(runGsdTools(['autonomy', 'resolve', 'plan.missing_context', '--mode', 'batched'], tmpDir));
    assert.strictEqual(out.action, 'stop');
  });

  test('cleanup never deletes unattended', () => {
    const out = json(runGsdTools(['autonomy', 'resolve', 'milestone.cleanup', '--mode', 'unattended'], tmpDir));
    assert.strictEqual(out.action, 'dry_run');
  });

  test('blockers stop the cycle instead of looping', () => {
    const out = json(runGsdTools(['autonomy', 'resolve', 'blocker', '--mode', 'unattended'], tmpDir));
    assert.strictEqual(out.action, 'stop');
  });

  test('unknown gate is an error, not a silent default', () => {
    const result = runGsdTools(['autonomy', 'resolve', 'not.a.gate'], tmpDir);
    assert.strictEqual(result.success, false);
    assert.match(result.error, /Unknown gate/);
  });

  test('missing gate argument errors with usage', () => {
    const result = runGsdTools(['autonomy', 'resolve'], tmpDir);
    assert.strictEqual(result.success, false);
    assert.match(result.error, /Usage/);
  });
});

// ─── status sentinel ─────────────────────────────────────────────────────────

describe('autonomy status sentinel', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('reports unknown before any cycle has run', () => {
    const out = json(runGsdTools(['autonomy', 'status'], tmpDir));
    assert.strictEqual(out.status, 'unknown');
    assert.strictEqual(out.exists, false);
  });

  test('round-trips status with reason and phase', () => {
    runGsdTools(['autonomy', 'set-status', 'blocked', '--reason', 'audit gaps', '--phase', '7'], tmpDir);
    const out = json(runGsdTools(['autonomy', 'status'], tmpDir));
    assert.strictEqual(out.status, 'blocked');
    assert.strictEqual(out.reason, 'audit gaps');
    assert.strictEqual(out.phase, '7');
    assert.ok(out.updated_at, 'should stamp updated_at for stall detection');
  });

  test('rejects an invalid status rather than writing garbage', () => {
    const result = runGsdTools(['autonomy', 'set-status', 'finished'], tmpDir);
    assert.strictEqual(result.success, false);
    assert.match(result.error, /Invalid status/);
  });

  test('reports unknown when the sentinel is malformed', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', '.autonomous-status.json'), 'nope', 'utf-8');
    const out = json(runGsdTools(['autonomy', 'status'], tmpDir));
    assert.strictEqual(out.status, 'unknown');
  });

  test('later writes overwrite earlier ones', () => {
    runGsdTools(['autonomy', 'set-status', 'continue'], tmpDir);
    runGsdTools(['autonomy', 'set-status', 'complete', '--milestone', 'v1.2'], tmpDir);
    const out = json(runGsdTools(['autonomy', 'status'], tmpDir));
    assert.strictEqual(out.status, 'complete');
    assert.strictEqual(out.milestone, 'v1.2');
  });
});

// ─── decision log ────────────────────────────────────────────────────────────

describe('autonomy log-decision', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  const logPath = dir => path.join(dir, '.planning', 'DECISIONS-DEFERRED.md');

  test('creates the log with a header on first write', () => {
    runGsdTools(['autonomy', 'log-decision', '--gate', 'verify.human_needed', '--action', 'defer'], tmpDir);
    const content = fs.readFileSync(logPath(tmpDir), 'utf-8');
    assert.match(content, /# Decisions Deferred/);
    assert.match(content, /verify\.human_needed/);
  });

  test('appends rather than overwriting', () => {
    runGsdTools(['autonomy', 'log-decision', '--gate', 'verify.human_needed', '--action', 'defer'], tmpDir);
    runGsdTools(['autonomy', 'log-decision', '--gate', 'discuss.grey_area', '--action', 'accept', '--phase', '4'], tmpDir);
    const rows = fs.readFileSync(logPath(tmpDir), 'utf-8').split('\n').filter(l => /^\| \d{4}-/.test(l));
    assert.strictEqual(rows.length, 2);
  });

  test('escapes pipes and newlines so the table stays parseable', () => {
    runGsdTools(
      ['autonomy', 'log-decision', '--gate', 'blocker', '--action', 'stop', '--note', 'a | b\nc'],
      tmpDir
    );
    const rows = fs.readFileSync(logPath(tmpDir), 'utf-8').split('\n').filter(l => /^\| \d{4}-/.test(l));
    assert.strictEqual(rows.length, 1);
    assert.match(rows[0], /a \\\| b c/);
  });

  test('requires a gate', () => {
    const result = runGsdTools(['autonomy', 'log-decision', '--action', 'defer'], tmpDir);
    assert.strictEqual(result.success, false);
    assert.match(result.error, /Usage/);
  });
});
