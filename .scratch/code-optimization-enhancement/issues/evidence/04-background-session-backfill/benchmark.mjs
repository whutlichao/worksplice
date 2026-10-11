import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

const root = process.env.WS_ROOT;
const mode = process.env.BENCH_MODE ?? "steady";
const side = process.env.BENCH_SIDE ?? "candidate";
const output = process.env.BENCH_OUTPUT;
if (!root || !output) throw new Error("WS_ROOT and BENCH_OUTPUT are required");

const importFromRoot = (relative) => import(pathToFileURL(path.join(root, relative)).href);
const { openDataDb } = await importFromRoot("lib/data/sqlite.ts");
const { createAgent } = await importFromRoot("lib/domain/collab/members.ts");
const { createChannel, joinChannel } = await importFromRoot("lib/domain/collab/channels.ts");
const { sendMessage } = await importFromRoot("lib/domain/collab/messages.ts");
const loopModule = await importFromRoot("lib/agent-loop/loop.ts");
const status = await importFromRoot("lib/agent-status.ts");
const { createAgentLoop } = loopModule;
const { stopAgentStatusSweeper } = status;

const workloads = mode === "barrier"
  ? [{ name: "small", agents: 1, bytes: 64 * 1024, rounds: 20 }]
  : [
      { name: "small", agents: 2, bytes: 64 * 1024, rounds: 20 },
      { name: "medium", agents: 8, bytes: 256 * 1024, rounds: 64 },
      { name: "large", agents: 12, bytes: 512 * 1024, rounds: 128 },
    ];
const measuredSamples = Number(process.env.BENCH_SAMPLES ?? 30);
const warmups = Number(process.env.BENCH_WARMUPS ?? 1);
const rows = [];

const nowMs = () => performance.now();
const setImmediatePromise = () => new Promise((resolve) => setImmediate(resolve));

function sessionLine(entry) {
  return `${JSON.stringify(entry)}\n`;
}

function buildSessionFile({ cwd, channelId, rounds, targetBytes, agentIndex }) {
  let raw = sessionLine({
    type: "session",
    version: 3,
    id: `synthetic-session-${agentIndex}`,
    timestamp: "2025-01-01T00:00:00.000Z",
    cwd,
  });
  for (let round = 1; round <= rounds; round += 1) {
    raw += sessionLine({
      type: "message",
      id: `synthetic-user-${agentIndex}-${round}`,
      parentId: null,
      message: {
        role: "user",
        content: `[worksplice:target=${channelId} seq=${round}] synthetic recovery input`,
      },
    });
    raw += sessionLine({
      type: "message",
      id: `synthetic-assistant-${agentIndex}-${round}`,
      parentId: `synthetic-user-${agentIndex}-${round}`,
      message: {
        role: "assistant",
        content: JSON.stringify({
          action: "reply",
          content: `synthetic-recovered-agent-${agentIndex}-round-${round}`,
        }),
      },
    });
  }
  let fillerIndex = 0;
  const fillerPayload = "x".repeat(180);
  const filler = () => sessionLine({
    type: "usage",
    id: `synthetic-usage-${agentIndex}-${fillerIndex++}`,
    parentId: null,
    kind: "benchmark",
    note: fillerPayload,
  });
  while (Buffer.byteLength(raw) < targetBytes) raw += filler();
  return raw;
}

async function waitUntil(predicate, timeoutMs = 30_000) {
  const deadline = nowMs() + timeoutMs;
  while (!predicate()) {
    if (nowMs() >= deadline) throw new Error("benchmark wait timed out");
    await setImmediatePromise();
  }
}

function makeIdleSession(onPrompt) {
  const listeners = new Set();
  return {
    lastText: '{"action":"ignore"}',
    isRunning: () => false,
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async send(command) {
      if (command.type === "prompt") {
        onPrompt();
        queueMicrotask(() => {
          for (const listener of listeners) listener({ type: "prompt_done" });
          for (const listener of listeners) listener({ type: "agent_settled" });
        });
        return null;
      }
      if (command.type === "get_last_assistant_text") return { text: this.lastText };
      if (command.type === "get_last_assistant_error") {
        return { stopReason: null, errorMessage: null };
      }
      return null;
    },
  };
}

async function createFixture(workload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-ticket04-bench-"));
  const dbDir = path.join(dir, "data");
  fs.mkdirSync(dbDir, { recursive: true });
  globalThis.__workspliceDb = openDataDb(dbDir);
  const db = globalThis.__workspliceDb;
  const channel = createChannel({ name: `synthetic-${workload.name}` });
  const agents = [];
  const files = [];
  for (let index = 0; index < workload.agents; index += 1) {
    const workspace = path.join(dir, `workspace-${index}`);
    fs.mkdirSync(workspace, { recursive: true });
    const agent = createAgent({ name: `Synthetic ${workload.name} ${index}`, workspacePath: workspace });
    joinChannel(channel.id, agent.id);
    const file = path.join(dir, `session-${index}.jsonl`);
    fs.writeFileSync(file, buildSessionFile({
      cwd: workspace,
      channelId: channel.id,
      rounds: workload.rounds,
      targetBytes: workload.bytes,
      agentIndex: index,
    }));
    db.setMemberPiSessionFile(agent.id, file);
    agents.push(agent);
    files.push(file);
  }
  return { dir, db, channel, agents, files };
}

async function cleanupFixture(fixture, agentLoop) {
  try { agentLoop?.stop(); } catch {}
  stopAgentStatusSweeper();
  try { fixture?.db?.close(); } catch {}
  if (fixture?.dir) fs.rmSync(fixture.dir, { recursive: true, force: true });
  globalThis.__workspliceDb = undefined;
}

function roundsComplete(db, agents, channelId, rounds) {
  if (db.listMessages(channelId).length < agents.length * rounds) return false;
  return agents.every((agent) => db.getConsumedSeq(agent.id, channelId) >= rounds);
}

async function runSteady(workload, sampleIndex, warmup) {
  const fixture = await createFixture(workload);
  let yields = 0;
  let firstYieldMs = null;
  let lastYieldMs = null;
  const startAt = nowMs();
  let agentLoop;
  try {
    agentLoop = createAgentLoop({
      runtime: {
        findSession: () => undefined,
        startSession: async () => { throw new Error("synthetic steady-state benchmark has no model session"); },
      },
      backfill: {
        onBatchYield: () => {
          const elapsed = nowMs() - startAt;
          yields += 1;
          firstYieldMs ??= elapsed;
          lastYieldMs = elapsed;
        },
      },
    });
    const beforeStart = nowMs();
    agentLoop.start();
    const startReadyMs = nowMs() - beforeStart;
    await waitUntil(() => roundsComplete(fixture.db, fixture.agents, fixture.channel.id, workload.rounds));
    const recoveryMs = nowMs() - startAt;
    const row = {
      mode: "steady",
      workload: workload.name,
      sample: sampleIndex,
      warmup,
      agents: workload.agents,
      sessionFiles: fixture.files.length,
      targetBytesPerFile: workload.bytes,
      actualBytesPerFile: fs.statSync(fixture.files[0]).size,
      markerRoundsPerFile: workload.rounds,
      startReadyMs,
      recoveryMs,
      scanMs: recoveryMs,
      yieldPoints: yields,
      firstYieldMs,
      lastYieldMs,
      syntheticReplies: workload.agents * workload.rounds,
    };
    rows.push(row);
  } finally {
    await cleanupFixture(fixture, agentLoop);
  }
}

async function runBarrier(workload, sampleIndex, warmup) {
  const fixture = await createFixture(workload);
  const targetAgent = fixture.agents[0];
  const targetFile = fixture.files[0];
  let readStartedResolve;
  const readStarted = new Promise((resolve) => { readStartedResolve = resolve; });
  let releaseRead;
  const readGate = new Promise((resolve) => { releaseRead = resolve; });
  const startAt = nowMs();
  let agentLoop;
  try {
    let promptCount = 0;
    const session = makeIdleSession(() => { promptCount += 1; });
    const runtime = {
      findSession: () => session,
      startSession: async () => { throw new Error("synthetic barrier benchmark already has a fake session"); },
    };
    agentLoop = createAgentLoop(side === "baseline"
      ? { runtime }
      : {
          runtime,
          backfill: {
            fileOps: {
              stat: async (filePath) => fs.promises.stat(filePath),
              readFile: async () => { throw new Error("streaming reader should be used"); },
              readChunks: async function* (filePath, signal) {
                if (filePath === targetFile) {
                  readStartedResolve();
                  await readGate;
                }
                yield* fs.createReadStream(filePath, {
                  encoding: "utf8",
                  highWaterMark: 64 * 1024,
                  signal,
                });
              },
            },
          },
        });
    const wakeRequestedAt = nowMs();
    const scheduledWake = side === "baseline"
      ? new Promise((resolve) => setImmediate(() => {
          sendMessage({
            targetId: fixture.channel.id,
            authorId: "owner",
            content: "synthetic wake queued through synchronous startup",
            baseSeq: fixture.db.maxSeq(fixture.channel.id),
          });
          resolve();
        }))
      : null;
    const beforeStart = nowMs();
    agentLoop.start();
    const startReadyMs = nowMs() - beforeStart;
    if (side === "baseline") {
      await scheduledWake;
      const barrierWaitMs = nowMs() - wakeRequestedAt;
      await waitUntil(() => fixture.db.listRoundLogs(targetAgent.id).length >= 1);
      rows.push({
        mode: "barrier",
        workload: workload.name,
        sample: sampleIndex,
        warmup,
        agents: workload.agents,
        sessionFiles: fixture.files.length,
        targetBytesPerFile: workload.bytes,
        actualBytesPerFile: fs.statSync(targetFile).size,
        markerRoundsPerFile: workload.rounds,
        startReadyMs,
        requestedGateDelayMs: null,
        barrierWaitMs,
        recoveryAfterReleaseMs: 0,
        recoveredReplies: fixture.db.listMessages(fixture.channel.id).length,
      });
      return;
    }
    await readStarted;
    const wakeAt = nowMs();
    sendMessage({
      targetId: fixture.channel.id,
      authorId: "owner",
      content: "synthetic wake during backfill",
      baseSeq: fixture.db.maxSeq(fixture.channel.id),
    });
    const barrierGateDelayMs = 3;
    await new Promise((resolve) => setTimeout(resolve, barrierGateDelayMs));
    if (promptCount !== 0) throw new Error("backfill barrier released its wake before the gated scan completed");
    const barrierWaitMs = nowMs() - wakeAt;
    const releaseAt = nowMs();
    releaseRead();
    await waitUntil(() => fixture.db.getConsumedSeq(targetAgent.id, fixture.channel.id) >= workload.rounds);
    const recoveryAfterReleaseMs = nowMs() - releaseAt;
    await waitUntil(() => fixture.db.getConsumedSeq(targetAgent.id, fixture.channel.id) >= workload.rounds + 1);
    await setImmediatePromise();
    rows.push({
      mode: "barrier",
      workload: workload.name,
      sample: sampleIndex,
      warmup,
      agents: workload.agents,
      sessionFiles: fixture.files.length,
      targetBytesPerFile: workload.bytes,
      actualBytesPerFile: fs.statSync(targetFile).size,
      markerRoundsPerFile: workload.rounds,
      startReadyMs,
      requestedGateDelayMs: barrierGateDelayMs,
      barrierWaitMs,
      recoveryAfterReleaseMs,
      recoveredReplies: fixture.db.listMessages(fixture.channel.id).length - 1,
    });
  } finally {
    releaseRead();
    await cleanupFixture(fixture, agentLoop);
  }
}

for (const workload of workloads) {
  const total = warmups + measuredSamples;
  for (let index = 0; index < total; index += 1) {
    const warmup = index < warmups;
    if (mode === "barrier") await runBarrier(workload, index - warmups, warmup);
    else await runSteady(workload, index - warmups, warmup);
  }
}

fs.writeFileSync(output, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
console.log(JSON.stringify({ mode, root, samples: measuredSamples, warmups, rows: rows.length, output }));
