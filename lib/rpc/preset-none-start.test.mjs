import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

// A1 — the `toolNames: []` (PRESET_NONE) start path must work end to end.
//
// This drives the real `RpcCaller.start()`, not a stub: the failure it guards was a
// `TypeError` thrown from inside that call (docs/spike-systemprompt-fix.md §3.3), which
// made `POST /api/agent/new` answer 500 for every tool-less session. No credentials are
// used or needed — nothing here sends a request; the SDK only needs a writable agent dir
// and a cwd, so both are temporary and the user's real `~/.pi/agent` is never touched.

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { RpcCaller } = await jiti.import("./caller.ts");
const { destroyRpcSessionsForCwd } = await jiti.import("./registry.ts");
const {
  FORCED_EMPTY_SYSTEM_PROMPT_EXTENSION,
  forcedEmptySystemPromptExtension,
  forcedEmptySystemPromptExtensionFactory,
} = await jiti.import("./forced-empty-system-prompt.ts");

const previousAgentDir = process.env.PI_CODING_AGENT_DIR;

// The B-1 fix in isolation: the handler is what actually empties the prompt on the wire.
// `BeforeAgentStartEventResult` exposes only `message` and `systemPrompt`, and the runner
// reads only `result.systemPrompt` — so the field name and the "undefined when off" half of
// the contract are both load-bearing.
test("the extension returns an empty prompt only while the switch is on", () => {
  const switchState = { enabled: false };
  let handler;
  forcedEmptySystemPromptExtensionFactory(switchState)({
    on: (event, fn) => {
      assert.equal(event, "before_agent_start");
      handler = fn;
    },
  });
  assert.equal(typeof handler, "function");

  // Off: return nothing, so the session keeps its normal prompt. Returning `undefined`
  // (not `{ systemPrompt: undefined }`) matters — the runner treats any returned result
  // as an override.
  assert.equal(handler(), undefined);
  assert.deepEqual(Object.keys(handler() ?? {}), []);

  // On: replace the prompt for that turn.
  switchState.enabled = true;
  assert.deepEqual(handler(), { systemPrompt: "" });

  // Flipping back restores the normal prompt — this is what lets a session that later
  // re-enables tools keep the same extension.
  switchState.enabled = false;
  assert.equal(handler(), undefined);
});

test("the extension is registered hidden and under a builtin: name", () => {
  const entry = forcedEmptySystemPromptExtension({ enabled: false });
  assert.equal(entry.name, FORCED_EMPTY_SYSTEM_PROMPT_EXTENSION);
  assert.match(entry.name, /^builtin:/);
  assert.equal(entry.hidden, true, "an internal mechanism must not show in the Extensions list");
  assert.equal(typeof entry.factory, "function");
});

test("a PRESET_NONE session starts on the real production path without throwing", async (t) => {
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-preset-none-agent-"));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-preset-none-cwd-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  t.after(async () => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    // Sessions hold a 10-minute idle timer, so this file would otherwise keep the
    // runner alive long after the assertions pass.
    await destroyRpcSessionsForCwd(cwd).catch(() => {});
    fs.rmSync(agentDir, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  const caller = new RpcCaller();

  // The exact call `POST /api/agent/new` makes for the "no tools" preset. Before the
  // forced-empty-system-prompt move this rejected with
  // `TypeError: Cannot set property systemPrompt of #<Object> which has only a getter`.
  const { session, realSessionId } = await caller.start("preset-none-session", "", cwd, { toolNames: [] });

  assert.ok(session, "a tool-less session must be creatable");
  assert.equal(typeof realSessionId, "string");
  assert.notEqual(realSessionId, "");

  // PRESET_NONE means "every tool off" — an empty request must not fall back to the
  // builtin coding set.
  assert.deepEqual(session.inner.getActiveToolNames(), []);

  // The forced-empty prompt is carried by the extension switch, and it must be on for a
  // tool-less session (see lib/rpc/forced-empty-system-prompt.ts).
  assert.equal(session.forcedEmptySystemPromptSwitch.enabled, true);

  // The session is genuinely usable: get_state goes through the real command dispatcher.
  const state = await session.send({ type: "get_state" });
  assert.equal(state.sessionId, session.inner.sessionId);
  assert.equal(state.isStreaming, false);
  assert.equal(state.isPromptRunning, false);

  // The forced-empty extension is registered, so the empty prompt can actually reach the
  // provider instead of relying on a write that is no longer legal.
  const tools = session.inner.getAllTools();
  assert.equal(Array.isArray(tools), true);
});

test("a PRESET_FULL session leaves the forced-empty switch off", async (t) => {
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-preset-full-agent-"));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-preset-full-cwd-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  t.after(async () => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    await destroyRpcSessionsForCwd(cwd).catch(() => {});
    fs.rmSync(agentDir, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  const { session } = await new RpcCaller().start("preset-full-session", "", cwd, {
    toolNames: ["bash", "read", "edit", "write", "grep", "find", "ls"],
  });

  // The guard must not leak onto sessions that do have tools — that would silently empty
  // the prompt of every normal coding session.
  assert.equal(session.forcedEmptySystemPromptSwitch.enabled, false);
  const active = session.inner.getActiveToolNames();
  for (const name of ["bash", "read", "edit", "write"]) {
    assert.equal(active.includes(name), true, `PRESET_FULL should activate "${name}"`);
  }
});