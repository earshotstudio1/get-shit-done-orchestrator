/**
 * GSD Run Tests — autonomous controller loop (orchestrator fork addition).
 *
 * Pure helpers are tested directly. Loop control is tested against a stub
 * "claude" executable that writes the status sentinel the real workflow would
 * write, so the loop's stop conditions are exercised without spawning a model.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const RUN_PATH = path.join(__dirname, '..', 'get-shit-done', 'bin', 'gsd-run.js');
const gsdRun = require(RUN_PATH);

// Stubbing the executable needs a POSIX shebang; on Windows the loop is
// covered by the pure-helper and --dry-run tests only.
const SKIP_STUB = { skip: process.platform === 'win32' ? 'requires POSIX shebang' : false };

// ─── fixtures ─────────────────────────────────────────────────────────────────

function createRunnableProject() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-run-test-'));
  const planning = path.join(tmpDir, '.planning');
  fs.mkdirSync(path.join(planning, 'phases'), { recursive: true });
  fs.writeFileSync(path.join(planning, 'ROADMAP.md'), '# Roadmap\n', 'utf-8');
  fs.writeFileSync(path.join(planning, 'STATE.md'), '# State\n', 'utf-8');
  fs.writeFileSync(path.join(planning, 'config.json'), JSON.stringify({ autonomy: { mode: 'batched' } }), 'utf-8');
  return tmpDir;
}

/**
 * Build a fake `claude` that writes the sentinel sequence given by `statuses`,
 * one entry per invocation; the last entry repeats. The string 'silent' means
 * "write nothing" — the crashed-cycle case.
 */
function createStubClaude(tmpDir, statuses) {
  const stubPath = path.join(tmpDir, 'stub-claude');
  const counterPath = path.join(tmpDir, 'stub-calls');
  const statusPath = path.join(tmpDir, '.planning', '.autonomous-status.json');

  const script = `#!/usr/bin/env node
const fs = require('fs');
const statuses = ${JSON.stringify(statuses)};
const counterPath = ${JSON.stringify(counterPath)};
let calls = 0;
try { calls = JSON.parse(fs.readFileSync(counterPath, 'utf-8')).calls; } catch {}
const entry = calls < statuses.length ? statuses[calls] : statuses[statuses.length - 1];
calls += 1;
fs.writeFileSync(counterPath, JSON.stringify({ calls, argv: process.argv.slice(2), mode: process.env.GSD_AUTONOMY_MODE }), 'utf-8');
if (entry !== 'silent') {
  fs.writeFileSync(${JSON.stringify(statusPath)}, JSON.stringify({
    status: entry,
    reason: entry + ' from stub',
    updated_at: new Date(Date.now() + calls * 1000).toISOString(),
  }), 'utf-8');
}
process.exit(0);
`;
  fs.writeFileSync(stubPath, script, { mode: 0o755 });
  return { stubPath, counterPath };
}

/** Same stub, but it also writes to stdout — used to prove where cycle output lands. */
function createChattyStub(tmpDir, statuses) {
  const { stubPath, counterPath } = createStubClaude(tmpDir, statuses);
  const script = fs.readFileSync(stubPath, 'utf-8')
    .replace('process.exit(0);', "process.stdout.write('CYCLE CHATTER\\n');\nprocess.exit(0);");
  fs.writeFileSync(stubPath, script, { mode: 0o755 });
  return { stubPath, counterPath };
}

function runController(tmpDir, args) {
  const result = spawnSync(process.execPath, [RUN_PATH, '--dir', tmpDir, ...args], {
    encoding: 'utf-8',
    stdio: 'pipe',
  });
  return { code: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function readCounter(counterPath) {
  try { return JSON.parse(fs.readFileSync(counterPath, 'utf-8')); } catch { return { calls: 0 }; }
}

// ─── argument parsing ─────────────────────────────────────────────────────────

describe('gsd-run parseArgs', () => {
  test('defaults to batched mode', () => {
    assert.strictEqual(gsdRun.parseArgs([]).mode, 'batched');
  });

  test('accepts the three valid modes', () => {
    for (const mode of ['supervised', 'batched', 'unattended']) {
      assert.strictEqual(gsdRun.parseArgs(['--mode', mode]).mode, mode);
    }
  });

  test('parses cycle cap and passthrough options', () => {
    const opts = gsdRun.parseArgs(['--max-cycles', '4', '--model', 'sonnet', '--permission-mode', 'dontAsk']);
    assert.strictEqual(opts.maxCycles, 4);
    assert.strictEqual(opts.model, 'sonnet');
    assert.strictEqual(opts.permissionMode, 'dontAsk');
  });
});

// ─── handover detection ───────────────────────────────────────────────────────

describe('gsd-run handover detection', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createRunnableProject(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  test('returns null with no handover pending', () => {
    assert.strictEqual(gsdRun.findHandover(tmpDir), null);
  });

  test('finds a context-guard handover in a phase directory', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '03-thing');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '.continue-here.md'), 'x', 'utf-8');

    const found = gsdRun.findHandover(tmpDir);
    assert.ok(found, 'should find the handover file');
    assert.match(found, /03-thing/);
  });

  test('a pending handover routes the cycle to resume-work, not a fresh phase', () => {
    assert.match(gsdRun.buildPrompt('.planning/phases/03-thing/.continue-here.md'), /resume-work/);
    assert.match(gsdRun.buildPrompt(null), /^\/gsd:autonomous$/);
  });
});

// ─── preconditions ────────────────────────────────────────────────────────────

describe('gsd-run preconditions', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createRunnableProject(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  test('refuses a project with no ROADMAP.md', () => {
    fs.rmSync(path.join(tmpDir, '.planning', 'ROADMAP.md'));
    const result = runController(tmpDir, ['--dry-run']);
    assert.strictEqual(result.code, 1);
    assert.match(result.stderr, /ROADMAP\.md/);
  });

  test('refuses a directory with no .planning/', () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-bare-'));
    try {
      const result = runController(bare, ['--dry-run']);
      assert.strictEqual(result.code, 1);
      assert.match(result.stderr, /new-project/);
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
  });

  test('dry run executes nothing and exits clean', () => {
    const result = runController(tmpDir, ['--dry-run', '--max-cycles', '2']);
    assert.strictEqual(result.code, 0);
    assert.match(result.stdout, /would run/);
    assert.match(result.stdout, /GSD_AUTONOMY_MODE=batched/);
  });
});

// ─── loop control ─────────────────────────────────────────────────────────────

describe('gsd-run loop control', SKIP_STUB, () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createRunnableProject(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  test('stops as soon as the milestone completes', () => {
    const { stubPath, counterPath } = createStubClaude(tmpDir, ['continue', 'complete']);
    const result = runController(tmpDir, ['--claude-bin', stubPath, '--max-cycles', '8']);

    assert.strictEqual(result.code, 0);
    assert.strictEqual(readCounter(counterPath).calls, 2, 'should not spawn a cycle after completion');
    assert.match(result.stdout, /Milestone complete/);
  });

  test('stops on blocked and surfaces the reason', () => {
    const { stubPath, counterPath } = createStubClaude(tmpDir, ['continue', 'blocked', 'complete']);
    const result = runController(tmpDir, ['--claude-bin', stubPath, '--max-cycles', '8']);

    assert.strictEqual(result.code, 2);
    assert.strictEqual(readCounter(counterPath).calls, 2, 'must not keep going past a blocker');
    assert.match(result.stdout, /Blocked: blocked from stub/);
  });

  test('honours the cycle cap when work never finishes', () => {
    const { stubPath, counterPath } = createStubClaude(tmpDir, ['continue']);
    const result = runController(tmpDir, ['--claude-bin', stubPath, '--max-cycles', '3']);

    assert.strictEqual(result.code, 3);
    assert.strictEqual(readCounter(counterPath).calls, 3);
    assert.match(result.stdout, /Cycle cap/);
  });

  test('stops after two cycles that update no status — no infinite spin', () => {
    const { stubPath, counterPath } = createStubClaude(tmpDir, ['silent']);
    const result = runController(tmpDir, ['--claude-bin', stubPath, '--max-cycles', '20']);

    assert.strictEqual(result.code, 2);
    assert.strictEqual(readCounter(counterPath).calls, 2, 'should give up after two silent cycles');
    assert.match(result.stdout, /no status update/);
  });

  test('tolerates a single silent cycle then carries on', () => {
    const { stubPath, counterPath } = createStubClaude(tmpDir, ['silent', 'continue', 'complete']);
    const result = runController(tmpDir, ['--claude-bin', stubPath, '--max-cycles', '8']);

    assert.strictEqual(result.code, 0);
    assert.strictEqual(readCounter(counterPath).calls, 3);
  });

  test('passes the mode to the cycle as GSD_AUTONOMY_MODE', () => {
    const { stubPath, counterPath } = createStubClaude(tmpDir, ['complete']);
    runController(tmpDir, ['--claude-bin', stubPath, '--mode', 'unattended']);
    assert.strictEqual(readCounter(counterPath).mode, 'unattended');
  });

  test('invokes claude headlessly with the autonomous command', () => {
    const { stubPath, counterPath } = createStubClaude(tmpDir, ['complete']);
    runController(tmpDir, ['--claude-bin', stubPath, '--model', 'sonnet']);

    const { argv } = readCounter(counterPath);
    assert.strictEqual(argv[0], '-p');
    assert.match(argv[1], /^\/gsd:autonomous/);
    assert.ok(argv.includes('--permission-mode'));
    assert.ok(argv.includes('sonnet'));
  });

  test('writes a run log the user can read afterwards', () => {
    const { stubPath } = createStubClaude(tmpDir, ['continue', 'complete']);
    runController(tmpDir, ['--claude-bin', stubPath]);

    const log = fs.readFileSync(path.join(tmpDir, '.planning', 'AUTONOMOUS-LOG.md'), 'utf-8');
    const rows = log.split('\n').filter(l => /^\| \d{4}-/.test(l));
    assert.strictEqual(rows.length, 2, 'one row per cycle');
  });

  test('reports a missing claude binary clearly', () => {
    const result = runController(tmpDir, ['--claude-bin', path.join(tmpDir, 'nope')]);
    assert.strictEqual(result.code, 1);
    assert.match(result.stderr, /Is Claude Code installed/);
  });
});

// ─── cycle cap resolution ─────────────────────────────────────────────────────

describe('gsd-run cycle cap', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createRunnableProject(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  test('reads autonomy.max_cycles from config', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ autonomy: { max_cycles: 17 } }),
      'utf-8'
    );
    assert.strictEqual(gsdRun.readConfiguredCap(tmpDir), 17);
  });

  test('defaults to 10 when config.json is absent — the controller must still run', () => {
    fs.rmSync(path.join(tmpDir, '.planning', 'config.json'));
    assert.strictEqual(gsdRun.readConfiguredCap(tmpDir), 10);
  });

  test('defaults to 10 when config.json is malformed', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'config.json'), '{ nope', 'utf-8');
    assert.strictEqual(gsdRun.readConfiguredCap(tmpDir), 10);
  });

  test('ignores a nonsense cap value', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ autonomy: { max_cycles: 0 } }),
      'utf-8'
    );
    assert.strictEqual(gsdRun.readConfiguredCap(tmpDir), 10);
  });
});

// ─── quiet mode and headless marker ───────────────────────────────────────────

describe('gsd-run quiet mode', SKIP_STUB, () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createRunnableProject(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  test('--quiet sends cycle output to the log instead of the terminal', () => {
    // The stub prints to stdout; with --quiet that must not reach the controller's.
    const { stubPath } = createChattyStub(tmpDir, ['complete']);

    const result = runController(tmpDir, ['--claude-bin', stubPath, '--quiet']);

    assert.strictEqual(result.code, 0);
    assert.ok(!result.stdout.includes('CYCLE CHATTER'), 'cycle output must not flood the caller');
    const log = fs.readFileSync(path.join(tmpDir, '.planning', 'autonomous-run.log'), 'utf-8');
    assert.match(log, /CYCLE CHATTER/);
    assert.match(log, /Cycle 1/);
  });

  test('without --quiet the cycle output still reaches the terminal', () => {
    const { stubPath } = createChattyStub(tmpDir, ['complete']);

    const result = runController(tmpDir, ['--claude-bin', stubPath]);
    assert.match(result.stdout, /CYCLE CHATTER/);
  });

  test('appends across cycles rather than truncating', () => {
    const { stubPath } = createStubClaude(tmpDir, ['continue', 'complete']);
    runController(tmpDir, ['--claude-bin', stubPath, '--quiet']);

    const log = fs.readFileSync(path.join(tmpDir, '.planning', 'autonomous-run.log'), 'utf-8');
    assert.match(log, /Cycle 1/);
    assert.match(log, /Cycle 2/);
  });

  test('marks spawned cycles headless so interactive reviews are skipped', () => {
    const stubPath = path.join(tmpDir, 'stub-env');
    const outPath = path.join(tmpDir, 'env-out');
    fs.writeFileSync(
      stubPath,
      `#!/usr/bin/env node
require('fs').writeFileSync(${JSON.stringify(outPath)}, String(process.env.GSD_AUTONOMY_HEADLESS));
require('fs').writeFileSync(${JSON.stringify(path.join(tmpDir, '.planning', '.autonomous-status.json'))},
  JSON.stringify({ status: 'complete', updated_at: new Date().toISOString() }));
`,
      { mode: 0o755 }
    );

    runController(tmpDir, ['--claude-bin', stubPath]);
    assert.strictEqual(fs.readFileSync(outPath, 'utf-8'), '1');
  });
});
