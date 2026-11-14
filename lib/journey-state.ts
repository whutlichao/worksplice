import type { TaskStatus } from "./data/types";

/**
 * Tasks Tab badge 的未完成计数——本模块现在只承担这一项语义。
 *
 * 未完成 = `todo` + `in_progress` + `in_review`；`done` / `closed` 不计入。
 * 引导卡（描述 / 复核）已整体删除（票 journey-guide-removal），这里不再推导
 * 任何卡面形态，也不再消费消息数。
 */
export function countOpenTasks(
  tasks: ReadonlyArray<{ status: TaskStatus }>,
): number {
  return tasks.filter(
    (task) =>
      task.status === "todo" ||
      task.status === "in_progress" ||
      task.status === "in_review",
  ).length;
}
