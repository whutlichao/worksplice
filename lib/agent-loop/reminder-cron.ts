import { fireDueReminders } from "../raft/reminders.ts";

/**
 * reminder cron（§5.6）：进程常驻期间逐分钟轮询 reminders 表
 * （status=scheduled 且 fire_at <= now）→ 触发（fireDueReminders）。
 * 状态挂 globalThis 扛热重载；now 可注入（测试）；timer 幂等启停。
 */

interface CronState {
  started: boolean;
  timer: NodeJS.Timeout | null;
  pollMs: number;
  now: () => Date;
}

declare global {
  var __workspliceReminderCron: CronState | undefined;
}

/** 轮询周期（§5.6 逐分钟）。 */
export const REMINDER_POLL_MS = 60_000;

function getState(): CronState {
  if (!globalThis.__workspliceReminderCron) {
    globalThis.__workspliceReminderCron = {
      started: false,
      timer: null,
      pollMs: REMINDER_POLL_MS,
      now: () => new Date(),
    };
  }
  return globalThis.__workspliceReminderCron;
}

export function startReminderCron(deps: { pollMs?: number; now?: () => Date } = {}): () => void {
  const state = getState();
  if (state.started) return stopReminderCron;
  state.started = true;
  state.pollMs = deps.pollMs ?? REMINDER_POLL_MS;
  state.now = deps.now ?? (() => new Date());
  state.timer = setInterval(() => {
    try {
      tickReminderCron(state.now());
    } catch (error) {
      console.error(
        "[worksplice] reminder cron tick failed:",
        error instanceof Error ? error.message : String(error),
      );
    }
  }, state.pollMs);
  return stopReminderCron;
}

export function stopReminderCron(): void {
  const state = getState();
  if (!state.started) return;
  state.started = false;
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
}

/** 单轮扫描（cron interval 与测试共用）：返回本次触发的提醒数。 */
export function tickReminderCron(now: Date = new Date()): number {
  const outcomes = fireDueReminders(now);
  return outcomes.filter((outcome) => outcome.status === "fired").length;
}
