import {
  INJECTION_BRIEFING_CHARS,
  INJECTION_TASK_WINDOW,
  clampLines,
  clampText,
} from "./injection-budget.ts";

/**
 * 新成员首次合法准入的有界简报（票 #243）。
 *
 * 输入刻意只含频道元数据、水位与任务表已有口径（`listRelatedTasks`），
 * 不接收入群前消息正文——因此简报体积不随入群前消息数线性增长。
 */
export interface JoinBriefingTask {
  number: number;
  status: string;
  preview: string;
  ownerName: string;
  reopened?: boolean;
}

export interface JoinBriefingInput {
  channelName: string;
  channelDescription: string;
  /** 入群 / 已消费水位：该 seq 及更早的历史不注入。 */
  watermarkSeq: number;
  /** 本轮窗口最后一条 seq（没有新消息时等于 watermarkSeq）。 */
  windowSeq: number;
  tasks: readonly JoinBriefingTask[];
}

export interface JoinBriefing {
  lines: string[];
  watermarkSeq: number;
}

const DESCRIPTION_CAP = 400;

export function buildJoinBriefing(input: JoinBriefingInput): JoinBriefing {
  const description = input.channelDescription.trim();
  const lines: string[] = [
    "Channel briefing (bounded; pre-join history is not injected):",
    `- channel: #${input.channelName}`,
    `- description: ${description ? clampText(description, DESCRIPTION_CAP) : "(none)"}`,
    `- watermark: you start after seq ${input.watermarkSeq}; earlier messages are searchable by id or the search op, not injected here.`,
    `- this window ends at seq ${input.windowSeq}.`,
  ];

  const shownTasks = input.tasks.slice(0, INJECTION_TASK_WINDOW);
  if (shownTasks.length > 0) {
    lines.push("- open tasks (informational; claiming still requires an explicit task op):");
    for (const task of shownTasks) {
      const reopened = task.reopened ? " — REOPENED" : "";
      lines.push(
        `  - task #${task.number} [${task.status}] "${task.preview}" (owner: ${task.ownerName})${reopened}`,
      );
    }
    const dropped = input.tasks.length - shownTasks.length;
    if (dropped > 0) {
      lines.push(`  - (${dropped} more open task(s) are not in this briefing; use the search op)`);
    }
  }

  return {
    lines: clampLines(lines, INJECTION_BRIEFING_CHARS),
    watermarkSeq: input.watermarkSeq,
  };
}
