import type { TaskStatus } from "./data/types";

/** 引导卡两种形态；null 表示当前没有需要引导的动作。 */
export type JourneyGuideKind = "describe" | "review";

/** 推导输入只取频道已有数据：顶层消息数与任务快照状态。 */
export interface JourneyInput {
  messageCount: number;
  tasks: ReadonlyArray<{ status: TaskStatus }>;
}

export interface JourneyState {
  guideKind: JourneyGuideKind | null;
  /** Tasks Tab badge：未完成（todo / in_progress）与待复核（in_review）。 */
  openTaskCount: number;
}

/**
 * 按频道状态推导当前该给哪张引导卡（不再推导旅程步数）：
 * 无消息 → describe；任一 in_review → review；
 * 其余（有消息无任务、只有 todo / in_progress，或全部 done/closed）→ null——
 * 待办与进行中都不再产出交接卡。
 */
export function deriveJourneyState(input: JourneyInput): JourneyState {
  const hasMessages = input.messageCount > 0;
  const hasInReview = input.tasks.some((task) => task.status === "in_review");
  const openTaskCount = input.tasks.filter(
    (task) =>
      task.status === "todo" ||
      task.status === "in_progress" ||
      task.status === "in_review",
  ).length;

  let guideKind: JourneyGuideKind | null;
  if (!hasMessages) {
    guideKind = "describe";
  } else if (hasInReview) {
    guideKind = "review";
  } else {
    guideKind = null;
  }

  return {
    guideKind,
    openTaskCount,
  };
}
