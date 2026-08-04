import { startAgentStatusSweeper } from "../agent-status.ts";
import { backfillAllAgents } from "./backfill.ts";
import { startAgentLoopDriver } from "./driver.ts";
import { startReminderCron } from "./reminder-cron.ts";

export {
  runAgentRound,
  runTaskOperation,
  buildReplyPrompt,
  buildRevisionPrompt,
  parseAgentAction,
  roomMarker,
} from "./loop.ts";
export { scanSessionReplies, backfillAgentReplies, backfillAllAgents } from "./backfill.ts";
export { startAgentLoopDriver, stopAgentLoopDriver } from "./driver.ts";
export { subscribeWake, emitWake, notifyMessageWakes, extractMentionedMemberIds } from "./wake.ts";
export { startReminderCron, stopReminderCron, tickReminderCron } from "./reminder-cron.ts";

/**
 * 启动 agent-loop 全套服务（instrumentation 调用，幂等）：
 * 1. 状态点低频扫掠（兜底 idle shutdown 漂移）；
 * 2. 崩溃恢复：启动时按 seq 补拉（SQLite 落后于 session jsonl 的回复按序补写，§5.3）；
 * 3. wake 驱动：新消息 → 唤醒对应 agent 的 loop（§5.4）；
 * 4. reminder cron：逐分钟轮询 reminders 表触发到点提醒（§5.6）。
 * 返回 stop 函数供测试/卸载使用。
 */
export function startAgentLoop(): () => void {
  startAgentStatusSweeper();
  try {
    backfillAllAgents();
  } catch (error) {
    console.error(
      "[worksplice] agent reply backfill failed:",
      error instanceof Error ? error.message : String(error),
    );
  }
  const stopDriver = startAgentLoopDriver();
  const stopCron = startReminderCron();
  return () => {
    stopDriver();
    stopCron();
  };
}
