import { getDb } from "../../data/db-singleton.ts";
import { getChannel, resolveChannelForTarget } from "./channels.ts";
import { getMember } from "./members.ts";
import { previewLine } from "../../preview.ts";
import { listChannelTasks, type TaskView } from "./tasks.ts";
import type { TaskRow } from "../../data/types.ts";

/**
 * 任务历史（spec §6.5）：该 agent 参与的任务 + 状态变更时间线。
 * 直接查 messages / tasks，无需额外表：
 * - 参与判定：认领过（owner）或创建了（锚点消息作者）或在其任务 thread 里发过进展；
 * - 时间线 = 该 agent 的消息（标注归属 channel/任务 thread）+ 任务状态点
 *   （任务当前状态 + updated_at，作为"最近一次变更"的时间锚点）。
 */

export interface AgentTaskView extends TaskView {
  /** 该 agent 在该任务 thread 里发的进展消息数（任务卡片副信息）。 */
  progressCount: number;
}

export type TimelineEntry =
  | {
      kind: "message";
      id: string;
      at: string;
      targetId: string;
      channelId: string;
      channelName: string;
      /** 顶层消息 = null；thread 消息 = 锚点消息 id。 */
      anchorId: string | null;
      inTaskThread: boolean;
      taskNumber: number | null;
      seq: number;
      content: string;
    }
  | {
      kind: "task";
      id: string;
      at: string;
      taskId: string;
      channelId: string;
      channelName: string;
      number: number;
      status: TaskRow["status"];
      ownerName: string | null;
      title: string;
    };

function channelNameOf(targetId: string): { channelId: string; channelName: string } | null {
  const channel = resolveChannelForTarget(targetId);
  if (!channel) return null;
  return { channelId: channel.id, channelName: channel.name };
}

/**
 * 该 agent 参与的任务（§6.5）：owner / 锚点作者 / thread 进展者任一命中。
 * 按 updated_at 倒序（最近活跃在前）。
 */
export function listAgentTasks(agentId: string): AgentTaskView[] {
  const rows = getDb().listTasksForAgent(agentId);
  const taskIds = new Set(rows.map((t) => t.id));
  // 复用 listChannelTasks 的视图组装（channel/owner/anchor 附料），但避免重复查询：
  // 按 channel 分组拿一次视图即可。
  const channelIds = new Set<string>();
  for (const row of rows) {
    const anchor = getDb().getMessage(row.message_id);
    if (anchor) channelIds.add(anchor.target_id);
  }
  const viewsByChannel = new Map<string, TaskView[]>();
  for (const channelId of channelIds) {
    const channel = getChannel(channelId);
    if (!channel) continue;
    for (const view of listChannelTasks(channelId)) {
      if (taskIds.has(view.id)) {
        const existing = viewsByChannel.get(channelId) ?? [];
        existing.push(view);
        viewsByChannel.set(channelId, existing);
      }
    }
  }

  const byId = new Map<string, TaskView>();
  for (const views of viewsByChannel.values()) {
    for (const view of views) byId.set(view.id, view);
  }

  return rows
    .map((row) => {
      const view = byId.get(row.id);
      if (!view) return null;
      const progressCount = getDb().countThreadMessagesByAuthor(view.anchor.id, agentId);
      return { ...view, progressCount: progressCount };
    })
    .filter((view): view is AgentTaskView => view !== null);
}

/**
 * 时间线（§6.5 状态变更时间线）：该 agent 的全部消息 + 其参与任务的当前状态点，
 * 按时间倒序合并。任务 thread 里的消息标注任务编号（进展可见）。
 */
export function buildAgentTimeline(agentId: string, limit = 100): TimelineEntry[] {
  const messages = getDb().listMessagesByAuthor(agentId, limit * 2);
  const taskRows = getDb().listTasksForAgent(agentId);
  const tasksByAnchorId = new Map<string, TaskRow>();
  const tasksById = new Map<string, TaskRow>();
  for (const task of taskRows) {
    tasksByAnchorId.set(task.message_id, task);
    tasksById.set(task.id, task);
  }

  const entries: TimelineEntry[] = [];

  for (const message of messages) {
    const container = channelNameOf(message.target_id);
    if (!container) continue;
    // thread 消息：target_id = 锚点消息 id；顶层消息：target_id = channel id。
    const anchorId = container.channelId === message.target_id ? null : message.target_id;
    const task = anchorId ? tasksByAnchorId.get(anchorId) : undefined;
    entries.push({
      kind: "message",
      id: message.id,
      at: message.created_at,
      targetId: message.target_id,
      channelId: container.channelId,
      channelName: container.channelName,
      anchorId,
      inTaskThread: task !== undefined,
      taskNumber: task?.number ?? null,
      seq: message.seq,
      content: previewLine(message.content, 90),
    });
  }

  for (const task of taskRows) {
    const anchor = getDb().getMessage(task.message_id);
    if (!anchor) continue;
    const container = channelNameOf(anchor.target_id);
    if (!container) continue;
    const owner = task.owner_id ? (getMember(task.owner_id) ?? null) : null;
    entries.push({
      kind: "task",
      id: `task-${task.id}`,
      at: task.updated_at,
      taskId: task.id,
      channelId: container.channelId,
      channelName: container.channelName,
      number: task.number,
      status: task.status,
      ownerName: owner?.name ?? null,
      title: previewLine(anchor.content, 60),
    });
  }

  return entries
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, limit);
}
