// Tests for hooks/gsd-context-guard.js — the fork's token-aware context guard.
//
// Contract under test:
//  - Hook mode (stdin JSON, PostToolUse shape): reads transcript_path, computes
//    context tokens from the LAST main-chain assistant entry's message.usage
//    (input + cache_read + cache_creation + output). Emits additionalContext
//    JSON when tokens >= soft (default 150k) or >= hard (default 250k), or when
//    the statusline bridge file reports remaining <= 35% / <= 25% (OR logic).
//  - Mode: "handover" instructions when cwd contains .planning/ (or
//    GSD_CONTEXT_GUARD_MODE=handover); upstream-style advisory otherwise.
//  - Debounce: soft warnings at most every 5 tool calls per session; hard
//    warnings always fire; soft->hard escalation bypasses debounce.
//  - CLI mode: --status [--transcript <path>] prints JSON status, never blocks.
//  - Any malformed/missing input: exit 0, no output (never break tool flow).

const { spawnSync } = require('child_process');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOK = path.join(__dirname, '..', 'hooks', 'gsd-context-guard.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxguard-test-'));

let caseNum = 0;
function tdir(name) {
  const d = path.join(TMP, `${++caseNum}-${name}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function usageEntry(input, cacheRead, cacheCreate, output, extra = {}) {
  return Object.assign(
    {
      type: 'assistant',
      message: {
        role: 'assistant',
        usage: {
          input_tokens: input,
          cache_read_input_tokens: cacheRead,
          cache_creation_input_tokens: cacheCreate,
          output_tokens: output,
        },
      },
    },
    extra
  );
}

function writeTranscript(dir, entries) {
  const p = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(p, entries.map((e) => (typeof e === 'string' ? e : JSON.stringify(e))).join('\n') + '\n');
  return p;
}

function runHook(inputObj, { env = {}, args = [] } = {}) {
  const res = spawnSync(process.execPath, [HOOK, ...args], {
    input: inputObj === undefined ? '' : typeof inputObj === 'string' ? inputObj : JSON.stringify(inputObj),
    encoding: 'utf8',
    env: Object.assign({}, process.env, env),
    timeout: 15000,
  });
  return { stdout: (res.stdout || '').trim(), stderr: (res.stderr || '').trim(), code: res.status };
}

function runCli(args, env = {}) {
  const res = spawnSync(process.execPath, [HOOK, ...args], {
    encoding: 'utf8',
    env: Object.assign({}, process.env, env),
    timeout: 15000,
    input: '',
  });
  return { stdout: (res.stdout || '').trim(), stderr: (res.stderr || '').trim(), code: res.status };
}

function parseWarning(stdout) {
  const obj = JSON.parse(stdout);
  assert.ok(obj.hookSpecificOutput, 'expected hookSpecificOutput');
  assert.strictEqual(obj.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.ok(obj.hookSpecificOutput.additionalContext, 'expected additionalContext');
  return obj.hookSpecificOutput.additionalContext;
}

function hookInput(sessionId, transcriptPath, cwd) {
  return {
    session_id: sessionId,
    transcript_path: transcriptPath,
    cwd,
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
  };
}

let sessionCounter = 0;
function sid() {
  return `ctxguard-test-${process.pid}-${Date.now()}-${++sessionCounter}`;
}

const failures = [];
function test(name, fn) {
  try {
    fn();
    console.log(`  ok - ${name}`);
  } catch (e) {
    failures.push({ name, error: e });
    console.log(`  FAIL - ${name}`);
    console.log(`    ${e.message}`);
  }
}

// ---------------------------------------------------------------------------

console.log('context-guard tests');

test('hook exists', () => {
  assert.ok(fs.existsSync(HOOK), `missing ${HOOK}`);
});

test('silent under soft limit', () => {
  const dir = tdir('under-soft');
  const t = writeTranscript(dir, [usageEntry(30000, 15000, 5000, 500)]); // 50.5k
  const r = runHook(hookInput(sid(), t, dir));
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.stdout, '');
});

test('soft limit fires with advisory text outside GSD projects', () => {
  const dir = tdir('soft-advisory');
  const t = writeTranscript(dir, [usageEntry(40000, 115000, 5000, 500)]); // 160.5k
  const r = runHook(hookInput(sid(), t, dir));
  assert.strictEqual(r.code, 0);
  const msg = parseWarning(r.stdout);
  assert.ok(/SOFT LIMIT/.test(msg), `expected SOFT LIMIT in: ${msg}`);
  assert.ok(/16[01]k/.test(msg), `expected ~160k token estimate in: ${msg}`);
  assert.ok(!/context-handover\.md/.test(msg), `advisory mode must not cite handover protocol: ${msg}`);
});

test('soft limit fires with handover instructions inside GSD projects', () => {
  const dir = tdir('soft-handover');
  fs.mkdirSync(path.join(dir, '.planning'), { recursive: true });
  const t = writeTranscript(dir, [usageEntry(40000, 115000, 5000, 500)]);
  const r = runHook(hookInput(sid(), t, dir));
  const msg = parseWarning(r.stdout);
  assert.ok(/SOFT LIMIT/.test(msg));
  assert.ok(/still in step/i.test(msg), `expected same-step marker instruction: ${msg}`);
  assert.ok(/context-handover\.md/.test(msg), `expected protocol reference: ${msg}`);
});

test('GSD_CONTEXT_GUARD_MODE=handover forces handover mode without .planning', () => {
  const dir = tdir('env-handover');
  const t = writeTranscript(dir, [usageEntry(40000, 115000, 5000, 500)]);
  const r = runHook(hookInput(sid(), t, dir), { env: { GSD_CONTEXT_GUARD_MODE: 'handover' } });
  const msg = parseWarning(r.stdout);
  assert.ok(/context-handover\.md/.test(msg));
});

test('hard limit fires with STOP instructions', () => {
  const dir = tdir('hard');
  fs.mkdirSync(path.join(dir, '.planning'), { recursive: true });
  const t = writeTranscript(dir, [usageEntry(60000, 195000, 5000, 1000)]); // 261k
  const r = runHook(hookInput(sid(), t, dir));
  const msg = parseWarning(r.stdout);
  assert.ok(/HARD LIMIT/.test(msg), `expected HARD LIMIT in: ${msg}`);
  assert.ok(/STOP/i.test(msg));
});

test('soft debounce: second call within 5 tool uses is silent', () => {
  const dir = tdir('debounce');
  const t = writeTranscript(dir, [usageEntry(40000, 115000, 5000, 500)]);
  const session = sid();
  const r1 = runHook(hookInput(session, t, dir));
  assert.notStrictEqual(r1.stdout, '', 'first warning should fire');
  const r2 = runHook(hookInput(session, t, dir));
  assert.strictEqual(r2.stdout, '', 'second warning should be debounced');
});

test('escalation soft->hard bypasses debounce', () => {
  const dir = tdir('escalation');
  const tSoft = writeTranscript(dir, [usageEntry(40000, 115000, 5000, 500)]);
  const session = sid();
  const r1 = runHook(hookInput(session, tSoft, dir));
  assert.notStrictEqual(r1.stdout, '');
  const dir2 = tdir('escalation-hard');
  const tHard = writeTranscript(dir2, [usageEntry(60000, 195000, 5000, 1000)]);
  const r2 = runHook(hookInput(session, tHard, dir2));
  assert.ok(/HARD LIMIT/.test(parseWarning(r2.stdout)), 'hard warning should bypass debounce');
});

test('hard warnings always fire (no debounce)', () => {
  const dir = tdir('hard-repeat');
  const t = writeTranscript(dir, [usageEntry(60000, 195000, 5000, 1000)]);
  const session = sid();
  const r1 = runHook(hookInput(session, t, dir));
  const r2 = runHook(hookInput(session, t, dir));
  assert.ok(/HARD LIMIT/.test(parseWarning(r1.stdout)));
  assert.ok(/HARD LIMIT/.test(parseWarning(r2.stdout)), 'hard must fire every time');
});

test('env token threshold overrides', () => {
  const dir = tdir('env-thresholds');
  const t = writeTranscript(dir, [usageEntry(1200, 200, 100, 50)]); // 1550
  const r = runHook(hookInput(sid(), t, dir), {
    env: { GSD_CTX_SOFT_TOKENS: '1000', GSD_CTX_HARD_TOKENS: '900000' },
  });
  assert.ok(/SOFT LIMIT/.test(parseWarning(r.stdout)));
});

test('uses LAST main-chain assistant entry, skipping sidechain and non-assistant entries', () => {
  const dir = tdir('last-entry');
  const t = writeTranscript(dir, [
    usageEntry(10000, 5000, 1000, 200), // old, small
    usageEntry(40000, 115000, 5000, 500), // latest main-chain: 160.5k
    usageEntry(3000, 1000, 500, 100, { isSidechain: true }), // sidechain after — must be skipped
    { type: 'user', message: { role: 'user', content: 'tool result junk' } },
  ]);
  const r = runHook(hookInput(sid(), t, dir));
  const msg = parseWarning(r.stdout);
  assert.ok(/16[01]k/.test(msg), `should report ~160k from last main-chain entry: ${msg}`);
});

test('finds usage entry even when followed by a very large trailing line', () => {
  const dir = tdir('big-tail');
  const bigLine = JSON.stringify({ type: 'user', message: { role: 'user', content: 'x'.repeat(2 * 1024 * 1024) } });
  const t = writeTranscript(dir, [usageEntry(60000, 195000, 5000, 1000), bigLine]);
  const r = runHook(hookInput(sid(), t, dir));
  assert.ok(/HARD LIMIT/.test(parseWarning(r.stdout)));
});

test('bridge file fallback when transcript is missing (percentage soft)', () => {
  const dir = tdir('bridge-soft');
  const session = sid();
  fs.writeFileSync(
    path.join(os.tmpdir(), `claude-ctx-${session}.json`),
    JSON.stringify({ session_id: session, remaining_percentage: 30, used_pct: 64, timestamp: Math.floor(Date.now() / 1000) })
  );
  const r = runHook(hookInput(session, path.join(dir, 'nope.jsonl'), dir));
  const msg = parseWarning(r.stdout);
  assert.ok(/SOFT LIMIT/.test(msg), `expected soft from bridge pct: ${msg}`);
});

test('bridge percentage can escalate to hard even when tokens are low (OR logic)', () => {
  const dir = tdir('bridge-or');
  const session = sid();
  const t = writeTranscript(dir, [usageEntry(50000, 40000, 5000, 500)]); // 95.5k — under soft
  fs.writeFileSync(
    path.join(os.tmpdir(), `claude-ctx-${session}.json`),
    JSON.stringify({ session_id: session, remaining_percentage: 20, used_pct: 76, timestamp: Math.floor(Date.now() / 1000) })
  );
  const r = runHook(hookInput(session, t, dir));
  const msg = parseWarning(r.stdout);
  assert.ok(/HARD LIMIT/.test(msg), `expected hard via bridge remaining<=25: ${msg}`);
});

test('stale bridge file is ignored', () => {
  const dir = tdir('bridge-stale');
  const session = sid();
  fs.writeFileSync(
    path.join(os.tmpdir(), `claude-ctx-${session}.json`),
    JSON.stringify({ session_id: session, remaining_percentage: 10, used_pct: 90, timestamp: Math.floor(Date.now() / 1000) - 3600 })
  );
  const t = writeTranscript(dir, [usageEntry(30000, 15000, 5000, 500)]); // 50.5k
  const r = runHook(hookInput(session, t, dir));
  assert.strictEqual(r.stdout, '', 'stale bridge + low tokens should stay silent');
});

test('malformed stdin exits 0 silently', () => {
  const r = runHook('this is not json');
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.stdout, '');
});

test('missing transcript and no bridge exits 0 silently', () => {
  const dir = tdir('nothing');
  const r = runHook(hookInput(sid(), path.join(dir, 'missing.jsonl'), dir));
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.stdout, '');
});

test('CLI --status reports tokens and level as JSON', () => {
  const dir = tdir('cli-status');
  const t = writeTranscript(dir, [usageEntry(40000, 115000, 5000, 500)]); // 160.5k
  const r = runCli(['--status', '--transcript', t]);
  assert.strictEqual(r.code, 0);
  const st = JSON.parse(r.stdout);
  assert.strictEqual(st.context_tokens, 160500);
  assert.strictEqual(st.level, 'soft');
  assert.strictEqual(st.soft_limit_tokens, 150000);
  assert.strictEqual(st.hard_limit_tokens, 250000);
  assert.strictEqual(st.source, 'transcript');
});

test('CLI --status level=ok under limits and level=hard above', () => {
  const dir = tdir('cli-levels');
  const tOk = writeTranscript(tdir('cli-ok'), [usageEntry(30000, 15000, 5000, 500)]);
  const stOk = JSON.parse(runCli(['--status', '--transcript', tOk]).stdout);
  assert.strictEqual(stOk.level, 'ok');
  const tHard = writeTranscript(dir, [usageEntry(60000, 195000, 5000, 1000)]);
  const stHard = JSON.parse(runCli(['--status', '--transcript', tHard]).stdout);
  assert.strictEqual(stHard.level, 'hard');
});

test('CLI --status with missing transcript still exits 0 with source none', () => {
  const r = runCli(['--status', '--transcript', path.join(TMP, 'does-not-exist.jsonl')]);
  assert.strictEqual(r.code, 0);
  const st = JSON.parse(r.stdout);
  assert.strictEqual(st.source, 'none');
  assert.strictEqual(st.level, 'unknown');
});

// ---------------------------------------------------------------------------

try {
  fs.rmSync(TMP, { recursive: true, force: true });
} catch (e) {
  /* best-effort cleanup */
}

if (failures.length) {
  console.log(`\n${failures.length} test(s) failed`);
  process.exit(1);
}
console.log('\nall tests passed');
