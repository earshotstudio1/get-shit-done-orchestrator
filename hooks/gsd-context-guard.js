#!/usr/bin/env node
// GSD Context Guard - token-aware context-window guard (orchestrator fork addition).
//
// Supersedes gsd-context-monitor.js: keeps the same PostToolUse/AfterTool contract
// and statusline bridge-file fallback, and adds:
//   1. Absolute token counting read directly from the session transcript
//      (the bridge only has percentages, and only for the main session).
//   2. Autonomous same-step handover instructions for GSD/orchestrator contexts
//      (see get-shit-done/references/context-handover.md). Non-GSD sessions keep
//      upstream-style advisory wording.
//   3. A CLI mode (--status) so workflows and agents can actively check their
//      own context usage between steps instead of waiting for the hook.
//
// Thresholds (env-overridable):
//   GSD_CTX_SOFT_TOKENS  default 150000  -> SOFT: finish current atomic action, hand over
//   GSD_CTX_HARD_TOKENS  default 250000  -> HARD: stop immediately, hand over
//   Bridge percentages still apply when present: remaining <=35% soft, <=25% hard.
//   Whichever source crosses first wins (OR logic) - on 200k-window models the
//   percentage triggers fire long before 250k tokens is reachable.
//
// GSD_CONTEXT_GUARD_MODE: "handover" | "advisory". Default: auto - handover when
// the working directory contains .planning/, advisory otherwise.
//
// Safety: never blocks tool execution. Any error -> exit 0, no output.

const fs = require('fs');
const os = require('os');
const path = require('path');

const SOFT_REMAINING_PCT = 35;
const HARD_REMAINING_PCT = 25;
const STALE_SECONDS = 60;
const DEBOUNCE_CALLS = 5;

function intEnv(name, dflt) {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) && v > 0 ? v : dflt;
}

const SOFT_TOKENS = intEnv('GSD_CTX_SOFT_TOKENS', 150000);
const HARD_TOKENS = intEnv('GSD_CTX_HARD_TOKENS', 250000);

// --- token counting -------------------------------------------------------

// Read the last main-chain assistant entry's usage from a Claude Code JSONL
// transcript. Context size = input + cache_read + cache_creation (+ output of
// that turn). Scans backwards with progressively larger tail windows so huge
// transcripts (and huge trailing tool-result lines) stay cheap.
function lastAssistantUsageTokens(file) {
  let fd = null;
  let size = 0;
  try {
    const st = fs.statSync(file);
    size = st.size;
    if (size === 0) return null;
    fd = fs.openSync(file, 'r');
  } catch (e) {
    return null;
  }
  try {
    const spans = [1 << 20, 16 << 20, size];
    for (const span of spans) {
      const start = Math.max(0, size - span);
      const len = size - start;
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, start);
      let text = buf.toString('utf8');
      if (start > 0) {
        // Drop the (possibly partial) first line of the window.
        const nl = text.indexOf('\n');
        if (nl === -1) continue; // one giant partial line -> widen the window
        text = text.slice(nl + 1);
      }
      const lines = text.split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (!line) continue;
        let obj;
        try {
          obj = JSON.parse(line);
        } catch (e) {
          continue;
        }
        if (obj.type !== 'assistant' || obj.isSidechain) continue;
        const u = obj.message && obj.message.usage;
        if (!u) continue;
        const inputSide =
          (u.input_tokens || 0) +
          (u.cache_read_input_tokens || 0) +
          (u.cache_creation_input_tokens || 0);
        if (inputSide <= 0) continue;
        return inputSide + (u.output_tokens || 0);
      }
      if (start === 0) break;
    }
    return null;
  } catch (e) {
    return null;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch (e) {}
    }
  }
}

// --- bridge file (written by gsd-statusline.js) ----------------------------

function readBridgeRemaining(sessionId) {
  if (!sessionId) return null;
  try {
    const p = path.join(os.tmpdir(), `claude-ctx-${sessionId}.json`);
    if (!fs.existsSync(p)) return null;
    const m = JSON.parse(fs.readFileSync(p, 'utf8'));
    const now = Math.floor(Date.now() / 1000);
    if (m.timestamp && now - m.timestamp > STALE_SECONDS) return null;
    return typeof m.remaining_percentage === 'number' ? m.remaining_percentage : null;
  } catch (e) {
    return null;
  }
}

// --- level + mode + message -------------------------------------------------

function decideLevel(tokens, remaining) {
  const hard =
    (tokens != null && tokens >= HARD_TOKENS) ||
    (remaining != null && remaining <= HARD_REMAINING_PCT);
  if (hard) return 'hard';
  const soft =
    (tokens != null && tokens >= SOFT_TOKENS) ||
    (remaining != null && remaining <= SOFT_REMAINING_PCT);
  if (soft) return 'soft';
  return null;
}

function resolveMode(cwd) {
  const env = (process.env.GSD_CONTEXT_GUARD_MODE || '').toLowerCase();
  if (env === 'handover') return 'handover';
  if (env === 'advisory') return 'advisory';
  try {
    if (cwd && fs.existsSync(path.join(cwd, '.planning'))) return 'handover';
  } catch (e) {}
  return 'advisory';
}

function usageBasis(tokens, remaining) {
  const parts = [];
  if (tokens != null) parts.push(`~${Math.round(tokens / 1000)}k tokens in context`);
  if (remaining != null && remaining <= SOFT_REMAINING_PCT) {
    parts.push(`${remaining}% of the context window remaining`);
  }
  return parts.join('; ') || 'context usage high';
}

// Confirmed in live use (2026-07-09): tool events fired by SUBAGENTS carry the
// PARENT session's transcript_path, so a fresh subagent can receive a warning
// describing its parent's context. Until per-agent transcripts are available in
// hook input, every message carries a self-disambiguation note so fresh
// delegates don't refuse work over their parent's usage.
const SUBAGENT_NOTE =
  ' [Subagent note: if you have only made a few tool calls so far, this reading is likely the ' +
  "parent session's transcript, not yours — proceed with your task and reassess only after " +
  'substantial work of your own.]';

function buildMessage(level, mode, tokens, remaining) {
  const basis = usageBasis(tokens, remaining);
  const softK = Math.round(SOFT_TOKENS / 1000);
  const hardK = Math.round(HARD_TOKENS / 1000);

  if (mode === 'handover') {
    if (level === 'hard') {
      return (
        `CONTEXT GUARD — HARD LIMIT: ${basis} (hard limit ${hardK}k). ` +
        'STOP after this tool call. Write the handover NOW: update the active progress file ' +
        '(.continue-here.md / PROGRESS.md / STATE.md) with a "Context handover — still in step: <step>" ' +
        'entry recording exactly where you are, what is done, and the exact next action, then delegate ' +
        'the remainder of this step to a fresh agent per get-shit-done/references/context-handover.md. ' +
        'Do not continue working in this context.' +
        SUBAGENT_NOTE
      );
    }
    return (
      `CONTEXT GUARD — SOFT LIMIT: ${basis} (soft ${softK}k, hard ${hardK}k). ` +
      'Finish ONLY the current atomic action, then execute the context-handover protocol ' +
      '(get-shit-done/references/context-handover.md): (1) update the active progress file ' +
      '(.continue-here.md / PROGRESS.md / STATE.md) with a "Context handover — still in step: <step>" ' +
      'entry recording exactly where you are, what is done, and the exact next action; ' +
      '(2) delegate the REMAINDER of this step to a fresh agent; ' +
      '(3) do not start new steps in this context.' +
      SUBAGENT_NOTE
    );
  }

  // Advisory mode (upstream-compatible wording; never commandeers non-GSD sessions).
  if (level === 'hard') {
    return (
      `CONTEXT GUARD — HARD LIMIT: ${basis}. Context is nearly exhausted. ` +
      'STOP starting new work. Inform the user that context is critically low and ask how they ' +
      'want to proceed. Do not autonomously write handoff files unless the user asks.' +
      SUBAGENT_NOTE
    );
  }
  return (
    `CONTEXT GUARD — SOFT LIMIT: ${basis} (soft ${softK}k). Context is getting large. ` +
    'Avoid starting new complex work and wrap up the current task at a natural stopping point. ' +
    'Inform the user so they can pause or hand off deliberately.' +
    SUBAGENT_NOTE
  );
}

// --- debounce ---------------------------------------------------------------

function shouldFire(sessionId, level) {
  if (level === 'hard') {
    // Hard warnings always fire; record state for escalation bookkeeping.
    writeWarnState(sessionId, { callsSinceWarn: 0, lastLevel: 'hard' });
    return true;
  }
  const warnPath = warnStatePath(sessionId);
  let warnData = { callsSinceWarn: 0, lastLevel: null };
  let firstWarn = true;
  try {
    if (fs.existsSync(warnPath)) {
      warnData = JSON.parse(fs.readFileSync(warnPath, 'utf8'));
      firstWarn = false;
    }
  } catch (e) {
    // corrupted state file -> treat as first warning
  }
  warnData.callsSinceWarn = (warnData.callsSinceWarn || 0) + 1;
  if (!firstWarn && warnData.callsSinceWarn < DEBOUNCE_CALLS) {
    writeWarnState(sessionId, warnData);
    return false;
  }
  writeWarnState(sessionId, { callsSinceWarn: 0, lastLevel: 'soft' });
  return true;
}

function warnStatePath(sessionId) {
  return path.join(os.tmpdir(), `claude-ctxguard-${sessionId}-warned.json`);
}

function writeWarnState(sessionId, data) {
  try {
    fs.writeFileSync(warnStatePath(sessionId), JSON.stringify(data));
  } catch (e) {}
}

// --- CLI mode (--status) -----------------------------------------------------

function mungeProjectDir(p) {
  return String(p).replace(/[^A-Za-z0-9]/g, '-');
}

function discoverTranscript(dir) {
  try {
    const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
    const projDir = path.join(claudeDir, 'projects', mungeProjectDir(dir));
    if (!fs.existsSync(projDir)) return null;
    const files = fs
      .readdirSync(projDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => {
        const full = path.join(projDir, f);
        return { full, mtime: fs.statSync(full).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
    return files.length ? files[0].full : null;
  } catch (e) {
    return null;
  }
}

function runStatus(args) {
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i !== -1 && i + 1 < args.length ? args[i + 1] : null;
  };
  const cwd = get('--dir') || process.cwd();
  const transcript = get('--transcript') || discoverTranscript(cwd);
  const sessionId = get('--session');

  let tokens = null;
  let source = 'none';
  if (transcript) {
    tokens = lastAssistantUsageTokens(transcript);
    if (tokens != null) source = 'transcript';
  }
  const remaining = readBridgeRemaining(sessionId);
  if (tokens == null && remaining != null) source = 'bridge';

  let level;
  if (tokens == null && remaining == null) {
    level = 'unknown';
  } else {
    level = decideLevel(tokens, remaining) || 'ok';
  }

  process.stdout.write(
    JSON.stringify(
      {
        transcript: transcript || null,
        context_tokens: tokens,
        soft_limit_tokens: SOFT_TOKENS,
        hard_limit_tokens: HARD_TOKENS,
        bridge_remaining_pct: remaining,
        level,
        mode: resolveMode(cwd),
        source,
      },
      null,
      2
    )
  );
  process.exit(0);
}

// --- hook mode ----------------------------------------------------------------

function runHook() {
  let input = '';
  // Timeout guard: if stdin doesn't close within 3s (e.g. pipe issues on
  // Windows/Git Bash), exit silently instead of hanging (upstream #775).
  const stdinTimeout = setTimeout(() => process.exit(0), 3000);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => (input += chunk));
  process.stdin.on('end', () => {
    clearTimeout(stdinTimeout);
    try {
      const data = JSON.parse(input);
      const sessionId = data.session_id;
      const cwd = data.cwd || process.cwd();

      let tokens = null;
      if (data.transcript_path) {
        tokens = lastAssistantUsageTokens(data.transcript_path);
      }
      const remaining = readBridgeRemaining(sessionId);

      const level = decideLevel(tokens, remaining);
      if (!level) process.exit(0);
      if (!shouldFire(sessionId || 'unknown-session', level)) process.exit(0);

      const mode = resolveMode(cwd);
      const message = buildMessage(level, mode, tokens, remaining);

      const output = {
        hookSpecificOutput: {
          hookEventName: process.env.GEMINI_API_KEY ? 'AfterTool' : 'PostToolUse',
          additionalContext: message,
        },
      };
      process.stdout.write(JSON.stringify(output));
      process.exit(0);
    } catch (e) {
      // Silent fail — never block tool execution.
      process.exit(0);
    }
  });
}

// --- entry ---------------------------------------------------------------------

try {
  const args = process.argv.slice(2);
  if (args.includes('--status')) {
    runStatus(args);
  } else {
    runHook();
  }
} catch (e) {
  process.exit(0);
}
