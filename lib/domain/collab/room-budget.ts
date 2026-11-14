import { emitWake } from "./wake.ts";
import { listChannelMembers, resolveChannelForTarget } from "./channels.ts";
import { extractMentionedMemberIds, getMember } from "./members.ts";
import { OWNER_MEMBER_ID } from "../../data/schema.ts";
import { hasAllMention } from "../../mention.ts";
import type { WakeHint } from "./wake.ts";

/**
 * 房间轮次预算（Ticket room-turn-budget；设计记录 `.scratch/room-turn-budget/spec.md`）。
 *
 * 目标：让「多 agent 群聊里结构性不可能无限互相接话」落成代码里的**计数器 / 序号水位线 /
 * 状态机 / 显式取消**，而不是提示词自律（见下方禁止项第 1 条）。
 *
 * 不变量（逐条对应本文件的实现点）：
 * - I1 一条用户消息引发的 bot 发言总数 ≤ MAX_REPLIES —— `TurnState.replies` 跨轮累计；
 * - I2 对话波次 ≤ MAX_ROUNDS —— `TurnState.wave`（已执行波次）+ `pump` 的预算检查；
 * - I3 单成员超过 MEMBER_TIMEOUT_MS 未发言视为未发言、房间继续 —— `releaseTimeouts`（不 await 成员）；
 * - I4 同一条 @ 不二次唤起 / 环在第二轮被切断 —— `candidates()` 的单调水位线比较 + `isBackEdge`；
 * - I5 用户新消息或 Stop 使 epoch 递增，在跑轮次在检查点退出 —— `beginTurn` / `stopTurn` / `isCurrent`
 *   + `lib/agent-loop/loop.ts` 的 CP0/CP2/CP3；
 * - I6 房间回合不得走房间看不见的通道 —— `RoomPrivateChannelForbidden`（`sendMessage` 的 roomContext 守卫）；
 * - I7 迟到回答的补充轮次 ≤ MAX_LATE_TURNS、Stop 之后归零 —— `noteLateReply` + `lateTurns`；
 * - I8 成员不能自助重置预算 —— 预算只挂在房间状态上（`beginTurn` 是唯一重置入口，`@all` 只影响选人）。
 *
 * 禁止项（改本文件前先读，逐条都是硬约束）：
 * 1. 不得用「在提示里要求成员不要多说话」替代计数器——预算只认数字，不认模型自觉；
 * 2. 不得让房间等待一个忙碌成员（会卡住整场）——`noteBusy`/`releaseTimeouts` 立刻释放槽位；
 * 3. 不得让成员在房间回合里使用房间看不见的通道——I6 守卫在唯一消息漏斗上；
 * 4. 不得把 `(pass)` 计入发言预算——`notePass` 只释放槽位、不进 `spoke`、不加 `replies`；
 * 5. 不得在没有「用户新消息」的情况下重置 `lateTurns`——唯一重置点是 `beginTurn`；
 * 6. 不得让同一条 @ 在环里第二次唤起同一成员——水位线比较 + 回边抑制；
 * 7. 不得把上限留给模型判断或外部配置热更新——`limits` 只在 `createRoomTurnStore` 注入一次
 *    （不读环境变量 / 配置文件 / 不热更新），测试据此确定地改小。
 *
 * 现场形态（与原始伪代码的差异，见 `.scratch/room-turn-budget/spec.md`）：本仓是事件驱动架构
 * （wake hint → driver 队列 → `runAgentRound`），**没有**阻塞式 `for` 循环。所以本模块是
 * 「状态机 + 惰性推进」：`beginTurn` 开场、`openWave` 记账选人、`noteReply/notePass/noteBusy`
 * 收口单人、`pump` 在波次结算后推进下一波（或按预算收口）。选人**只在这里发生一次**，
 * `runAgentRound` 入场只问「我是否被这一波选中」（`gate`），不改 wake 的广播口径。
 */

/** 默认上限（默认值即实现；全部可经 `createRoomTurnStore({ limits })` 注入改小）。 */
export const DEFAULT_ROOM_LIMITS = {
  /** I1：一条用户消息引发的 bot 发言总数上限。 */
  MAX_REPLIES: 10,
  /** I2：对话波次上限（0 基波次，含第一波）。 */
  MAX_ROUNDS: 3,
  /** I3：单成员超时（毫秒）；超时视为未发言，房间继续。 */
  MEMBER_TIMEOUT_MS: 600_000,
  /** I7：自用户上一条消息以来的补充轮次上限。 */
  MAX_LATE_TURNS: 3,
  /** 场次转写保留行数（超出丢最老的；丢行只会让候选变少，不会放大预算）。 */
  HISTORY_LINES: 24,
  /** 单行转写保留字符数（超出截断——转写只用于选人裁决，不用于拼 prompt）。 */
  LINE_CHARS: 2000,
  /** 直连链跳数上限（第 MAX_REQUEST_HOPS 跳被拒）。 */
  MAX_REQUEST_HOPS: 8,
  /** 待回信队列全局上限。 */
  MAX_PENDING_MESSAGES: 64,
  /** 待回信队列单发送者上限。 */
  MAX_PENDING_MESSAGES_PER_SENDER: 16,
} as const;

export type RoomLimits = { -readonly [K in keyof typeof DEFAULT_ROOM_LIMITS]: number };

/** 场次收口原因（状态机终态；`endedReason === null` = 场次仍在跑）。 */
export type RoomTurnEndReason =
  /** I2 波次到顶。 */
  | "round_budget"
  /** I1 发言数到顶。 */
  | "reply_budget"
  /** 一波无人发言（含「全员 pass」与「无人被引用」）。 */
  | "no_speakers"
  /** I5 用户新消息 / Stop 之后的在跑场次。 */
  | "superseded"
  /** I5 Stop。 */
  | "stopped"
  /** I7 补充轮次到顶。 */
  | "late_budget";

/** 一次选人记账（审计轨迹；验收断言读它）。 */
export interface AskRecord {
  member: string;
  /** 0 基波次序号（= 记录时的 `TurnState.wave`）。 */
  wave: number;
  /** 被问时展示到的水位线（触发消息 seq / 最近转写水位线）。 */
  shownSeq: number;
  /** 把该成员叫进来的引用者（第一波 / 无引用时为 null）。 */
  citedBy: string | null;
  /** 引用者那条发言的水位线（回边抑制的比较基准）。 */
  citedAtSeq: number | null;
}

/**
 * 房间水位线（序号）口径：**同一房间内单调**。channel 消息用它自己的 seq；
 * 跨 target（任务线程）时由调用方传全局插入序（`MessageRow.rowid`）——thread 有自己的
 * seq 空间，直接混用会把「后插入的线程消息」误判成「更早」。缺省回落 seq。
 */
export type RoomLineKind = "speech" | "pass" | "busy-notice" | "timeout-notice";

/** 场次转写行（只用于选人裁决；有界保留，不拼进 prompt）。 */
export interface RoomLine {
  seq: number;
  order: number;
  author: string;
  kind: RoomLineKind;
  mentions: string[];
  text: string;
}

/** 场次视图（`snapshot` 返回的是拷贝，改它不影响状态机）。 */
export interface RoomTurnView {
  epoch: number;
  /** 触发本条场次的消息 seq（用户消息 / 线程目标内的 seq）。 */
  triggerSeq: number;
  /** 触发消息所在 target（channel id 或 thread 锚点）——补充唤醒回到同一个地方。 */
  triggerTargetId: string;
  /** I1 计数器。 */
  replies: number;
  /** I2 已执行波次。 */
  wave: number;
  /** 成员单调水位线（最后一个「已知」order）。 */
  seen: Map<string, number>;
  /** 被问时展示到的最大 order。 */
  asked: Map<string, number>;
  /** ask 时刻（性能时钟，I3）。 */
  askedAt: Map<string, number>;
  /** 回边抑制的边记账（I4-b）。 */
  citedBy: Map<string, { by: string; atSeq: number }>;
  /** 忙碌 / 超时被释放的成员（I3/I7）。 */
  late: Map<string, { askedAtSeq: number; queuedAt: number }>;
  /** 本波实际发言者（`(pass)` 不入）。 */
  spoke: Set<string>;
  /** 本波已给出结论者（发言 / pass / busy / 超时释放）——波次结算判据。 */
  settled: Set<string>;
  /** 本波被问的成员。 */
  elected: Set<string>;
  /** 本场次已离开房间的成员：迟到回复不计预算、不参与选人、不再被旧 wake hint 拉起。 */
  departed: Set<string>;
  /** 场次已被取代（回复照常落库，但不计预算、不参与选人）。 */
  stale: boolean;
  endedReason: RoomTurnEndReason | null;
  askLog: AskRecord[];
  transcript: RoomLine[];
}

export interface RoomSnapshot {
  channelId: string;
  /** 房间 epoch（I5；`isCurrent` 的比较基准）。 */
  epoch: number;
  running: number | null;
  pendingLateSeq: number | null;
  lateTurns: number;
  /** 最近一场（可能是已收口的场次——迟到回答仍挂在它上面）。 */
  turn: RoomTurnView | null;
  /** 已收口场次的历史（最近在后，最多 8 条；验收断言读它取证 I5）。 */
  turns: RoomTurnView[];
}

export type RoomGateState = "elected" | "not-elected" | "bypass" | "no-turn";

export interface RoomGate {
  state: RoomGateState;
  /** 场次 epoch（`null` = 无活跃场次）；`runAgentRound` 用它做 CP0/CP2/CP3 的 I5 判定。 */
  epoch: number | null;
}

export interface RoomReplyNote {
  counted: boolean;
  stale: boolean;
  late: boolean;
  replies: number;
}

/** Stop 结果：`stopped:false` = 没有活跃场次 / 已停过（幂等 no-op，epoch 不变）。 */
export interface RoomStopResult {
  stopped: boolean;
  epoch: number;
}

/** 房间目录接缝（默认读 SQLite；测试注入纯映射，不碰数据库）。 */
export interface RoomDirectory {
  /** 频道内 agent 成员 id。 */
  channelAgentMembers: (channelId: string) => string[];
  /** 任意 agent 成员（含未入频道的 @mention 穿透）。 */
  isAgent: (memberId: string) => boolean;
  /** 是不是「房间」语义的频道（DM 不是）。 */
  isRoomChannel: (channelId: string) => boolean;
}

export interface RoomTurnStoreOptions {
  limits?: Partial<RoomLimits>;
  /** 可注入时钟（测试用；生产 Date.now）。 */
  now?: () => number;
  /** @mention 解析（默认 content → 成员 id）。 */
  mentions?: (text: string) => string[];
  directory?: Partial<RoomDirectory>;
  /** 新一波选人时的唤醒投递（默认 emitWake；测试可注入记录器）。 */
  notify?: (hint: WakeHint) => void;
}

export interface RoomTurnStore {
  readonly limits: RoomLimits;
  /** 人（Owner）新消息 → 新场次：epoch+1、lateTurns 归零、第一波（responders）立即选人。 */
  beginTurn(input: {
    channelId: string;
    triggerSeq: number;
    text: string;
    targetId?: string;
    authorId?: string;
    replyToAuthorId?: string | null;
    /**
     * 显式候选（Ticket #237）：生产路径由 `selectMessageInvitations` 在 beginTurn 之前算好。
     * 传空数组 = 人类没点名且无可归属任务：仍推进 epoch / 取代旧场次，但不选人、不等超时。
     * 缺省保留旧 responders() 行为（纯状态机单测的兼容口）。
     */
    candidates?: string[];
  }): number;
  /** 选人门（`runAgentRound` 入场 CP0）。 */
  gate(input: {
    channelId: string;
    memberId: string;
    reason?: "message" | "reminder";
    continuing?: boolean;
  }): RoomGate;
  /** 成员发言落库后记账（`sendMessage` 成功提交后调用）。 */
  noteReply(input: {
    channelId: string;
    memberId: string;
    seq: number;
    text: string;
    order?: number;
    epoch?: number;
    /** 显式引用边（Ticket #237：agent 正文不邀人 ⇒ 生产路径传空数组）。缺省按正文解析。 */
    mentions?: string[];
  }): RoomReplyNote;
  /** pass 协议：`(pass)` / 空内容 / `{"action":"ignore"}` / silent 让路——只释放槽位。 */
  notePass(input: { channelId: string; memberId: string; epoch?: number }): void;
  /** 忙碌成员：记 busy-notice 并立刻释放槽位（房间不等待）。 */
  noteBusy(input: { channelId: string; memberId: string; epoch?: number }): void;
  /** 成员离开频道（主动 / 被移出）：从当前场次 elected / late / asked 等槽位移除，幂等。 */
  removeMember(channelId: string, memberId: string): void;
  /** 惰性推进（释放超时槽位 / 结算当前波 / 开下一波）；gate 与超时断言共用的显式入口。 */
  pump(channelId: string): void;
  /** I5 检查点：把某 epoch 的场次标为已被取代（幂等）。 */
  markSuperseded(channelId: string, epoch: number): boolean;
  /** Stop：epoch+1、lateTurns 置哨兵、场次收口为 stopped；重复 / 无活跃场次 no-op。 */
  stopTurn(channelId: string): RoomStopResult;
  isCurrent(channelId: string, epoch: number): boolean;
  snapshot(channelId: string): RoomSnapshot | null;
  /** 测试与运维用的显式清理。 */
  reset(channelId?: string): void;
}

interface InternalTurn {
  epoch: number;
  triggerSeq: number;
  triggerTargetId: string;
  replies: number;
  wave: number;
  seen: Map<string, number>;
  asked: Map<string, number>;
  askedAt: Map<string, number>;
  citedBy: Map<string, { by: string; atSeq: number }>;
  late: Map<string, { askedAtSeq: number; queuedAt: number }>;
  spoke: Set<string>;
  settled: Set<string>;
  elected: Set<string>;
  departed: Set<string>;
  stale: boolean;
  endedReason: RoomTurnEndReason | null;
  askLog: AskRecord[];
  transcript: RoomLine[];
  /** 场次当前水位线（选人时展示给成员的最大 order）。 */
  shownSeq: number;
  /** 当前是否处于「迟到补充轮次」（不受 MAX_ROUNDS 约束，受 MAX_REPLIES 约束）。 */
  supplementary: boolean;
}

interface RoomState {
  epoch: number;
  running: number | null;
  pendingLateSeq: number | null;
  lateTurns: number;
  turn: InternalTurn | null;
  turns: InternalTurn[];
}

/** pass 协议（本票 spec §5）：这些文本一律不计发言。 */
const PASS_TEXT = /^\(?\s*pass\s*\)?\.?$/i;
const ENDED_TURN_HISTORY = 8;
const PUMP_GUARD = 64;

function view(turn: InternalTurn): RoomTurnView {
  return {
    ...turn,
    seen: new Map(turn.seen),
    asked: new Map(turn.asked),
    askedAt: new Map(turn.askedAt),
    citedBy: new Map(turn.citedBy),
    late: new Map(turn.late),
    spoke: new Set(turn.spoke),
    settled: new Set(turn.settled),
    elected: new Set(turn.elected),
    departed: new Set(turn.departed),
    askLog: turn.askLog.map((record) => ({ ...record })),
    transcript: turn.transcript.map((line) => ({ ...line, mentions: [...line.mentions] })),
  };
}

function rotateLeft<T>(items: T[], by: number): T[] {
  if (items.length <= 1) return items;
  const shift = ((by % items.length) + items.length) % items.length;
  return [...items.slice(shift), ...items.slice(0, shift)];
}

/**
 * 房间轮次预算状态机（深模块）：外部只需要 beginTurn / gate / note* / stopTurn，
 * 波次推进（谁被问、何时收口）全在内部，调用方不可能跳过预算。
 */
export function createRoomTurnStore(options: RoomTurnStoreOptions = {}): RoomTurnStore {
  const limits: RoomLimits = { ...DEFAULT_ROOM_LIMITS, ...options.limits };
  const clock = options.now ?? (() => Date.now());
  const notify = options.notify ?? emitWake;
  const mentions = options.mentions ?? ((text: string) => extractMentionedMemberIds(text));
  const directory: RoomDirectory = {
    channelAgentMembers:
      options.directory?.channelAgentMembers ??
      ((channelId: string) =>
        listChannelMembers(channelId)
          .filter((member) => member.type === "agent")
          .map((member) => member.id)),
    isAgent:
      options.directory?.isAgent ??
      ((memberId: string) => getMember(memberId)?.type === "agent"),
    isRoomChannel:
      options.directory?.isRoomChannel ??
      ((channelId: string) => {
        const channel = resolveChannelForTarget(channelId);
        return Boolean(channel) && channel!.type !== "dm";
      }),
  };

  const rooms = new Map<string, RoomState>();

  function getRoom(channelId: string): RoomState {
    let room = rooms.get(channelId);
    if (!room) {
      room = {
        epoch: 0,
        running: null,
        pendingLateSeq: null,
        lateTurns: 0,
        turn: null,
        turns: [],
      };
      rooms.set(channelId, room);
    }
    return room;
  }

  function retire(room: RoomState, turn: InternalTurn, reason: RoomTurnEndReason, stale = false): void {
    if (turn.endedReason !== null) {
      if (stale) turn.stale = true;
      return;
    }
    turn.endedReason = reason;
    if (stale) turn.stale = true;
    room.running = null;
  }

  function pushLine(turn: InternalTurn, line: RoomLine): void {
    const text = line.text.slice(0, limits.LINE_CHARS);
    turn.transcript.push({ ...line, text });
    while (turn.transcript.length > limits.HISTORY_LINES) turn.transcript.shift();
  }

  function maxTranscriptOrder(turn: InternalTurn): number {
    let max = turn.triggerSeq;
    for (const line of turn.transcript) if (line.order > max) max = line.order;
    return max;
  }

  /** I3：把超过 MEMBER_TIMEOUT_MS 未回复的 ask 视为未发言并释放槽位（不 await 成员）。 */
  function releaseTimeouts(turn: InternalTurn): void {
    const now = clock();
    for (const member of [...turn.elected]) {
      if (turn.settled.has(member)) continue;
      const askedAt = turn.askedAt.get(member) ?? now;
      if (now - askedAt < limits.MEMBER_TIMEOUT_MS) continue;
      turn.settled.add(member);
      turn.late.set(member, { askedAtSeq: turn.asked.get(member) ?? 0, queuedAt: now });
      pushLine(turn, {
        seq: turn.shownSeq,
        order: turn.shownSeq,
        author: member,
        kind: "timeout-notice",
        mentions: [],
        text: `(timeout-notice) ${member} did not answer within ${limits.MEMBER_TIMEOUT_MS}ms — the room continued without waiting`,
      });
    }
  }

  /**
   * I4 选人（本票 spec §4）：第二波及以后只看「之后的成员发言把谁叫了出来」，
   * 水位线比较切断「同一条 @ 二次唤起」，回边抑制切断 A↔B 乒乓。
   */
  function candidates(turn: InternalTurn): {
    members: string[];
    cites: Map<string, { by: string; atSeq: number }>;
  } {
    const citedAt = new Map<string, number>();
    const citers = new Map<string, Set<string>>();
    for (const line of turn.transcript) {
      if (line.kind !== "speech") continue;
      // 离开成员的旧发言不再驱动选人；其迟到回复也不会进入转写。
      if (turn.departed.has(line.author)) continue;
      // 发过言 = 已看过自己（水位线前移）
      turn.seen.set(line.author, Math.max(turn.seen.get(line.author) ?? 0, line.order));
      for (const member of line.mentions) {
        if (member === line.author) continue;
        citedAt.set(member, Math.max(citedAt.get(member) ?? 0, line.order));
        const bucket = citers.get(member) ?? new Set<string>();
        bucket.add(line.author);
        citers.set(member, bucket);
      }
    }
    const members: string[] = [];
    const cites = new Map<string, { by: string; atSeq: number }>();
    const ordered = [...citedAt.entries()].sort((left, right) => left[1] - right[1]);
    for (const [member, atSeq] of ordered) {
      if (!directory.isAgent(member)) continue;
      if (turn.departed.has(member)) continue;
      // I4-a：同一条 @ 不二次唤起（已看到把它的引用之后的水位线）
      if ((turn.seen.get(member) ?? -1) >= atSeq) continue;
      const soleCiter = citers.get(member)?.size === 1 ? [...citers.get(member)!][0] : null;
      // I4-b：回边抑制（环在数据层被切断，不靠预算兜住）
      if (soleCiter && isBackEdge(turn, member, soleCiter, citers)) continue;
      members.push(member);
      if (soleCiter) cites.set(member, { by: soleCiter, atSeq });
    }
    return { members: rotateLeft(members, turn.wave % Math.max(1, members.length)), cites };
  }

  /**
   * I4-b 回边抑制。两条判据（任一命中即丢弃这条引用边）：
   * a) **反向重试**：该成员上一次就是被同一个引用者叫进来的，现在唯一引用者仍是它；
   * b) **互引对**：该成员与唯一引用者互为对方的唯一引用者——这正是 A↔B 乒乓的形状。
   * 第三方同时 @ 它（`citers.size > 1`）一律保留。
   */
  function isBackEdge(
    turn: InternalTurn,
    member: string,
    soleCiter: string,
    citers: Map<string, Set<string>>,
  ): boolean {
    const previous = turn.citedBy.get(member);
    if (previous && previous.by === soleCiter) return true;
    const back = citers.get(soleCiter);
    if (back && back.size === 1 && back.has(member)) return true;
    return false;
  }

  function openWave(
    turn: InternalTurn,
    next: { members: string[]; cites?: Map<string, { by: string; atSeq: number }> },
    opts: { announce: boolean; supplementary?: boolean },
  ): void {
    const waveIndex = turn.wave;
    const shownSeq = turn.shownSeq;
    turn.elected = new Set(next.members);
    // `spoke` / `settled` 都是**本波**的：跨波累带会让新一波的当选者被视为「已结算」，
    // 波次刚开就被 pump 当成无人发言而收口（选择后一轮就空转）。
    turn.spoke = new Set();
    turn.settled = new Set();
    for (const member of next.members) {
      turn.asked.set(member, Math.max(turn.asked.get(member) ?? 0, shownSeq));
      turn.askedAt.set(member, clock());
      const cite = next.cites?.get(member);
      turn.askLog.push({
        member,
        wave: waveIndex,
        shownSeq,
        citedBy: cite?.by ?? null,
        citedAtSeq: cite?.atSeq ?? null,
      });
      if (cite) turn.citedBy.set(member, { ...cite });
    }
    if (opts.supplementary) turn.supplementary = true;
    if (!opts.supplementary) turn.wave = waveIndex + 1;
    if (opts.announce) {
      for (const member of next.members) {
        notify({
          agentId: member,
          targetId: turn.triggerTargetId,
          seq: shownSeq,
          reason: "message",
        });
      }
    }
  }

  /** 收口后的补充波（I7）：同一 `candidates()` 逻辑，但自带独立预算（`lateTurns`）。 */
  function openLateWave(turn: InternalTurn, next: { members: string[]; cites: Map<string, { by: string; atSeq: number }> }): void {
    turn.endedReason = null;
    openWave(turn, next, { announce: true, supplementary: true });
  }

  /** 推进：释放超时槽位 → 波次结算 → 预算 → 选下一波（或收口）。 */
  function pump(room: RoomState, turn: InternalTurn): void {
    for (let guard = 0; guard < PUMP_GUARD; guard += 1) {
      if (turn.endedReason !== null) return;
      releaseTimeouts(turn);
      const waiting = [...turn.elected].filter((member) => !turn.settled.has(member));
      if (waiting.length > 0) return;
      // 一波无人发言 ⇒ 整场收口（礼貌循环不需要更多波）
      if (turn.spoke.size === 0) {
        retire(room, turn, "no_speakers");
        return;
      }
      // I1 / I2 预算
      if (turn.replies >= limits.MAX_REPLIES) {
        retire(room, turn, "reply_budget");
        return;
      }
      if (!turn.supplementary && turn.wave >= limits.MAX_ROUNDS) {
        retire(room, turn, "round_budget");
        return;
      }
      turn.shownSeq = maxTranscriptOrder(turn);
      const next = candidates(turn);
      if (next.members.length === 0) {
        retire(room, turn, "no_speakers");
        return;
      }
      openWave(turn, next, { announce: true });
    }
  }

  /** I1 记账：只有「本波被问且尚未结算」的实质发言计预算（pass / notice 一律不计）。 */
  function noteReply(input: {
    channelId: string;
    memberId: string;
    seq: number;
    text: string;
    order?: number;
    epoch?: number;
    mentions?: string[];
  }): RoomReplyNote {
    const room = getRoom(input.channelId);
    const turn = room.turn;
    const order = input.order ?? input.seq;
    if (!turn) return { counted: false, stale: false, late: false, replies: 0 };
    // 已离开成员的在飞 / 迟到回复：若调用方绕过了成员校验，也不得计预算或开启新波。
    if (turn.departed.has(input.memberId)) {
      return { counted: false, stale: true, late: true, replies: turn.replies };
    }
    // I5：被取代场次的落库——照常可见，但不计预算、不参与选人
    if (input.epoch !== undefined && input.epoch !== turn.epoch) {
      turn.stale = true;
      return { counted: false, stale: true, late: false, replies: turn.replies };
    }
    if (input.epoch !== undefined && room.epoch !== input.epoch) {
      turn.stale = true;
      return { counted: false, stale: true, late: false, replies: turn.replies };
    }
    const trimmed = input.text.trim();
    const substantive = trimmed.length > 0 && !PASS_TEXT.test(trimmed);
    const line: RoomLine = {
      seq: input.seq,
      order,
      author: input.memberId,
      kind: substantive ? "speech" : "pass",
      mentions: substantive ? (input.mentions ?? mentions(trimmed)) : [],
      text: trimmed,
    };
    // I7：忙碌/超时被释放的成员，或场次已收口之后的发言 = 迟到回答
    if (turn.late.has(input.memberId) || turn.endedReason !== null) {
      return noteLateReply(room, turn, line);
    }
    pushLine(turn, line);
    turn.shownSeq = Math.max(turn.shownSeq, order);
    let counted = false;
    if (turn.elected.has(input.memberId) && !turn.settled.has(input.memberId)) {
      turn.settled.add(input.memberId);
      if (substantive) {
        turn.spoke.add(input.memberId);
        turn.replies += 1;
        counted = true;
      }
    } else if (substantive) {
      // 非本波当选成员的发言：进转写供选择裁决，但不计发言预算（它没有占用槽位）
      turn.replies += 1;
      counted = true;
    }
    pump(room, turn);
    return { counted, stale: false, late: false, replies: turn.replies };
  }

  /** I7：迟到回答 → ≤ MAX_LATE_TURNS 次补充波；到顶只落库并记 `late_budget`。 */
  function noteLateReply(room: RoomState, turn: InternalTurn, line: RoomLine): RoomReplyNote {
    room.pendingLateSeq =
      room.pendingLateSeq === null ? line.seq : Math.min(room.pendingLateSeq, line.seq);
    if (line.kind === "speech") pushLine(turn, line);
    turn.shownSeq = Math.max(turn.shownSeq, line.order);
    if (room.lateTurns >= limits.MAX_LATE_TURNS) {
      // Stop 之后的场次保持 `stopped`（I5 的终态不被 I7 覆盖）
      if (turn.endedReason !== "stopped") turn.endedReason = "late_budget";
      room.running = null;
      return { counted: false, stale: false, late: true, replies: turn.replies };
    }
    if (line.kind !== "speech") {
      return { counted: false, stale: false, late: true, replies: turn.replies };
    }
    room.lateTurns += 1;
    const next = candidates(turn);
    if (next.members.length === 0) {
      // 迟到回答没有叫出任何人：照常落库（预算已消耗，不再无谓开波）
      return { counted: false, stale: false, late: true, replies: turn.replies };
    }
    openLateWave(turn, next);
    room.running = turn.epoch;
    pump(room, turn);
    return { counted: false, stale: false, late: true, replies: turn.replies };
  }

  function notePass(input: { channelId: string; memberId: string; epoch?: number }): void {
    const room = getRoom(input.channelId);
    const turn = room.turn;
    if (!turn || turn.endedReason !== null) return;
    if (input.epoch !== undefined && input.epoch !== turn.epoch) {
      turn.stale = true;
      return;
    }
    if (!turn.elected.has(input.memberId) || turn.settled.has(input.memberId)) return;
    turn.settled.add(input.memberId);
    pushLine(turn, {
      seq: turn.shownSeq,
      order: turn.shownSeq,
      author: input.memberId,
      kind: "pass",
      mentions: [],
      text: `(pass) ${input.memberId} stayed out of this wave`,
    });
    pump(room, turn);
  }

  /** 忙碌成员：不 await、不占槽位——记 busy-notice 并把它挂进 `late`（其后续发言走 I7）。 */
  function noteBusy(input: { channelId: string; memberId: string; epoch?: number }): void {
    const room = getRoom(input.channelId);
    const turn = room.turn;
    if (!turn || turn.endedReason !== null) return;
    if (input.epoch !== undefined && input.epoch !== turn.epoch) {
      turn.stale = true;
      return;
    }
    if (!turn.elected.has(input.memberId) || turn.settled.has(input.memberId)) return;
    turn.settled.add(input.memberId);
    turn.late.set(input.memberId, {
      askedAtSeq: turn.asked.get(input.memberId) ?? 0,
      queuedAt: clock(),
    });
    pushLine(turn, {
      seq: turn.shownSeq,
      order: turn.shownSeq,
      author: input.memberId,
      kind: "busy-notice",
      mentions: [],
      text: `(busy-notice) ${input.memberId} was busy — the room continued without waiting`,
    });
    pump(room, turn);
  }

  function beginTurn(input: {
    channelId: string;
    triggerSeq: number;
    text: string;
    targetId?: string;
    authorId?: string;
    replyToAuthorId?: string | null;
    candidates?: string[];
  }): number {
    const room = getRoom(input.channelId);
    // I5：用户新消息使 epoch 递增，在跑场次在第一个检查点退出
    if (room.turn && room.turn.endedReason === null) {
      retire(room, room.turn, "superseded", true);
    }
    if (room.turn) {
      room.turns.push(room.turn);
      while (room.turns.length > ENDED_TURN_HISTORY) room.turns.shift();
    }
    room.epoch += 1;
    const epoch = room.epoch;
    // I7/I8：唯一重置点（用户新消息）；`@all` / 换 session / pass 之后都改不动它
    room.lateTurns = 0;
    room.pendingLateSeq = null;
    room.turn = null;
    if (!directory.isRoomChannel(input.channelId)) {
      // DM / 未知频道：没有房间语义，不设预算（既有行为逐字节不变）
      room.running = null;
      return epoch;
    }
    const authorId = input.authorId ?? OWNER_MEMBER_ID;
    const turn: InternalTurn = {
      epoch,
      triggerSeq: input.triggerSeq,
      triggerTargetId: input.targetId ?? input.channelId,
      replies: 0,
      wave: 0,
      seen: new Map(),
      asked: new Map(),
      askedAt: new Map(),
      citedBy: new Map(),
      late: new Map(),
      spoke: new Set(),
      settled: new Set(),
      elected: new Set(),
      departed: new Set(),
      stale: false,
      endedReason: null,
      askLog: [],
      transcript: [],
      shownSeq: input.triggerSeq,
      supplementary: false,
    };
    room.turn = turn;
    room.running = epoch;
    // 第一波 = 调用方显式传入的候选（Ticket #237：wake 与选人共用同一份邀请判定）。
    // 缺省才回落在旧 responders()（点名优先 / 无点名则全体 agent 成员）——纯状态机单测的兼容口。
    const members =
      input.candidates ??
      responders(input.channelId, input.text, authorId, input.replyToAuthorId ?? null);
    openWave(turn, { members }, { announce: false });
    return epoch;
  }

  /** 第一波候选：被 @ 的 agent ∪ 被 reply-to 的 agent；无人被点名或 `@all` → 频道全体 agent。 */
  function responders(
    channelId: string,
    text: string,
    authorId: string,
    replyToAuthorId: string | null,
  ): string[] {
    const picked = new Set<string>();
    if (!hasAllMention(text)) {
      for (const member of mentions(text)) {
        if (member === authorId) continue;
        if (!directory.isAgent(member)) continue;
        picked.add(member);
      }
      if (replyToAuthorId && replyToAuthorId !== authorId && directory.isAgent(replyToAuthorId)) {
        picked.add(replyToAuthorId);
      }
    }
    if (picked.size === 0) {
      for (const member of directory.channelAgentMembers(channelId)) {
        if (member === authorId) continue;
        picked.add(member);
      }
    }
    return [...picked];
  }

  return {
    limits,
    beginTurn,
    gate(input) {
      const room = rooms.get(input.channelId);
      const turn = room?.turn;
      if (!room || !turn || turn.endedReason !== null) return { state: "no-turn", epoch: null };
      // 离开成员不再被旧 wake hint / 旧 mention 拉起；下次人类新消息开新场次才重新评估。
      if (turn.departed.has(input.memberId)) {
        return { state: "not-elected", epoch: turn.epoch };
      }
      // reminder 轮次与任务延续轮次不受选人门约束（本票 spec §6.3）
      if (input.reason === "reminder" || input.continuing) {
        return { state: "bypass", epoch: turn.epoch };
      }
      pump(room, turn);
      if (turn.endedReason !== null) return { state: "no-turn", epoch: null };
      if (turn.elected.has(input.memberId) && !turn.settled.has(input.memberId)) {
        return { state: "elected", epoch: turn.epoch };
      }
      // 本场次从未被问过 ⇒ 不得在房间语境里自主插话（I1/I8 的入口面）；
      // 被问过（含已发言）的成员照旧走既有轮次判定（已回复 / 续工 / 收束都在那里）。
      if (!turn.asked.has(input.memberId)) return { state: "not-elected", epoch: turn.epoch };
      return { state: "elected", epoch: turn.epoch };
    },
    noteReply,
    notePass,
    noteBusy,
    removeMember(channelId, memberId) {
      const room = rooms.get(channelId);
      const turn = room?.turn;
      if (!room || !turn) return;
      // 只清房间内存槽位：消息、消费游标、任务事件都在房间之外，原样保留。
      turn.elected.delete(memberId);
      turn.settled.delete(memberId);
      turn.spoke.delete(memberId);
      turn.late.delete(memberId);
      turn.asked.delete(memberId);
      turn.askedAt.delete(memberId);
      turn.citedBy.delete(memberId);
      turn.departed.add(memberId);
      pump(room, turn);
    },
    pump(channelId) {
      const room = rooms.get(channelId);
      if (room?.turn) pump(room, room.turn);
    },
    markSuperseded(channelId, epoch) {
      const room = rooms.get(channelId);
      const turn = room?.turn;
      if (!room || !turn || turn.epoch !== epoch) return false;
      turn.stale = true;
      if (turn.endedReason === null) retire(room, turn, "superseded", true);
      return true;
    },
    stopTurn(channelId) {
      const room = rooms.get(channelId);
      // 无活跃场次 / 已自然收口 / 已经停过：一律幂等 no-op
      // （不建 room、不改收口原因、不重复加 epoch）。
      if (!room?.turn || room.turn.endedReason !== null) {
        return { stopped: false, epoch: room?.epoch ?? 0 };
      }
      // Stop 是用户显式取消：只对仍在进行的场次生效（本票 spec §6.8）。
      room.turn.endedReason = "stopped";
      room.turn.stale = true;
      // I5：Stop 也推进 epoch；I7：lateTurns 置哨兵（Stop 之后零补充波）
      room.epoch += 1;
      room.lateTurns = limits.MAX_LATE_TURNS;
      room.pendingLateSeq = null;
      room.running = null;
      return { stopped: true, epoch: room.epoch };
    },
    isCurrent(channelId, epoch) {
      const room = rooms.get(channelId);
      return Boolean(room) && room!.epoch === epoch;
    },
    snapshot(channelId) {
      const room = rooms.get(channelId);
      if (!room) return null;
      return {
        channelId,
        epoch: room.epoch,
        running: room.running,
        pendingLateSeq: room.pendingLateSeq,
        lateTurns: room.lateTurns,
        turn: room.turn ? view(room.turn) : null,
        turns: room.turns.map(view),
      };
    },
    reset(channelId) {
      if (channelId === undefined) rooms.clear();
      else rooms.delete(channelId);
    },
  };
}

/**
 * I6：房间回合语境下，成员不得把话说到房间看不见的地方。
 * 只在 `sendMessage` 收到 `roomContext` 时抛出——无 roomContext 的既有调用
 * （秘书 DM / 事件消息 / 人类 UI / 路由层）行为完全不变。
 */
export const ROOM_PRIVATE_CHANNEL_MESSAGE =
  "在群聊中不可用：请 @ 房间成员，让协作留在房间可见记录里。";

export class RoomPrivateChannelForbidden extends Error {
  readonly code = "room_private_channel_forbidden";
  constructor() {
    super(ROOM_PRIVATE_CHANNEL_MESSAGE);
    this.name = "RoomPrivateChannelForbidden";
  }
}

/**
 * 直连链预算（本仓当前没有 agent→agent 派发工具，见本票 spec §6.6 的 N/A 判据；
 * 这里是**纯原语**：先有预算，再谈派发工具接进来）。
 *
 * 三条硬限：跳数单调 +1 到顶拒绝（`hop_limit_exceeded`）、单发送者待回信条数
 * （`pending_limit_per_sender`）、全局待回信条数（`pending_limit_global`）。
 * `dispatch` 只记账**不等待回信**（返回同步对象，绝不返回 Promise）——等待会让
 * 一次派发卡住整条链，而链的预算正是为了让它不可能无限延续。
 */
export type DirectRequestLimitCode =
  | "hop_limit_exceeded"
  | "pending_limit_per_sender"
  | "pending_limit_global";

export class RoomBudgetError extends Error {
  readonly code: DirectRequestLimitCode;
  constructor(code: DirectRequestLimitCode, message: string) {
    super(message);
    this.name = "RoomBudgetError";
    this.code = code;
  }
}

export interface DirectRequestTicket {
  id: number;
  from: string;
  hops: number;
  at: number;
}

export interface DirectRequestBridge {
  /** 派发一跳：`hops` 单调 +1；到顶 / 超待回信预算 → 抛 `RoomBudgetError`。不等待回信。 */
  dispatch(input: { from: string; hops?: number }): DirectRequestTicket;
  /** 回信到了（或放弃）：出队。 */
  settle(id: number): boolean;
  pending(): DirectRequestTicket[];
  pendingCount(): number;
}

/** 下一跳的跳数（第 MAX_REQUEST_HOPS 跳被拒）。 */
export function advanceRequestHop(input: { hops: number; limits?: Partial<RoomLimits> }): number {
  const max = { ...DEFAULT_ROOM_LIMITS, ...input.limits }.MAX_REQUEST_HOPS;
  const next = input.hops + 1;
  if (next >= max) {
    throw new RoomBudgetError(
      "hop_limit_exceeded",
      `请求已传递 ${next} 跳（上限 ${max}）——链条到此为止，请问用户下一步该做什么。`,
    );
  }
  return next;
}

export function createDirectRequestBridge(
  options: { limits?: Partial<RoomLimits>; now?: () => number } = {},
): DirectRequestBridge {
  const limits: RoomLimits = { ...DEFAULT_ROOM_LIMITS, ...options.limits };
  const clock = options.now ?? (() => Date.now());
  const pending = new Map<number, DirectRequestTicket>();
  let nextId = 1;

  return {
    dispatch(input) {
      const bySender = [...pending.values()].filter((ticket) => ticket.from === input.from).length;
      if (bySender >= limits.MAX_PENDING_MESSAGES_PER_SENDER) {
        throw new RoomBudgetError(
          "pending_limit_per_sender",
          `${input.from} 已有 ${bySender} 条待回信（上限 ${limits.MAX_PENDING_MESSAGES_PER_SENDER}），请问用户要放弃哪一条。`,
        );
      }
      if (pending.size >= limits.MAX_PENDING_MESSAGES) {
        throw new RoomBudgetError(
          "pending_limit_global",
          `待回信已达 ${pending.size} 条（上限 ${limits.MAX_PENDING_MESSAGES}），请问用户下一步该做什么。`,
        );
      }
      const hops = advanceRequestHop({ hops: input.hops ?? 0, limits });
      const ticket: DirectRequestTicket = { id: nextId, from: input.from, hops, at: clock() };
      nextId += 1;
      pending.set(ticket.id, ticket);
      return ticket;
    },
    settle(id) {
      return pending.delete(id);
    },
    pending() {
      return [...pending.values()].sort((left, right) => left.id - right.id);
    },
    pendingCount() {
      return pending.size;
    },
  };
}

declare global {
  var __workspliceRoomTurns: RoomTurnStore | undefined;
}

/**
 * 房间状态单例（与 `__workspliceWakeListeners` 同一套热重载纪律：挂 globalThis，
 * 否则 Next 的热重载会把预算清零，计数器就白写了）。
 */
export function getRoomTurnStore(): RoomTurnStore {
  if (!globalThis.__workspliceRoomTurns) {
    globalThis.__workspliceRoomTurns = createRoomTurnStore();
  }
  return globalThis.__workspliceRoomTurns;
}

/** 测试/运维：替换或清空单例（`null` = 下次访问重建）。 */
export function setRoomTurnStore(store: RoomTurnStore | null): void {
  globalThis.__workspliceRoomTurns = store ?? undefined;
}
