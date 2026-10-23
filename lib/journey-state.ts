import type { TaskStatus } from "./data/types";

/** 旅程条四步：描述 → 交接 → 让它跑 → 复核。 */
export type JourneyStep = 1 | 2 | 3 | 4;

/** 引导卡四种形态；null 表示当前没有需要引导的动作（任务全部完成/关闭）。 */
export type JourneyGuideKind = "describe" | "handoff" | "running" | "review";

/** 推导输入只取频道已有数据：顶层消息数与任务快照状态。 */
export interface JourneyInput {
  messageCount: number;
  tasks: ReadonlyArray<{ status: TaskStatus }>;
}

export interface JourneyState {
  step: JourneyStep;
  guideKind: JourneyGuideKind | null;
  hasTasks: boolean;
  /** Tasks Tab badge：未完成（todo / in_progress）与待复核（in_review）。 */
  openTaskCount: number;
}

/**
 * 按频道状态推导当前旅程步：
 * 无消息 → 1；有消息无任务 → 2；只有待办 → 2（等待交接/认领）；
 * 有进行中 → 3；有待审核 → 4（最高优先）；全部 done/closed → 4。
 *
 * 引导卡与步数分开：全部完成时步数仍是 4，但没有待办动作，所以不给卡。
 */
export function deriveJourneyState(input: JourneyInput): JourneyState {
  const hasMessages = input.messageCount > 0;
  const hasTasks = input.tasks.length > 0;
  const hasOpenTodo = input.tasks.some((task) => task.status === "todo");
  const hasInProgress = input.tasks.some(
    (task) => task.status === "in_progress",
  );
  const hasInReview = input.tasks.some((task) => task.status === "in_review");
  const openTaskCount = input.tasks.filter(
    (task) =>
      task.status === "todo" ||
      task.status === "in_progress" ||
      task.status === "in_review",
  ).length;

  let step: JourneyStep;
  let guideKind: JourneyGuideKind | null;
  if (!hasMessages) {
    step = 1;
    guideKind = "describe";
  } else if (!hasTasks) {
    step = 2;
    guideKind = "handoff";
  } else if (hasInReview) {
    step = 4;
    guideKind = "review";
  } else if (hasInProgress) {
    step = 3;
    guideKind = "running";
  } else if (hasOpenTodo) {
    step = 2;
    guideKind = "handoff";
  } else {
    step = 4;
    guideKind = null;
  }

  return {
    step,
    guideKind,
    hasTasks,
    openTaskCount,
  };
}
