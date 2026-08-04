import { subscribeWake, type WakeHint } from "./wake.ts";
import { runAgentRound, PROMPT_DONE_EVENTS, type LoopRuntime } from "./loop.ts";
import { getAgent } from "../raft/members.ts";
import { getAgentRuntime } from "../agent-runtime.ts";

/**
 * agent-loop 驱动（§5.4）：把 wake hint 编排成逐 agent 串行的 runAgentRound。
 * - 每个 agent 一个 FIFO 队列；同一 (agent, target) 的并发 hint 合并（一次 drain 取尽）；
 * - 会话正忙（busy）时不丢 hint：在 settle 事件后重试一次；
 * - 状态全部挂 globalThis（热重载安全）；runtime 可注入（测试传 fake）。
 */

interface DriverState {
  started: boolean;
  runtime: LoopRuntime | null;
  stopWake: (() => void) | null;
  queues: Map<string, string[]>;
  processing: Set<string>;
  waitingForSettle: Set<string>;
  settleUnsubs: Map<string, () => void>;
}

declare global {
  var __workspliceAgentLoopDriver: DriverState | undefined;
}

function getState(): DriverState {
  if (!globalThis.__workspliceAgentLoopDriver) {
    globalThis.__workspliceAgentLoopDriver = {
      started: false,
      runtime: null,
      stopWake: null,
      queues: new Map(),
      processing: new Set(),
      waitingForSettle: new Set(),
      settleUnsubs: new Map(),
    };
  }
  return globalThis.__workspliceAgentLoopDriver;
}

export function startAgentLoopDriver(deps: { runtime?: LoopRuntime } = {}): () => void {
  const state = getState();
  if (state.started) return stopAgentLoopDriver;
  state.started = true;
  state.runtime = deps.runtime ?? null;
  state.stopWake = subscribeWake(enqueueWake);
  return stopAgentLoopDriver;
}

export function stopAgentLoopDriver(): void {
  const state = getState();
  if (!state.started) return;
  state.started = false;
  state.stopWake?.();
  state.stopWake = null;
  state.queues.clear();
  state.processing.clear();
  state.waitingForSettle.clear();
  for (const unsub of state.settleUnsubs.values()) unsub();
  state.settleUnsubs.clear();
  state.runtime = null;
}

/** 测试观察用：当前排队中的 (agent, target) 数量。 */
export function peekAgentLoopQueues(): Array<{ agentId: string; targets: string[] }> {
  return Array.from(getState().queues, ([agentId, targets]) => ({ agentId, targets }));
}

function enqueueWake(hint: WakeHint): void {
  const state = getState();
  if (!state.started) return;
  let queue = state.queues.get(hint.agentId);
  if (!queue) {
    queue = [];
    state.queues.set(hint.agentId, queue);
  }
  if (!queue.includes(hint.targetId)) queue.push(hint.targetId);
  void processAgent(hint.agentId);
}

async function processAgent(agentId: string): Promise<void> {
  const state = getState();
  if (state.processing.has(agentId)) return;
  if (state.waitingForSettle.has(agentId)) return;

  const runtime: LoopRuntime = state.runtime ?? (await getAgentRuntime());
  state.processing.add(agentId);
  try {
    for (;;) {
      const queue = state.queues.get(agentId);
      const targetId = queue?.shift();
      if (!targetId) break;

      let outcome;
      try {
        outcome = await runAgentRound(agentId, targetId, runtime);
      } catch (error) {
        // 成员已删除 / target 消失等：跳过该轮，继续队列
        console.error(
          "[worksplice] agent loop round failed:",
          error instanceof Error ? error.message : String(error),
        );
        continue;
      }
      if (outcome.status === "busy") {
        waitForSettle(agentId, targetId);
        break;
      }
    }
  } finally {
    state.processing.delete(agentId);
  }
  if (state.queues.get(agentId)?.length && !state.waitingForSettle.has(agentId)) {
    void processAgent(agentId);
  }
}

/** 会话正忙：等 settle 事件后把 target 放回队列重试（不丢 hint）。 */
async function waitForSettle(agentId: string, targetId: string): Promise<void> {
  const state = getState();
  if (state.waitingForSettle.has(agentId)) return;
  state.waitingForSettle.add(agentId);
  const retry = () => {
    state.waitingForSettle.delete(agentId);
    const unsub = state.settleUnsubs.get(agentId);
    if (unsub) {
      unsub();
      state.settleUnsubs.delete(agentId);
    }
    const queue = state.queues.get(agentId);
    if (queue && !queue.includes(targetId)) queue.push(targetId);
    void processAgent(agentId);
  };
  try {
    const agent = getAgent(agentId);
    const runtime: LoopRuntime = state.runtime ?? (await getAgentRuntime());
    const session = runtime.findSession(agent);
    if (!session) {
      retry();
      return;
    }
    const unsub = session.onEvent((event) => {
      if (PROMPT_DONE_EVENTS.has(event.type)) {
        retry();
      }
    });
    state.settleUnsubs.set(agentId, unsub);
  } catch {
    retry();
  }
}
