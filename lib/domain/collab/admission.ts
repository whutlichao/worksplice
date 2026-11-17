import type {
  AdmissionRole,
  ChannelType,
  MemberType,
  TaskStatus,
} from "../../data/types.ts";
import { hasAllMention } from "../../mention.ts";
import {
  parseTaskCreationEventNumber,
  type MessageInvitations,
} from "./invitations.ts";
import type { WakeReason } from "./wake.ts";

/**
 * `AdmissionRole`（本轮**怎么进来的**）的取值定义在数据层词表（`lib/data/types.ts`）：
 * 它同时是 `round_logs.role` 的持久化取值（#249）。这里只转出具名类型，判定层与
 * 可观测面用的是同一个名字、同一份取值。
 */
export type { AdmissionRole };

/**
 * 模型调用前的轮次准入（Ticket #237）：纯判定层。
 *
 * 调用方在 drain 之后、startSession / prompt 之前把现场快照交进来；本模块只回答
 * 「这一轮该不该起会话 / 起谁」，不读写数据库、不发 wake、不动游标。
 * 未准入的 reason 是稳定契约（测试与可观测直接断言字符串）。
 */
export const ROUND_SKIP_REASONS = {
  noInvitation: "no human mention and no attributable task",
  notMember: "not a member of the channel",
  taskOwnerOnly: "task in progress — only its owner may continue",
  taskReviewerNotInvited:
    "task in review — reviewers require a human or task-owner mention",
  taskUnclaimed: "task is unclaimed — no automatic round",
  taskDoneOrClosed: "task is done or closed — no automatic round",
  taskReopened: "task was reopened — awaiting the human owner",
  taskEventHandoffOnly:
    "task event — only the secretary handles unclaimed tasks",
  handoffNotTriggered:
    "no unique unclaimed task is associated with this round",
} as const;

export type RoundSkipReason =
  (typeof ROUND_SKIP_REASONS)[keyof typeof ROUND_SKIP_REASONS];

export type RoundAdmission =
  | { admit: true; role: AdmissionRole; useRoomGate: boolean }
  | { admit: false; reason: RoundSkipReason };

export interface AdmissionTaskSnapshot {
  status: TaskStatus;
  ownerId: string | null;
  reopened: number;
}

export interface RoundAdmissionInput {
  agentId: string;
  isDM: boolean;
  isMember: boolean;
  isTaskThread: boolean;
  task: AdmissionTaskSnapshot | null;
  reason: WakeReason;
  continuing: boolean;
  /** 当轮 incoming 里是否有任何人类正文个人点名了本 agent。 */
  humanMentioned: boolean;
  /** 当轮 incoming 里是否有任何人类正文出现 @all / @everyone。 */
  humanAllMentioned: boolean;
  /**
   * 任务 owner 是本频道的 agent，且本轮 drain 里最新一条 owner 消息点名了当前 agent。
   * 这是互审的注意力信号，不是 must-respond：只放开 `in_review` 的模型调用准入。
   * owner 的收束语 / 签退消息不计入（由 loop 的 `isPeerCloseText` 判据排除）。
   */
  taskOwnerMentioned: boolean;
  /** 当轮 incoming 里是否有对本 actor 可行动的 Owner `Task #N created` 事件。 */
  hasActionableTaskEvent: boolean;
  /**
   * 本成员是否就是接住本轮人类消息的生效首席（#248）：人类正文无个人点名、无 `@all`、
   * 不涉及任务（含不涉及任务 handoff）且首席在本频道可用时才为 true。
   * 它把「以首席身份进来」与「被人点名」分开——涉及任务的消息仍走 secretary-handoff。
   */
  chiefInvited: boolean;
  /** 本成员是否就是该频道此刻的生效首席（频道首席 → 全局回落 → 无）。 */
  isEffectiveChief: boolean;
  /** 生效首席本轮是否被一个唯一的未认领任务明确关联（创建事件 / 任务线程 / 唯一引用）。 */
  secretaryHandoff: boolean;
  /** 本成员是否当前任务状态权威（人类 Owner 或当前全局首席）。 */
  canChangeTaskStatus?: boolean;
  /**
   * 任务创建事件旁边的人类任务锚点是否明确点名了本 agent / @all。
   * 这是「人类已经直接叫人」的信号，不是事件预览里的 @；用于保留显式邀请。
   */
  taskEventAnchorInvited: boolean;
}

export function decideRoundAdmission(input: RoundAdmissionInput): RoundAdmission {
  if (input.reason === "reminder") {
    return { admit: true, role: "reminder", useRoomGate: false };
  }
  if (input.isDM) {
    return { admit: true, role: "dm", useRoomGate: false };
  }
  // 成员关系先于任务 owner 身份：退群 / 被移出后，旧任务 wake hint 与续工
  // 不得把成员重新拉起。唯一穿透口仍是本轮人类正文的个人点名（不含 @all）。
  if (!input.isMember && !input.humanMentioned) {
    return { admit: false, reason: ROUND_SKIP_REASONS.notMember };
  }

  if (input.isTaskThread && input.task) {
    const task = input.task;
    if (isReopenedTask(task)) {
      if (
        input.canChangeTaskStatus &&
        (input.reason === "task-status" ||
          input.humanMentioned ||
          input.humanAllMentioned)
      ) {
        return {
          admit: true,
          role:
            input.reason === "task-status"
              ? "task-reviewer"
              : input.humanMentioned
                ? "human-mention"
                : "all-mention",
          useRoomGate: false,
        };
      }
      return { admit: false, reason: ROUND_SKIP_REASONS.taskReopened };
    }
    const owner = task.ownerId === input.agentId;
    switch (task.status) {
      case "in_progress":
        if (input.reason === "task-status" && input.canChangeTaskStatus) {
          return {
            admit: true,
            // 复用既有任务互审角色：全局首席在 in_progress 线程收口完成请求，
            // 不动 round_logs.role 的 schema CHECK（不新增数据库 schema）。
            role: "task-reviewer",
            useRoomGate: false,
          };
        }
        return owner
          ? { admit: true, role: "task-owner", useRoomGate: false }
          : { admit: false, reason: ROUND_SKIP_REASONS.taskOwnerOnly };
      case "in_review":
        if (owner) return { admit: true, role: "task-owner", useRoomGate: false };
        return input.humanMentioned ||
          input.humanAllMentioned ||
          input.taskOwnerMentioned
          ? { admit: true, role: "task-reviewer", useRoomGate: false }
          : { admit: false, reason: ROUND_SKIP_REASONS.taskReviewerNotInvited };
      case "done":
      case "closed":
        return input.humanMentioned || input.humanAllMentioned
          ? { admit: true, role: "human-mention", useRoomGate: false }
          : { admit: false, reason: ROUND_SKIP_REASONS.taskDoneOrClosed };
      case "todo":
        if (input.secretaryHandoff) {
          return { admit: true, role: "secretary-handoff", useRoomGate: false };
        }
        return input.humanMentioned || input.humanAllMentioned
          ? { admit: true, role: "human-mention", useRoomGate: false }
          : { admit: false, reason: ROUND_SKIP_REASONS.taskUnclaimed };
    }
  }
  if (input.continuing) {
    return { admit: true, role: "task-owner", useRoomGate: false };
  }

  if (input.humanAllMentioned) {
    return { admit: true, role: "all-mention", useRoomGate: true };
  }
  if (input.humanMentioned) {
    return { admit: true, role: "human-mention", useRoomGate: true };
  }
  // #248：没点名、没 @all、不涉及任务时，生效首席接住这条消息——优先级低于人类直接点名，
  // 高于 handoff / 任务事件；首席同样走房间门（受预算与 Stop 约束）。
  if (input.chiefInvited) {
    return { admit: true, role: "chief", useRoomGate: true };
  }
  if (input.secretaryHandoff) {
    return { admit: true, role: "secretary-handoff", useRoomGate: false };
  }
  if (input.hasActionableTaskEvent) {
    if (input.taskEventAnchorInvited) {
      return { admit: true, role: "task-event", useRoomGate: false };
    }
    return {
      admit: false,
      reason: input.isEffectiveChief || input.canChangeTaskStatus
        ? ROUND_SKIP_REASONS.handoffNotTriggered
        : ROUND_SKIP_REASONS.taskEventHandoffOnly,
    };
  }
  return { admit: false, reason: ROUND_SKIP_REASONS.noInvitation };
}

// ---------------------------------------------------------------------------
// 任务事件可行动性（票 #276）
// ---------------------------------------------------------------------------

/** 可行动性的最小任务快照：状态与重开标记是仅有的两个判据。 */
export interface TaskActionabilitySnapshot {
  status: TaskStatus;
  reopened: number;
}

/**
 * 任务是否带「重开待接管」标记（`reopened`）。
 *
 * 状态机只在 `done` / `closed` → `todo` 的重开转移上置这个标记，人类认领即清除
 * （`lib/domain/collab/tasks.ts`）。这里只回答标记本身；「对谁可行动」由
 * `isTaskActionableForActor` 组合状态与 actor 回答。
 */
export function isReopenedTask(
  task: TaskActionabilitySnapshot | null | undefined,
): boolean {
  return Boolean(task && task.reopened === 1);
}

/**
 * 一条任务此刻对**这个 actor** 是否可行动（票 #276 的单一定义处）。
 *
 * 它回答的不是「任务还 open 吗」：
 * - `done` / `closed` 对任何人都不可行动；
 * - `reopened` 的 `todo` 只对**人类**可行动——人类可以认领接管，agent 必须让路、
 *   不在 channel 回复（`docs/spec.md` §3.7）；
 * - 其余未结束状态对 agent 也可行动。
 *
 * handoff 的额外门槛（未认领、从未分流）不在这里：那是「谁来接」的收窄，
 * 不是「对谁能行动」的判据，由 `isHandoffEligibleTask` 在本判据之上组合。
 */
export function isTaskActionableForActor(
  task: TaskActionabilitySnapshot | null | undefined,
  actor: MemberType,
): boolean {
  if (!task) return false;
  if (task.status === "done" || task.status === "closed") return false;
  if (isReopenedTask(task)) return actor === "human";
  return true;
}

/**
 * 任务是否对**至少一个** actor 仍可行动（人类是 agent 的超集）。
 *
 * 这是 `isTaskActionableForActor` 的派生问法，只用于 actor 不在问题里的两处：
 * - 窗口停窗边界：窗口里有没有值得一提的任务事件（reopened 事件对人类可行动 ⇒ 仍停窗，
 *   保持既有窗口长度与时序，随后由准入以 `taskReopened` 让路）；
 * - 任务线程投递目标：这条任务是否还存在、回复该不该投进它的线程（reopened 仍投线程，
 *   由 claim `blocked` 让路，绝不落回 channel）。
 *
 * 它不是「任务还 open」的同义词，也不回答「当前 agent 能不能做」。
 */
export function isTaskActionableForSomeActor(
  task: TaskActionabilitySnapshot | null | undefined,
): boolean {
  return isTaskActionableForActor(task, "human");
}

// ---------------------------------------------------------------------------
// 窗口级「叫谁、以什么角色进来」（票 #276）
// ---------------------------------------------------------------------------

/** 窗口判定需要的最小消息形状（`MessageWithAuthor` 的结构子集）。 */
export interface RoundWindowMessage {
  id: string;
  target_id: string;
  author_id: string;
  content: string;
  author?: { type?: MemberType } | null;
}

/** 窗口判定需要的最小任务形状。 */
export interface RoundWindowTask {
  id: string;
  message_id: string;
  status: TaskStatus;
  owner_id: string | null;
  reopened: number;
}

/** 窗口判定需要的最小频道形状。 */
export interface RoundWindowChannel {
  id: string;
  type: ChannelType;
}

/** 窗口判定需要的最小成员形状。 */
export interface RoundWindowMember {
  id: string;
  type: MemberType;
  deleted?: number;
}

/**
 * 窗口判定的读取面：判定层不直接读写数据库，全部事实经此注入。
 * 生产实现由 `wake.ts` 的 `createRoundWindowDirectory()` 提供；测试给纯假实现。
 */
export interface RoundWindowDirectory {
  /** 正文 → 被个人点名的成员 id（与 @mention 解析同一份）。 */
  mentionsOf(content: string): string[];
  memberOf(memberId: string): RoundWindowMember | undefined;
  isChannelMember(channelId: string, memberId: string): boolean;
  taskByChannelNumber(
    channelId: string,
    taskNumber: number,
  ): RoundWindowTask | undefined;
  /** 生效首席对一条人类消息的默认收件人（`selectChiefRecipient` 的唯一实现）。 */
  chiefRecipientOf(input: {
    channel: RoundWindowChannel;
    targetId: string;
    content: string;
  }): string | null;
}

export interface RoundWindowActor {
  id: string;
  type: MemberType;
  isMember: boolean;
}

/**
 * 一轮 drain 窗口交给 `decideRoundAdmission` 的六个现场判据（票 #276）。
 * 这里只回答「对**这个 actor**」，不回答「这个任务该派给谁」。
 */
export interface RoundWindowSignals {
  /** 最新一条人类消息（非任务创建事件）个人点名了本 actor。 */
  humanMentioned: boolean;
  /** 窗口内有人类非事件消息出现 `@all` / `@everyone`。 */
  humanAllMentioned: boolean;
  /** 任务 owner 是本频道 agent，且最新一条 owner 消息点名了本 actor（in_review 互审）。 */
  taskOwnerMentioned: boolean;
  /** 窗口内存在对本 actor 可行动的 Owner 任务创建事件。 */
  hasActionableTaskEvent: boolean;
  /** 最新任务事件的锚点在同一窗口里，且直接点名了本 actor / `@all`。 */
  taskEventAnchorInvited: boolean;
  /** 最新一条人类消息的默认收件人就是本 actor。 */
  chiefInvited: boolean;
}

/**
 * 窗口里是否有「人类非任务事件消息」发出的 `@all` / `@everyone`。
 * 任务创建事件的预览即使带 @ 也不算人类邀请；与准入信号同一份判据。
 */
export function hasHumanAllMentionInWindow(
  messages: ReadonlyArray<{
    content: string;
    author?: { type?: MemberType } | null;
  }>,
): boolean {
  return messages.some(
    (message) =>
      message.author?.type === "human" &&
      parseTaskCreationEventNumber(message.content) === null &&
      hasAllMention(message.content),
  );
}

/**
 * 窗口级准入信号的单一定义处（票 #276）：把原先散在 `loop.ts` 的六个现场
 * `const` 收成一次纯判定。窗口长度、时序、mute 口径与房间门都不在这里改。
 *
 * 「窗口」与「单条」只在最新人类消息、跨作者 owner 消息与任务事件扫描范围上
 * 不同——这些是窗口语义本身，不是重复；窗口长度 1 时 `messages: [message]`
 * 即可得到单条结论。候选由 `selectMessageInvitations` 单点给出；wake 在其上
 * 用 `messageWindowRecipients` 补 handoff 首席，beginTurn 只取房间第一波候选。
 */
export function selectRoundWindowSignals(input: {
  messages: RoundWindowMessage[];
  channel: RoundWindowChannel;
  targetId: string;
  task: RoundWindowTask | null;
  actor: RoundWindowActor;
  directory: RoundWindowDirectory;
  /**
   * 收束语判据（loop 的 `isPeerCloseText`）。只有跨作者窗口需要它；
   * 单条人类消息窗口不会出现 owner 的 agent 消息，缺省即安全。
   */
  isPeerCloseText?: (content: string) => boolean;
}): RoundWindowSignals {
  const { messages, channel, targetId, task, actor, directory } = input;
  const humanMessages = messages.filter(
    (message) => message.author?.type === "human",
  );
  const latestHuman = humanMessages.at(-1);
  const latestHumanIsTaskEvent = Boolean(
    latestHuman && parseTaskCreationEventNumber(latestHuman.content) !== null,
  );
  const humanMentioned = Boolean(
    latestHuman &&
      !latestHumanIsTaskEvent &&
      directory.mentionsOf(latestHuman.content).includes(actor.id),
  );
  // 最新一条人类消息若是任务创建事件，事件本身不继承此前正文的 @all；
  // 否则窗口内的 @all 不能被后续无点名正文覆盖。
  const humanAllMentioned =
    !latestHumanIsTaskEvent &&
    hasHumanAllMentionInWindow(messages);
  // 互审触达：只认任务 owner 是 agent、本 actor 是频道成员，且最新一条
  // owner 消息点名了本 actor。owner 的收束语 / 签退不算新邀请。
  const taskOwnerId = task?.owner_id ?? null;
  const taskOwnerMember =
    taskOwnerId === null ? undefined : directory.memberOf(taskOwnerId);
  const latestTaskOwnerMessage =
    taskOwnerId === null
      ? undefined
      : [...messages]
          .reverse()
          .find((message) => message.author_id === taskOwnerId);
  const isPeerCloseText = input.isPeerCloseText ?? (() => false);
  const taskOwnerMentioned = Boolean(
    actor.isMember &&
      task &&
      task.status === "in_review" &&
      task.owner_id !== actor.id &&
      taskOwnerMember?.type === "agent" &&
      taskOwnerMember.deleted !== 1 &&
      directory.isChannelMember(channel.id, taskOwnerMember.id) &&
      latestTaskOwnerMessage &&
      directory.mentionsOf(latestTaskOwnerMessage.content).includes(actor.id) &&
      !isPeerCloseText(latestTaskOwnerMessage.content),
  );
  // 任务创建事件是系统消息：预览里即使带 @ 也不产生人类邀请；
  // 是否可行动由 actor-relative 的判定回答（reopened 对 agent 不开放）。
  const hasActionableTaskEvent =
    targetId === channel.id &&
    messages.some((message) => {
      if (message.author?.type !== "human") return false;
      const taskNumber = parseTaskCreationEventNumber(message.content);
      if (taskNumber === null) return false;
      const eventTask = directory.taskByChannelNumber(channel.id, taskNumber);
      return isTaskActionableForActor(eventTask, actor.type);
    });
  // 人类在任务锚点上已经直接点名本 actor / @all：这是显式邀请，不是事件预览里的 @。
  // 任务事件本身仍只叫生效首席；只有「同一窗口里能看到这个锚点」时才沿用直接邀请。
  const latestTaskEvent =
    targetId === channel.id
      ? [...messages]
          .reverse()
          .find(
            (message) =>
              message.author?.type === "human" &&
              parseTaskCreationEventNumber(message.content) !== null,
          )
      : undefined;
  const taskEventAnchorInvited = (() => {
    if (!latestTaskEvent) return false;
    const taskNumber = parseTaskCreationEventNumber(latestTaskEvent.content);
    if (taskNumber === null) return false;
    const eventTask = directory.taskByChannelNumber(channel.id, taskNumber);
    if (!eventTask) return false;
    const anchor = messages.find(
      (message) => message.id === eventTask.message_id,
    );
    if (!anchor || anchor.author?.type !== "human") return false;
    return (
      directory.mentionsOf(anchor.content).includes(actor.id) ||
      hasAllMention(anchor.content)
    );
  })();
  // 默认收件人只认最新一条人类消息；涉及任务的消息在 selectChiefRecipient
  // 里已被排除（任务引用 / 任务线程 / 任务锚点），不会被这里叫错人。
  const chiefInvited = Boolean(
    latestHuman &&
      directory.chiefRecipientOf({
        channel,
        targetId,
        content: latestHuman.content,
      }) === actor.id,
  );

  return {
    humanMentioned,
    humanAllMentioned,
    taskOwnerMentioned,
    hasActionableTaskEvent,
    taskEventAnchorInvited,
    chiefInvited,
  };
}

/**
 * 单条消息（窗口长度 1）的唤醒候选结论：wake 使用。
 *
 * 候选的唯一来源是 `selectMessageInvitations`（单条邀请的唯一实现，beginTurn
 * 直接消费）；这里只补上唤醒结论的第二半——handoff 首席只进唤醒，不进房间第一波。准入信号由
 * `selectRoundWindowSignals({ messages: [message] })` 回答；等价性用例把两者对同一
 * 消息、同一 actor 集合的结论对齐，避免两套判据静默漂移。
 */
export interface MessageWindowRecipients {
  /** 房间第一波候选（`beginTurn` 用；不含 wake 专属的 handoff 首席）。 */
  candidates: string[];
  /** 唤醒候选（`wake` 用）：房间候选 ∪ 本轮 handoff 首席。 */
  wakeRecipients: string[];
}

export function messageWindowRecipients(input: {
  invitations: MessageInvitations;
  handoffChief?: string | null;
}): MessageWindowRecipients {
  const candidates = [...input.invitations.candidates];
  const wakeRecipients = [...candidates];
  if (input.handoffChief && !wakeRecipients.includes(input.handoffChief)) {
    wakeRecipients.push(input.handoffChief);
  }
  return { candidates, wakeRecipients };
}
