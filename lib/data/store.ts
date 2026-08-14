/**
 * raft 数据契约（Ticket 03 Separate Data Layer）。
 *
 * `Store` 是业务模块（lib/raft/*、lib/agent-loop/*）唯一依赖的数据抽象面：
 * 一个持久化（SQLiteAdapter）或预留的内存（InMemoryAdapter）后盾都能实现它。
 * 业务代码经由 `lib/raft/db-singleton.ts` 的 `getDb(): Store` 获取实例，不直接引用
 * 具体 adapter 模块——消除对 better-sqlite3 的直接耦合。
 */
import type { DataPaths } from "./dirs.ts";
import type {
  AppendMessageInput,
  AttachmentRow,
  ChannelMemberRow,
  ChannelMuteRow,
  ChannelRow,
  ChannelType,
  InsertMessageInput,
  MemberRole,
  MemberRow,
  MemberStatus,
  MemberType,
  MessageRow,
  PinnedMessageRow,
  ReactionRow,
  ReminderLogEvent,
  ReminderLogRow,
  ReminderRow,
  ReminderStatus,
  RoundLogRow,
  SearchResult,
  TaskRow,
  TaskStatus,
} from "./types.ts";

export interface Store {
  /** 数据目录解析结果（家目录/附件目录等；== 纯配置，非 SQL 状态）。 */
  readonly paths: DataPaths;

  close(): void;

  /** 同进程串行事务：fn 抛错则整体回滚（SQLite 语义；内存实现需自行保证）。 */
  withTransaction<T>(fn: () => T): T;

  // -- freshness / 房间版本（§6.3） -----------------------------------------
  /** 该 target 的 max(seq)（0 = 尚无消息）。 */
  maxSeq(targetId: string): number;

  // -- channels -------------------------------------------------------------
  listChannels(): ChannelRow[];
  getChannel(id: string): ChannelRow | undefined;
  insertChannel(input: {
    id?: string;
    name: string;
    type?: ChannelType;
    description?: string;
    createdAt?: string;
  }): ChannelRow;
  setChannelArchived(id: string, archived: number): void;
  listChannelMembers(channelId: string): ChannelMemberRow[];
  isChannelMember(channelId: string, memberId: string): boolean;
  addChannelMember(channelId: string, memberId: string): void;
  removeChannelMember(channelId: string, memberId: string): void;

  // -- messages -------------------------------------------------------------
  listMessagesBefore(targetId: string, beforeSeq: number | undefined, limit: number): MessageRow[];
  hasMessagesBefore(targetId: string, seq: number): boolean;
  threadReplyCount(messageId: string): number;
  threadReplyCounts(messageIds: string[]): Map<string, number>;
  listMessagesAfter(targetId: string, afterSeq: number): MessageRow[];
  listMessages(targetId: string): MessageRow[];
  getMessage(id: string): MessageRow | undefined;
  insertMessageAt(input: InsertMessageInput): MessageRow;
  appendMessage(input: AppendMessageInput): MessageRow;
  searchMessages(query: string, limit?: number): SearchResult[];
  countThreadMessagesByAuthor(anchorId: string, authorId: string): number;
  getLatestMessage(targetId: string): MessageRow | undefined;
  listMessagesByAuthor(authorId: string, limit?: number): MessageRow[];
  hasMessage(targetId: string, authorId: string, content: string): boolean;
  hasMessageByContentByOther(targetId: string, authorId: string, content: string): boolean;

  // -- members --------------------------------------------------------------
  listMembers(): MemberRow[];
  listMembersIncludingDeleted(): MemberRow[];
  getMember(id: string): MemberRow | undefined;
  getMemberByName(name: string): MemberRow | undefined;
  insertMember(input: {
    id?: string;
    type: MemberType;
    name: string;
    description?: string;
    role?: MemberRole;
    workspacePath?: string | null;
    piSessionFile?: string | null;
    status?: MemberStatus;
    modelProvider?: string | null;
    modelId?: string | null;
    thinkingLevel?: string | null;
    createdAt?: string;
  }): MemberRow;
  updateMemberStatus(id: string, status: MemberStatus): void;
  setMemberWorkspace(id: string, workspacePath: string, piSessionFile: string): void;
  updateMemberWorkspace(id: string, workspacePath: string): void;
  setMemberPiSessionFile(id: string, piSessionFile: string | null): void;
  setMemberModel(
    id: string,
    input: {
      modelProvider?: string | null;
      modelId?: string | null;
      thinkingLevel?: string | null;
    },
  ): void;
  setMemberDeleted(id: string, deleted: number): void;
  clearTaskOwners(memberId: string): void;
  clearConsumedSeqsForAgent(agentId: string): void;
  removeMemberFromAllChannels(memberId: string): void;

  // -- tasks ----------------------------------------------------------------
  insertTask(input: {
    id?: string;
    messageId: string;
    number: number;
    status?: TaskStatus;
    ownerId?: string | null;
    reopened?: number;
    updatedAt?: string;
  }): TaskRow;
  listTasks(): TaskRow[];
  listChannelTasks(channelId: string): TaskRow[];
  getTaskById(id: string): TaskRow | undefined;
  getTaskByMessageId(messageId: string): TaskRow | undefined;
  getTaskByChannelNumber(channelId: string, number: number): TaskRow | undefined;
  nextTaskNumber(channelId: string): number;
  updateTask(
    id: string,
    input: { status?: TaskStatus; ownerId?: string | null; reopened?: number; updatedAt?: string },
  ): TaskRow | undefined;
  listTasksForAgent(agentId: string): TaskRow[];

  // -- reminders ------------------------------------------------------------
  insertReminder(input: {
    id?: string;
    title: string;
    fireAt: string;
    recurrence?: string | null;
    targetId?: string | null;
    authorId: string;
    status?: ReminderStatus;
    createdAt?: string;
  }): ReminderRow;
  listReminders(): ReminderRow[];
  getReminderById(id: string): ReminderRow | undefined;
  listRemindersByAuthor(authorId: string): ReminderRow[];
  listRemindersForTarget(targetId: string): ReminderRow[];
  updateReminder(
    id: string,
    input: {
      title?: string;
      fireAt?: string;
      recurrence?: string | null;
      targetId?: string | null;
      status?: ReminderStatus;
    },
  ): ReminderRow | undefined;
  insertReminderLog(input: {
    id?: string;
    reminderId: string;
    event: ReminderLogEvent;
    detail?: string;
    createdAt?: string;
  }): ReminderLogRow;
  listReminderLogs(reminderId: string): ReminderLogRow[];

  // -- round logs（§07 可观测性） ------------------------------------------
  insertRoundLog(input: {
    id?: string;
    agentId: string;
    targetId: string;
    status: RoundLogRow["status"];
    reason?: string;
    baseSeq?: number;
    createdAt?: string;
  }): RoundLogRow;
  listRoundLogs(agentId: string, limit?: number): RoundLogRow[];
  listRoundLogsByTarget(targetId: string): RoundLogRow[];
  pruneRoundLogs(agentId: string, retain: number): void;

  // -- reactions ------------------------------------------------------------
  insertReaction(input: {
    id?: string;
    messageId: string;
    memberId: string;
    emoji: string;
    createdAt?: string;
  }): ReactionRow;
  listReactions(messageId: string): ReactionRow[];
  hasReaction(messageId: string, memberId: string, emoji: string): boolean;
  deleteReaction(messageId: string, memberId: string, emoji: string): boolean;

  // -- attachments ----------------------------------------------------------
  insertAttachment(input: {
    id?: string;
    messageId: string;
    fileName: string;
    mime?: string;
    sizeBytes?: number;
    diskPath: string;
    createdAt?: string;
  }): AttachmentRow;
  listAttachments(messageId: string): AttachmentRow[];
  getAttachment(id: string): AttachmentRow | undefined;

  // -- pinned（§3.5） ------------------------------------------------------
  insertPinnedMessage(input: {
    id?: string;
    channelId: string;
    messageId: string;
    memberId: string;
    order?: number;
    pinnedAt?: string;
  }): PinnedMessageRow;
  listPinnedMessages(channelId: string, memberId: string): PinnedMessageRow[];
  getPinnedMessage(channelId: string, messageId: string, memberId: string): PinnedMessageRow | undefined;
  deletePinnedMessage(channelId: string, messageId: string, memberId: string): boolean;
  setPinnedOrder(channelId: string, memberId: string, orderedMessageIds: string[]): void;

  // -- consumed_seqs（inbox 游标） ------------------------------------------
  getConsumedSeq(agentId: string, targetId: string): number;
  setConsumedSeq(agentId: string, targetId: string, seq: number): void;

  // -- 未读角标（§BAI-6 reads） ---------------------------------------------
  getChannelReadSeq(memberId: string, channelId: string): number;
  setChannelReadSeq(memberId: string, channelId: string, seq: number): void;
  countUnreadChannelMessages(memberId: string, channelId: string): number;

  // -- channel 级 mute（§3.2） ----------------------------------------------
  setChannelMute(channelId: string, memberId: string, muteFromSeq: number, muteRowid: number): void;
  /** 静音时刻的全局插入点 = 当时的 max(messages.rowid)（0 = 尚无任何消息）。 */
  maxMessageRowid(): number;
  clearChannelMute(channelId: string, memberId: string): boolean;
  getChannelMute(channelId: string, memberId: string): ChannelMuteRow | undefined;
  listChannelMutes(channelId: string): ChannelMuteRow[];
}
