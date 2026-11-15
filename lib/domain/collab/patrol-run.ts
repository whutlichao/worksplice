import { getDb } from "../../data/db-singleton.ts";
import { getChannel, listChannelsWithMeta } from "./channels.ts";
import { getGlobalChief } from "./chief.ts";
import { sendMessage } from "./messages.ts";
import {
  buildPatrolSummary,
  findPatrolFindings,
  patrolSignatureOf,
  type PatrolFinding,
  type PatrolTaskSnapshot,
} from "./patrol.ts";

/**
 * 巡检的**接入层**（票 #267）：搭既有每分钟维护节拍（`lib/agent-loop/loop.ts` 的
 * `tickAgentLoopMaintenance`）跑一次，把判定层的发现汇总成**最多一条**频道消息。
 *
 * 边界（都是票面写死的，改动要回到 spec #265）：
 * - 巡检只**报告**已有任务：不读消息内容、不建任务、不派活、不改任务状态（唯一写入是投递）。
 * - 每轮最多一条消息；无发现则完全沉默。
 * - 扫描范围 = 全局首席作为成员、未归档、非 DM 的频道。没有全局首席 ⇒ 整轮静默。
 * - 落点与可见面是两件事（见 `resolveDestination` / `visibleFindings`）：落点按「她作为首席的
 *   频道 → 第一个公开频道 → 静默」；内容只携带落点自己的发现 + 公开频道的发现，别的私有频道的
 *   发现不上报（汇总只有一条消息，不能把私有可见面带进公开频道）。
 * - 投递按**系统事件**语义（`roomNotice: true` + `wake: false`）：不得开房间场次、不得
 *   重置迟到名额、不得 supersede 在跑的场次——否则巡检会持续吃掉房间发言配额，把正常
 *   对话挤成沉默（spec #265 的承重约束）。
 *
 * 去重签名集只存在进程内（`globalThis` 单例，热重载安全），不落库、不加 schema 列：
 * 重启后同一批卡住任务会再报一次，那是可接受的（比多一张表划算）。
 */

/** 巡检的首席引用（只需要投递署名用到的两列）。 */
export interface PatrolChief {
  id: string;
  name: string;
}

/** 扫描范围内的一个频道（已滤掉 DM / 归档 / 未加入）。 */
export interface PatrolChannelScope {
  channelId: string;
  /**
   * 该频道此刻生效的首席是不是本轮巡检的首席——落点优先级第一档的判据。
   * 直接取 `listChannelsWithMeta` 的 `chief`（`resolveEffectiveChief` 的结论），
   * 不在巡检里重新推导一遍。
   */
  chiefHere: boolean;
  /**
   * 是否公开频道（`channel.type === "public"`）：落点兜底只从公开频道里取，
   * 可见性过滤也只把公开频道的发现带进别的落点（见 `visibleFindings`）。
   */
  isPublic: boolean;
}

/** 巡检一次的运行结果：给 tick 的返回值，也给测试观察（不投递 / 投了几条 / 落在哪）。 */
export interface PatrolRunResult {
  status: "disabled" | "no-chief" | "silent" | "reported" | "failed";
  /** 本轮命中的发现数（去重前）。 */
  findings: number;
  /** 本轮实际投出的发现数（去重后）。 */
  reported: number;
  /** 投递落点（没投时为 null）。 */
  channelId: string | null;
}

export interface PatrolRunDeps {
  now?: () => Date;
  readChief?: () => PatrolChief | null;
  readChannels?: (chiefId: string) => PatrolChannelScope[];
  readTasks?: (channelId: string) => PatrolTaskSnapshot[];
  deliver?: (input: { channelId: string; authorId: string; content: string }) => void;
  /** 上次上报签名集（测试注入；缺省用进程内单例）。 */
  signatures?: Set<string>;
  /** 整体开关（测试注入；缺省按环境变量现算）。 */
  disabled?: boolean;
}

declare global {
  var __worksplicePatrolSignatures: Set<string> | undefined;
}

/** 已上报签名集（进程内单例；改本模块后必须重启 dev server，同 wake / 房间状态那套陷阱）。 */
export function getPatrolSignatureStore(): Set<string> {
  if (!globalThis.__worksplicePatrolSignatures) {
    globalThis.__worksplicePatrolSignatures = new Set();
  }
  return globalThis.__worksplicePatrolSignatures;
}

/** 测试接缝：`null` = 丢弃当前签名集，下一次访问重建空集。 */
export function setPatrolSignatureStore(store: Set<string> | null): void {
  globalThis.__worksplicePatrolSignatures = store ?? undefined;
}

/**
 * 巡检的整体开关（默认开；`WORKSPLICE_PATROL_DISABLED=1` 关闭）。
 * 现算而不在模块顶层求值：环境变量在进程启动后才设也能生效，测试也能直接传 env（不污染真实环境）。
 */
export function isPatrolDisabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.WORKSPLICE_PATROL_DISABLED === "1";
}

function defaultReadChief(): PatrolChief | null {
  const chief = getGlobalChief();
  return chief ? { id: chief.id, name: chief.name } : null;
}

function defaultReadChannels(chiefId: string): PatrolChannelScope[] {
  return listChannelsWithMeta(chiefId)
    // 扫描范围（票面写定）：她作为成员、未归档、非 DM——私信与归档频道不得被巡检骚扰。
    .filter((channel) => channel.joined && channel.archived !== 1 && channel.type !== "dm")
    .map((channel) => ({
      channelId: channel.id,
      chiefHere: channel.chief?.id === chiefId,
      isPublic: channel.type === "public",
    }));
}

/**
 * 默认任务快照读取：直接读数据层的 `TaskRow`（+ 锚点消息的 `created_at`，7 天窗口用）。
 * 故意不走 `listChannelTasks`（TaskView）：它顺带给每条任务算 reactions / 附件 / 未读回复，
 * 而巡检每分钟要扫一遍首席的全部频道——这里只需要判定用的那几列。
 *
 * `TaskRow` 没有 `created_at`（7 天窗口按**锚点消息**时间算，不按任务行时间），所以每条任务
 * 要额外取一次锚点消息；读的是同一个适配器实例，所以 `getDb()` 在函数顶取一次即可。
 */
function defaultReadTasks(channelId: string): PatrolTaskSnapshot[] {
  const db = getDb();
  const channelName = getChannel(channelId)?.name ?? channelId;
  return db
    .listChannelTasks(channelId)
    .map((task) => {
      const anchor = db.getMessage(task.message_id);
      if (!anchor) return null;
      return {
        taskId: task.id,
        channelId: anchor.target_id,
        channelName,
        number: task.number,
        status: task.status,
        ownerId: task.owner_id,
        handoffState: task.handoff_state,
        anchorCreatedAt: anchor.created_at,
        updatedAt: task.updated_at,
      };
    })
    .filter((snapshot): snapshot is PatrolTaskSnapshot => snapshot !== null);
}

function defaultDeliver(input: {
  channelId: string;
  authorId: string;
  content: string;
}): void {
  sendMessage({
    targetId: input.channelId,
    authorId: input.authorId,
    content: input.content,
    // 系统事件语义：不唤醒任何人（wake: false 也让房间预算跳过它），但消息仍然可见。
    wake: false,
    roomNotice: true,
  });
}

/**
 * 落点解析（**本 spec 新引入的兜底语义**，既有代码只回答「谁是首席」、不回答「落在哪」）：
 * ① 第一个「她是生效首席」的频道里有发现 ⇒ 落在那个频道（私有也行——她就是那个频道的首席）；
 * ② 否则退到她所在的第一个**公开**频道（`isPublic`）：私有频道不是兜底——她只是成员的私有
 *    频道不能成为「一条系统消息」的去处；
 * ③ 扫描范围为空、或范围内没有任何公开频道 ⇒ `null` = 静默。不广播、不私信人类。
 *
 * 判据用的是**全部发现**（不是去重后的新发现）：落点是「这批发现该投到哪」，与「哪几条还没报过」
 * 是两件事——已报过的发现占着的首席频道仍然是它自己那批发现的自然落点。
 */
function resolveDestination(
  findings: PatrolFinding[],
  channels: PatrolChannelScope[],
): string | null {
  const chiefChannels = new Set(
    channels.filter((channel) => channel.chiefHere).map((channel) => channel.channelId),
  );
  const chiefHere = findings.find((finding) => chiefChannels.has(finding.channelId));
  if (chiefHere) return chiefHere.channelId;
  return channels.find((channel) => channel.isPublic)?.channelId ?? null;
}

/**
 * 可见性过滤（spec #265「不发明广播」、`GLOSSARY.md`「巡检落点」）：汇总只有一条消息，所以它
 * 只能携带**落点频道看得见**的发现——落点频道自己的发现 ∪ 落在**公开频道**的发现。
 * 落在**别的私有频道**的发现不上报：否则「私有频道名 + 任务号」就跟着公开落点泄露进了更大的
 * 可见面。落点自身是私有频道时聚合公开发现是安全的——私有可见面 ⊆ 公开可见面，不是泄露。
 */
function visibleFindings(
  findings: PatrolFinding[],
  destination: string,
  channels: PatrolChannelScope[],
): PatrolFinding[] {
  const publicChannels = new Set(
    channels.filter((channel) => channel.isPublic).map((channel) => channel.channelId),
  );
  return findings.filter(
    (finding) => finding.channelId === destination || publicChannels.has(finding.channelId),
  );
}

/** 依赖缺省值的唯一落点（注入什么就用什么，其余走真实实现）。 */
function patrolIo(deps: PatrolRunDeps): Required<PatrolRunDeps> {
  return {
    now: deps.now ?? (() => new Date()),
    readChief: deps.readChief ?? defaultReadChief,
    readChannels: deps.readChannels ?? defaultReadChannels,
    readTasks: deps.readTasks ?? defaultReadTasks,
    deliver: deps.deliver ?? defaultDeliver,
    signatures: deps.signatures ?? getPatrolSignatureStore(),
    disabled: deps.disabled ?? isPatrolDisabled(),
  };
}

/** 跑一次巡检（tick 与测试共用）。 */
export function runPatrolOnce(deps: PatrolRunDeps = {}): PatrolRunResult {
  const io = patrolIo(deps);
  if (io.disabled) {
    return { status: "disabled", findings: 0, reported: 0, channelId: null };
  }

  const now = io.now();
  const { readChannels, readTasks, deliver, signatures } = io;

  const chief = io.readChief();
  if (!chief) return { status: "no-chief", findings: 0, reported: 0, channelId: null };

  const channels = readChannels(chief.id);
  const findings: PatrolFinding[] = [];
  for (const channel of channels) {
    findings.push(...findPatrolFindings({ now, tasks: readTasks(channel.channelId) }));
  }

  const channelId = resolveDestination(findings, channels);
  const reportable = channelId === null ? [] : visibleFindings(findings, channelId, channels);
  // 签名集**只记可上报的发现**：私有且非落点的发现不写进去，将来她成为那个频道的首席时才报得出来。
  const current = new Set(reportable.map((finding) => patrolSignatureOf(finding)));
  const fresh = reportable.filter((finding) => !signatures.has(patrolSignatureOf(finding)));
  if (channelId === null || fresh.length === 0) {
    // 签名集随扫描结论一起淡出：修好的任务不再占位，之后重新卡住算新事件。
    replaceSignatures(signatures, current);
    return { status: "silent", findings: findings.length, reported: 0, channelId: null };
  }

  const content = buildPatrolSummary(fresh);
  if (content === null) {
    replaceSignatures(signatures, current);
    return { status: "silent", findings: findings.length, reported: 0, channelId: null };
  }

  try {
    deliver({ channelId, authorId: chief.id, content });
  } catch (error) {
    // 投递失败不消耗签名：下一轮还要再报一次（否则这批发现就再无人知晓了）。
    console.error(
      "[worksplice] task patrol delivery failed:",
      error instanceof Error ? error.message : String(error),
    );
    return { status: "failed", findings: findings.length, reported: 0, channelId };
  }

  replaceSignatures(signatures, current);
  return { status: "reported", findings: findings.length, reported: fresh.length, channelId };
}

function replaceSignatures(store: Set<string>, current: Set<string>): void {
  store.clear();
  for (const signature of current) store.add(signature);
}
