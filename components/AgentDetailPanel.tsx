"use client";

import { useCallback, useEffect, useState } from "react";
import { MessageSquare, X } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { Avatar } from "./Avatar";
import { StatusDot } from "./StatusDot";
import { BrutalModal } from "./BrutalModal";
import { DirectoryPicker } from "./DirectoryPicker";
import { ModelPicker } from "./ModelPicker";
import type { MemberRow, MemberStatus, TaskStatus } from "@/lib/data/types";
import type { ModelsData } from "@/lib/models-cache";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: "var(--mono)",
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: "var(--faint)",
        margin: "16px 2px 6px",
      }}
    >
      {children}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: `1px solid var(--border)`,
        boxShadow: "var(--shadow-card)",
        padding: "10px 12px",
      }}
    >
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 10,
      }}
    >
      <span style={{ fontSize: 12, color: "var(--muted)", flexShrink: 0 }}>
        {label}
      </span>
      <span
        style={{
          fontFamily: "var(--mono)",
          fontSize: 12,
          color: "var(--fg)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          maxWidth: "62%",
        }}
      >
        {value}
      </span>
    </div>
  );
}

const ACTION_BUTTON: React.CSSProperties = {
  flex: 1,
  padding: "7px 6px",
  fontFamily: "var(--font)",
  fontWeight: 700,
  fontSize: 12,
  background: "var(--surface)",
  color: "var(--fg)",
  border: `1px solid var(--border)`,
  cursor: "pointer",
};

const DANGER_BUTTON: React.CSSProperties = {
  ...ACTION_BUTTON,
  background: "var(--error)",
  color: "oklch(99% 0.01 256)",
  boxShadow: "2px 2px 0 0 rgba(20, 17, 17, 0.45)",
};

/** DM 懒创建入口主按钮（身份头正下方）：醒目黄色底 + MessageSquare 图标（与侧栏 DM 图标一致）。 */
const DM_BUTTON: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  margin: "12px 12px 0",
  padding: "10px 12px",
  fontFamily: "var(--font)",
  fontWeight: 700,
  fontSize: 14,
  background: "var(--accent)",
  color: "oklch(99% 0.01 256)",
  border: `1px solid var(--border)`,
  boxShadow: "3px 3px 0 0 rgba(20, 17, 17, 0.45)",
  cursor: "pointer",
};

type ConfirmKind = "sessionReset" | "fullReset" | "delete";
type BusyOp =
  | "restart"
  | "sessionReset"
  | "fullReset"
  | "delete"
  | "workspace"
  | "runtime";

const CONFIRM_TITLE: Record<ConfirmKind, string> = {
  sessionReset: "agent.confirmSessionReset",
  fullReset: "agent.confirmFullReset",
  delete: "agent.confirmDelete",
};

const TASK_STATUS_KEY: Record<TaskStatus, string> = {
  todo: "task.status.todo",
  in_progress: "task.status.in_progress",
  in_review: "task.status.in_review",
  done: "task.status.done",
  closed: "task.status.closed",
};

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function formatCost(n: number): string {
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

/**
 * 时间可读回落（D2）：非法日期不得渲染成 "Invalid Date"。
 * `new Date(undefined).toLocaleString()` 不抛错（返回 "Invalid Date" 字符串），
 * 所以 try/catch 拦不住——先验 `getTime()`，解析不出就回落到占位符（与面板其它缺值一致）。
 */
function formatTime(iso: string): string {
  const parsed = new Date(iso);
  if (!Number.isNaN(parsed.getTime())) return parsed.toLocaleString();
  return "—";
}

interface ObservabilityData {
  status: MemberStatus;
  stats: {
    sessions: Array<{
      path: string;
      modified: string | null;
      messageCount: number;
      cachedTokens: number;
      uncachedTokens: number;
      totalTokens: number;
      costTotal: number;
      compactionCount: number;
      compactionTokens: number;
    }>;
    totals: {
      messageCount: number;
      cachedTokens: number;
      uncachedTokens: number;
      totalTokens: number;
      costTotal: number;
      compactionCount: number;
      compactionTokens: number;
    };
  };
  tasks: Array<{
    number: number;
    status: TaskStatus;
    owner: { name: string } | null;
    channelId: string;
    anchor: { id: string; content: string };
    progressCount: number;
  }>;
  timeline: Array<
    | {
        kind: "message";
        id: string;
        at: string;
        channelName: string;
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
        channelName: string;
        number: number;
        status: TaskStatus;
        ownerName: string | null;
        title: string;
      }
  >;
  rounds: Array<{
    id: string;
    targetId: string;
    status:
      | "replied"
      | "ignored"
      | "silent"
      | "anyway"
      | "yielded"
      | "error"
      | "busy-cwd";
    reason: string;
    baseSeq: number;
    createdAt: string;
  }>;
  session: {
    file: string | null;
    sessionId: string | null;
    live: {
      model: { provider: string; modelId: string } | null;
      thinkingLevel: string | null;
      contextUsage: {
        percent: number;
        contextWindow: number;
        tokens: number;
      } | null;
    } | null;
  };
}

/**
 * 任务历史行列表（§6.5）：纯展示——数据与 i18n 由调用方传入。
 * 拆出来是为了让 node 侧测试能直接拿到真实元素树断言 React key 唯一性
 * （SSR 渲染丢弃 key，且仓库无 jsdom，详见测试注释）。
 */
export function TaskHistoryList({
  tasks,
  t,
}: {
  tasks: ObservabilityData["tasks"];
  t: (key: string) => string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {tasks.map((task) => (
        <div
          /* key 用锚点消息 id：number 是 channel 内序号（§3.7），跨 channel 会重号，
             而 tasks.message_id UNIQUE ⇒ 锚点 id 全局唯一。 */
          key={task.anchor.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 8px",
            border: `1px solid var(--border)`,
            background: "var(--panel)",
            fontSize: 12,
          }}
        >
          <span
            style={{
              fontFamily: "var(--mono)",
              fontWeight: 700,
              background: "var(--accent-soft)",
              border: `1px solid var(--border)`,
              padding: "1px 5px",
              fontSize: 11,
              flexShrink: 0,
            }}
          >
            #{task.number}
          </span>
          <span
            style={{
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {task.anchor.content}
          </span>
          <span
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10,
              padding: "1px 5px",
              border: `1px solid var(--border)`,
              background:
                task.status === "done" ? "var(--online)" : "var(--surface)",
              flexShrink: 0,
            }}
          >
            {t(TASK_STATUS_KEY[task.status])}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * 轮次记录列表（§07）：纯展示——数据与 i18n 由调用方传入。
 * 与 TaskHistoryList 同款拆出：node 侧测试可直接渲染真实 markup，断言失败原因与
 * 时间可读（D2：snake_case 透传时期渲染出空白 target、光秃秃的 `#` 与 "Invalid Date"）。
 */
export function RoundLogsList({
  rounds,
  t,
}: {
  rounds: ObservabilityData["rounds"];
  t: (key: string) => string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        maxHeight: 260,
        overflowY: "auto",
      }}
    >
      {rounds.map((round) => {
        const failed = round.status === "error";
        return (
          <div
            key={round.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 8px",
              border: `1px solid var(--border)`,
              background: failed ? "#ffe9e9" : "var(--panel)",
              fontSize: 11,
            }}
          >
            <span
              style={{
                flexShrink: 0,
                fontFamily: "var(--mono)",
                fontWeight: 700,
                padding: "1px 5px",
                border: `1px solid var(--border)`,
                background: failed
                  ? "#ff6b6b"
                  : round.status === "replied"
                    ? "var(--online)"
                    : "var(--surface)",
              }}
            >
              {t("observability.roundStatus." + round.status)}
            </span>
            <span
              style={{
                flex: 1,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                color: "var(--muted)",
              }}
              title={round.reason}
            >
              {round.reason || "—"}
            </span>
            <span
              style={{
                flexShrink: 0,
                fontFamily: "var(--mono)",
                color: "var(--faint)",
                maxWidth: "30%",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={`target: ${round.targetId}`}
            >
              {round.targetId}
            </span>
            <span
              style={{
                flexShrink: 0,
                fontFamily: "var(--mono)",
                color: "var(--faint)",
              }}
            >
              #{round.baseSeq} · {formatTime(round.createdAt)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

interface RuntimeData {
  configured: {
    provider: string | null;
    modelId: string | null;
    thinkingLevel: string | null;
  };
  live: {
    model: { provider: string; modelId: string } | null;
    thinkingLevel: string | null;
  } | null;
}

/** 本次保存的探测结论（`lib/agent-recovery.ts` 的 RuntimeProbeSummary 的镜像）。
 *  不落库、不做历史：只在保存的那一次交互里显示。 */
interface RuntimeProbeSummary {
  attempted: boolean;
  ok?: boolean;
  error?: string;
  latencyMs?: number;
  superseded?: boolean;
}

/** PATCH /api/members/[id]/runtime 的响应形态（票据 02）：agent + 本次探测结论。 */
interface SaveRuntimeResponse {
  probe?: RuntimeProbeSummary;
}

/**
 * 保存 runtime 后的探测结论文案（票据 02 决策 4/9）：结论由服务端裁决，面板只负责显示——
 * 不通过时红点保持，原因就地回这次交互；结论被更新的事件/配置接管时不冒充「已验证」。
 */
export function RuntimeProbeFeedback({ probe }: { probe: RuntimeProbeSummary }) {
  const { t } = useI18n();
  if (!probe.attempted) return null;
  const failed = probe.ok === false;
  const superseded = !failed && probe.superseded === true;
  const text = failed
    ? t("runtime.probeFailed", { message: probe.error ?? "" })
    : superseded
      ? t("runtime.probeSuperseded")
      : t("runtime.probeOk");
  return (
    <div
      style={{
        fontSize: 11,
        color: failed ? "var(--error)" : "var(--online)",
        marginTop: 8,
      }}
    >
      {text}
    </div>
  );
}

/** 右栏：agent 详情面板（§3.6/§3.10/§6.5）。重置 / workspace / runtime（per-agent 模型） / 可观测性。 */
export function AgentDetailPanel({
  agent,
  onClose,
  onChanged,
  onDeleteOptimistic,
  onDeleteFailed,
  onOpenDM,
  hasMessages = false,
}: {
  agent: MemberRow & { home_path?: string };
  onClose: () => void;
  onChanged: () => void;
  /** agent 删除乐观更新（上抛至 AppShell）：确认即从列表移除/关面板，不等 DELETE 返回。 */
  onDeleteOptimistic?: (agentId: string) => void;
  /** agent 删除失败回滚（上抛至 AppShell）：恢复列表 + 错误提示（面板已卸载，本地 error 无处显示）。 */
  onDeleteFailed?: (agentId: string, message: string) => void;
  /** DM 懒创建入口回调（上抛至 AppShell：幂等建/取 DM → 导航中央 + 聚焦 composer + 关面板）。 */
  onOpenDM: (agentId: string) => void;
  /** 该 agent 的 DM 是否已有消息：无消息 →「发送消息」，有消息 →「打开私信」。 */
  hasMessages?: boolean;
}) {
  const { t } = useI18n();
  const [confirming, setConfirming] = useState<ConfirmKind | null>(null);
  const [busyOp, setBusyOp] = useState<BusyOp | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // §6.5 可观测性数据
  const [obs, setObs] = useState<ObservabilityData | null>(null);
  const [obsLoading, setObsLoading] = useState(true);

  // §3.10 per-agent runtime（覆盖全局默认）
  const [runtime, setRuntime] = useState<RuntimeData | null>(null);
  const [models, setModels] = useState<ModelsData | null>(null);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [draftModel, setDraftModel] = useState<{
    provider: string;
    modelId: string;
  } | null>(null);
  const [draftThinking, setDraftThinking] = useState<string | null>(null);
  const [runtimeMsg, setRuntimeMsg] = useState<string | null>(null);
  // 本次保存的探测结论（出错状态下的恢复路径；未触发时为 null → 显示既有的 runtimeMsg）
  const [runtimeProbe, setRuntimeProbe] = useState<RuntimeProbeSummary | null>(null);

  const isBusy = busyOp !== null;

  // ADR-0001：工作区是否家目录（删除/Full reset 只作用于家目录；绑定共享项目目录时禁用）
  const homePath = agent.home_path ?? null;
  const isHomeWorkspace =
    Boolean(homePath) &&
    Boolean(agent.workspace_path) &&
    agent.workspace_path === homePath;
  const fullResetBlocked = Boolean(agent.workspace_path) && !isHomeWorkspace;

  // ── 数据加载 ────────────────────────────────────────────────────────────
  const loadObservability = useCallback(async (memberId: string) => {
    setObsLoading(true);
    try {
      const res = await fetch(
        `/api/members/${encodeURIComponent(memberId)}/observability`,
      );
      const body = (await res.json().catch(() => ({}))) as ObservabilityData & {
        error?: string;
      };
      if (!res.ok || body.error)
        throw new Error(body.error ?? `HTTP ${res.status}`);
      setObs(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setObsLoading(false);
    }
  }, []);

  const loadRuntime = useCallback(async (memberId: string) => {
    try {
      const res = await fetch(
        `/api/members/${encodeURIComponent(memberId)}/runtime`,
      );
      const body = (await res.json().catch(() => ({}))) as RuntimeData & {
        error?: string;
      };
      if (!res.ok || body.error)
        throw new Error(body.error ?? `HTTP ${res.status}`);
      setRuntime(body);
      setDraftModel(
        body.configured.provider && body.configured.modelId
          ? {
              provider: body.configured.provider,
              modelId: body.configured.modelId,
            }
          : null,
      );
      setDraftThinking(body.configured.thinkingLevel ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // 模型列表：优先 workspace cwd（project trust 下的 provider 差异），403 回退全局默认 cwd
  useEffect(() => {
    let disposed = false;
    const cwd = agent.workspace_path
      ? encodeURIComponent(agent.workspace_path)
      : null;
    const load = async (url: string) => {
      const res = await fetch(url);
      return { res, body: (await res.json().catch(() => ({}))) as ModelsData };
    };
    (async () => {
      setModelsLoading(true);
      try {
        if (cwd) {
          const first = await load(`/api/models?cwd=${cwd}`);
          if (disposed) return;
          if (first.res.ok) {
            setModels(first.body);
            return;
          }
        }
        const fallback = await load("/api/models");
        if (!disposed) setModels(fallback.body);
      } finally {
        if (!disposed) setModelsLoading(false);
      }
    })();
    return () => {
      disposed = true;
    };
  }, [agent.workspace_path]);

  useEffect(() => {
    setObsLoading(true);
    setError(null);
    void loadObservability(agent.id);
    void loadRuntime(agent.id);
  }, [agent.id, loadObservability, loadRuntime]);

  const run = async (
    op: BusyOp,
    request: () => Promise<Response>,
  ): Promise<{ ok: boolean; body: unknown }> => {
    if (isBusy) return { ok: false, body: null };
    setBusyOp(op);
    setError(null);
    // 删除走乐观更新：确认即从侧栏移除/关面板（面板随之卸载），DELETE 后台继续。
    if (op === "delete") onDeleteOptimistic?.(agent.id);
    try {
      const res = await request();
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        const message = body.error ?? `HTTP ${res.status}`;
        throw new Error(message);
      }
      if (op === "sessionReset" || op === "fullReset" || op === "delete")
        setConfirming(null);
      if (op === "runtime") {
        await loadRuntime(agent.id);
        await loadObservability(agent.id);
      }
      onChanged();
      return { ok: true, body };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // 面板已因乐观移除卸载时本地 setError 不生效——失败必须经 AppShell 回滚并提示。
      if (op === "delete") onDeleteFailed?.(agent.id, message);
      setError(message);
      return { ok: false, body: null };
    } finally {
      setBusyOp(null);
    }
  };

  const confirmLabels: Record<ConfirmKind, string> = {
    sessionReset: t("agent.sessionReset"),
    fullReset: t("agent.fullReset"),
    delete: t("agent.delete"),
  };

  const confirmRequest = (kind: ConfirmKind) => {
    const base = `/api/members/${encodeURIComponent(agent.id)}`;
    if (kind === "delete") return () => fetch(base, { method: "DELETE" });
    const suffix = kind === "sessionReset" ? "session-reset" : "full-reset";
    return () => fetch(`${base}/${suffix}`, { method: "POST" });
  };

  /** §3.10 保存 per-agent runtime 覆盖：PATCH 持久化 + 存活会话立即生效。
   *  出错状态点下服务端会对刚保存的模型做一次探测，结论随响应回来（决策 9）。 */
  const saveRuntime = async () => {
    setRuntimeMsg(null);
    setRuntimeProbe(null);
    const { ok, body } = await run("runtime", () =>
      fetch(`/api/members/${encodeURIComponent(agent.id)}/runtime`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: draftModel?.provider ?? null,
          modelId: draftModel?.modelId ?? null,
          thinkingLevel: draftThinking ?? null,
        }),
      }),
    );
    if (!ok) return;
    const probe = (body as SaveRuntimeResponse | null)?.probe ?? null;
    if (probe?.attempted) {
      setRuntimeProbe(probe);
      return;
    }
    const cleared = draftModel === null && draftThinking === null;
    setRuntimeMsg(
      cleared
        ? t("runtime.cleared")
        : runtime?.live
          ? t("runtime.savedLive")
          : t("runtime.saved"),
    );
  };

  const exportUrl = obs?.session?.sessionId
    ? `/api/sessions/${encodeURIComponent(obs.session.sessionId)}/export?inline=1`
    : null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
      }}
    >
      {/* 身份头 */}
      <header
        style={{
          flexShrink: 0,
          padding: "14px 16px 12px",
          borderBottom: `1px solid var(--border)`,
          background: "var(--panel)",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <Avatar name={agent.name} type={agent.type} size="lg" colorKey={agent.id} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  fontFamily: "var(--font)",
                  fontWeight: 700,
                  fontSize: 17,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {agent.name}
              </span>
              <StatusDot status={agent.status} />
              <span
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 10,
                  padding: "1px 6px",
                  border: `1px solid var(--border)`,
                  background:
                    agent.role === "owner" ? "var(--accent-soft)" : "var(--surface)",
                  color: "var(--fg)",
                }}
              >
                {agent.role === "owner" ? t("role.owner") : t("role.member")}
              </span>
            </div>
            {agent.description ? (
              <div
                style={{
                  fontSize: 12,
                  color: "var(--muted)",
                  marginTop: 4,
                }}
              >
                {agent.description}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            aria-label={t("detail.close")}
            title={t("detail.close")}
            onClick={onClose}
            style={{
              flexShrink: 0,
              width: 26,
              height: 26,
              background: "var(--surface)",
              border: `1px solid var(--border)`,
              boxShadow: "2px 2px 0 0 rgba(20, 17, 17, 0.45)",
              cursor: "pointer",
              color: "var(--fg)",
              fontSize: 13,
              lineHeight: 1,
            }}
          >
            <X size={13} style={{ display: "block", margin: "auto" }} />
          </button>
        </div>
      </header>

      {/* DM 懒创建入口：身份头正下方醒目主按钮；文案动态（无消息 → 发送消息，有消息 → 打开私信） */}
      <button
        type="button"
        aria-label={hasMessages ? t("agent.openDM") : t("agent.sendMessage")}
        onClick={() => onOpenDM(agent.id)}
        style={DM_BUTTON}
      >
        <MessageSquare size={15} style={{ display: "block", flexShrink: 0 }} />
        {hasMessages ? t("agent.openDM") : t("agent.sendMessage")}
      </button>

      {/* 主体：状态 / workspace / runtime / 可观测性 / 重置 */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "0 12px 20px",
        }}
      >
        <SectionLabel>{t("status." + agent.status)}</SectionLabel>
        <Card>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <StatusDot status={agent.status} />
            <span style={{ fontSize: 13, fontWeight: 600 }}>
              {t("status." + agent.status)}
            </span>
          </div>
          <div
            style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}
          >
            {agent.status === "offline"
              ? t("agent.stoppedHint")
              : t("agent.workspaceHint")}
          </div>
        </Card>

        <SectionLabel>{t("agent.workspace")}</SectionLabel>
        <Card>
          <Row
            label={t("agent.workspace")}
            value={agent.workspace_path ?? t("agent.workspaceNotBound")}
          />
          {isHomeWorkspace && (
            <div
              style={{ marginTop: 6, fontSize: 11, color: "var(--faint)" }}
            >
              {t("agent.workspaceHomeHint")}
            </div>
          )}
          <div
            style={{
              marginTop: 8,
              display: "flex",
              justifyContent: "flex-end",
            }}
          >
            <button
              type="button"
              disabled={isBusy}
              onClick={() => setPickerOpen(true)}
              style={{ ...ACTION_BUTTON, flex: 0, padding: "6px 14px" }}
            >
              {t("agent.change")}
            </button>
          </div>
        </Card>

        {/* §3.10 runtime：per-agent 模型 / provider / thinking，覆盖全局默认 */}
        <SectionLabel>{t("agent.runtime")}</SectionLabel>
        <Card>
          <ModelPicker
            models={models}
            loading={modelsLoading}
            model={draftModel}
            thinkingLevel={draftThinking}
            onModelChange={(provider, modelId) =>
              setDraftModel({ provider, modelId })
            }
            onClearModel={() => setDraftModel(null)}
            onThinkingChange={setDraftThinking}
            onClearThinking={() => setDraftThinking(null)}
            disabled={isBusy}
          />
          {!agent.workspace_path && (
            <div
              style={{ fontSize: 11, color: "var(--faint)", marginTop: 8 }}
            >
              {t("runtime.noWorkspace")}
            </div>
          )}
          {draftModel === null && draftThinking === null && (
            <div
              style={{ fontSize: 11, color: "var(--faint)", marginTop: 8 }}
            >
              {t("runtime.inheritGlobal")}
            </div>
          )}
          {draftModel === null && draftThinking !== null && (
            <div
              style={{ fontSize: 11, color: "var(--faint)", marginTop: 8 }}
            >
              {t("runtime.onlyThinking")}
            </div>
          )}
          {runtime?.live && (
            <div
              style={{
                marginTop: 8,
                padding: "6px 8px",
                background: "var(--fg-soft)",
                border: `1px solid var(--border)`,
                fontSize: 11,
                color: "var(--muted)",
                fontFamily: "var(--mono)",
              }}
            >
              {t("runtime.liveModel")}: {runtime.live.model?.provider}/
              {runtime.live.model?.modelId ?? "—"} ·{" "}
              {runtime.live.thinkingLevel ?? "—"}
            </div>
          )}
          {runtimeProbe ? (
            <RuntimeProbeFeedback probe={runtimeProbe} />
          ) : runtimeMsg ? (
            <div
              style={{
                fontSize: 11,
                color: "var(--online)",
                marginTop: 8,
              }}
            >
              {runtimeMsg}
            </div>
          ) : null}
          <div
            style={{
              marginTop: 10,
              display: "flex",
              gap: 6,
              justifyContent: "flex-end",
            }}
          >
            <button
              type="button"
              disabled={
                isBusy || (draftModel === null && draftThinking === null)
              }
              onClick={saveRuntime}
              style={{
                ...ACTION_BUTTON,
                flex: 0,
                padding: "6px 14px",
                background: "var(--accent)",
                color: "oklch(99% 0.01 256)",
              }}
            >
              {busyOp === "runtime" ? t("runtime.saving") : t("runtime.save")}
            </button>
          </div>
        </Card>

        {/* §6.5 可观测性：① 状态点（上方）② token/成本 ③ 任务历史 ④ 会话导出与上下文状态 */}
        <SectionLabel>{t("agent.observability")}</SectionLabel>

        {/* ② token / 成本（session jsonl 只读解析聚合，不落库） */}
        <Card>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>
            {t("observability.tokensCost")}
          </div>
          {obsLoading || !obs ? (
            <div style={{ fontSize: 12, color: "var(--faint)" }}>
              {t("runtime.loading")}
            </div>
          ) : obs.stats.sessions.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--faint)" }}>
              {t("observability.noSessions")}
            </div>
          ) : (
            <>
              <Row
                label={t("observability.totalTokens")}
                value={formatNumber(obs.stats.totals.totalTokens)}
              />
              <div style={{ height: 6 }} />
              <Row
                label={t("observability.cachedTokens")}
                value={formatNumber(obs.stats.totals.cachedTokens)}
              />
              <div style={{ height: 6 }} />
              <Row
                label={t("observability.uncachedTokens")}
                value={formatNumber(obs.stats.totals.uncachedTokens)}
              />
              <div style={{ height: 6 }} />
              <Row
                label={t("observability.cost")}
                value={formatCost(obs.stats.totals.costTotal)}
              />
              <div style={{ height: 6 }} />
              <Row
                label={t("observability.compactions")}
                value={String(obs.stats.totals.compactionCount)}
              />
              <div style={{ height: 6 }} />
              <Row
                label={t("observability.compactionTokens")}
                value={formatNumber(obs.stats.totals.compactionTokens)}
              />
              <div style={{ height: 6 }} />
              <Row
                label={t("observability.messages")}
                value={formatNumber(obs.stats.totals.messageCount)}
              />
              <details style={{ marginTop: 10 }}>
                <summary
                  style={{
                    fontSize: 11,
                    fontFamily: "var(--mono)",
                    fontWeight: 700,
                    cursor: "pointer",
                    color: "var(--muted)",
                  }}
                >
                  {t("observability.sessions")} ({obs.stats.sessions.length})
                </summary>
                <div
                  style={{
                    marginTop: 8,
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  {obs.stats.sessions.map((s) => (
                    <div
                      key={s.path}
                      style={{
                        padding: "6px 8px",
                        border: `1px solid var(--border)`,
                        background: "var(--panel)",
                        fontSize: 11,
                      }}
                    >
                      <div
                        style={{
                          fontFamily: "var(--font-mono)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={s.path}
                      >
                        {s.path.split("/").slice(-2).join("/")}
                      </div>
                      <div style={{ color: "var(--muted)", marginTop: 3 }}>
                        {formatNumber(s.totalTokens)} tok ·{" "}
                        {formatCost(s.costTotal)} · {s.compactionCount}×{" "}
                        {t("observability.compactions").toLowerCase()}
                        {s.modified ? ` · ${formatTime(s.modified)}` : ""}
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            </>
          )}
        </Card>

        {/* ③ 任务历史（该 agent 参与的任务 + 时间线，直接查 messages/tasks） */}
        <Card>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>
            {t("observability.taskHistory")}
          </div>
          {obsLoading || !obs ? (
            <div style={{ fontSize: 12, color: "var(--faint)" }}>
              {t("runtime.loading")}
            </div>
          ) : (
            <>
              {obs.tasks.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--faint)" }}>
                  {t("observability.tasksEmpty")}
                </div>
              ) : (
                <TaskHistoryList tasks={obs.tasks} t={t} />
              )}
              <div style={{ marginTop: 12, fontWeight: 700, fontSize: 12 }}>
                {t("observability.timeline")}
              </div>
              {obs.timeline.length === 0 ? (
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--faint)",
                    marginTop: 4,
                  }}
                >
                  {t("observability.timelineEmpty")}
                </div>
              ) : (
                <div
                  style={{
                    marginTop: 6,
                    display: "flex",
                    flexDirection: "column",
                    gap: 0,
                    borderLeft: `1px solid var(--border)`,
                    paddingLeft: 10,
                    maxHeight: 320,
                    overflowY: "auto",
                  }}
                >
                  {obs.timeline.map((entry) => (
                    <div
                      key={entry.id}
                      style={{
                        padding: "5px 0",
                        borderBottom: "1px dashed var(--border)",
                        fontSize: 11,
                      }}
                    >
                      {entry.kind === "message" ? (
                        <>
                          <div
                            style={{
                              display: "flex",
                              gap: 6,
                              alignItems: "baseline",
                            }}
                          >
                            <span
                              style={{
                                color: "var(--faint)",
                                flexShrink: 0,
                              }}
                            >
                              {formatTime(entry.at)}
                            </span>
                            <span
                              style={{
                                flexShrink: 0,
                                fontFamily: "var(--mono)",
                                fontWeight: 700,
                                color: entry.inTaskThread
                                  ? "var(--accent)"
                                  : "var(--muted)",
                              }}
                            >
                              {entry.inTaskThread
                                ? t("observability.threadPost")
                                : t("observability.channelPost")}
                              {entry.taskNumber !== null
                                ? ` #${entry.taskNumber}`
                                : ""}
                            </span>
                          </div>
                          <div
                            style={{
                              color: "var(--fg)",
                              marginTop: 2,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                            title={entry.content}
                          >
                            {entry.content}
                          </div>
                        </>
                      ) : (
                        <div style={{ color: "var(--muted)" }}>
                          <span style={{ color: "var(--faint)" }}>
                            {formatTime(entry.at)}
                          </span>{" "}
                          {t("observability.taskPoint", {
                            number: String(entry.number),
                            status: t(TASK_STATUS_KEY[entry.status]),
                          })}
                          <div
                            style={{
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              color: "var(--fg)",
                            }}
                          >
                            {entry.title}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </Card>

        {/* ③b §07 轮次记录：有结论的轮次（区分自判 ignore 与处理失败；cap-ack 的 (capped) 标记在此） */}
        <Card>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>
            {t("observability.rounds")}
          </div>
          {obsLoading || !obs ? (
            <div style={{ fontSize: 12, color: "var(--faint)" }}>
              {t("runtime.loading")}
            </div>
          ) : obs.rounds.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--faint)" }}>
              {t("observability.roundsEmpty")}
            </div>
          ) : (
            <RoundLogsList rounds={obs.rounds} t={t} />
          )}
        </Card>

        {/* ④ 会话导出与上下文状态（export/context，cost/compaction 可见性） */}
        <Card>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>
            {t("observability.export")}
          </div>
          {obs?.session?.file ? (
            <>
              <Row
                label={t("observability.sessionFile")}
                value={obs.session.file.split("/").slice(-2).join("/")}
              />
              <div style={{ height: 6 }} />
              {obs.session.live?.contextUsage ? (
                <>
                  <Row
                    label={t("observability.contextUsage")}
                    value={`${obs.session.live.contextUsage.percent}% (${formatNumber(obs.session.live.contextUsage.tokens)} / ${formatNumber(obs.session.live.contextUsage.contextWindow)})`}
                  />
                  <div style={{ height: 6 }} />
                </>
              ) : (
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--faint)",
                    marginBottom: 6,
                  }}
                >
                  {t("observability.contextNone")}
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                {exportUrl ? (
                  <a
                    href={exportUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      ...ACTION_BUTTON,
                      flex: 0,
                      padding: "6px 14px",
                      textDecoration: "none",
                    }}
                  >
                    {t("observability.exportAction")}
                  </a>
                ) : (
                  <span style={{ fontSize: 11, color: "var(--faint)" }}>
                    {t("observability.exportUnavailable")}
                  </span>
                )}
              </div>
            </>
          ) : (
            <div style={{ fontSize: 12, color: "var(--faint)" }}>
              {t("observability.noSessions")}
            </div>
          )}
        </Card>

        {/* §3.6 重置粒度 */}
        <SectionLabel>{t("agent.reset")}</SectionLabel>
        <Card>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              disabled={isBusy}
              onClick={() =>
                void run("restart", () =>
                  fetch(
                    `/api/members/${encodeURIComponent(agent.id)}/restart`,
                    { method: "POST" },
                  ),
                )
              }
              style={ACTION_BUTTON}
            >
              {busyOp === "restart"
                ? t("agent.restarting")
                : t("agent.restart")}
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => setConfirming("sessionReset")}
              style={ACTION_BUTTON}
            >
              {t("agent.sessionReset")}
            </button>
            <button
              type="button"
              disabled={isBusy || fullResetBlocked}
              onClick={() => setConfirming("fullReset")}
              style={ACTION_BUTTON}
            >
              {t("agent.fullReset")}
            </button>
          </div>
          {fullResetBlocked && (
            <div
              style={{ marginTop: 6, fontSize: 11, color: "var(--faint)" }}
            >
              {t("agent.fullResetSharedHint")}
            </div>
          )}
          <div style={{ marginTop: 8 }}>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => setConfirming("delete")}
              style={DANGER_BUTTON}
            >
              {t("agent.delete")}
            </button>
          </div>
        </Card>

        {error && (
          <div style={{ marginTop: 12, color: "var(--error)", fontSize: 12 }}>
            {t("agent.opError", { message: error })}
          </div>
        )}
      </div>

      {/* 危险操作确认 */}
      {confirming && (
        <BrutalModal
          title={confirmLabels[confirming]}
          onClose={() => setConfirming(null)}
        >
          <div style={{ padding: "16px" }}>
            <div
              style={{ fontSize: 13, lineHeight: 1.6, color: "var(--fg)" }}
            >
              {t(CONFIRM_TITLE[confirming])}
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
                marginTop: 18,
              }}
            >
              <button
                type="button"
                disabled={isBusy}
                onClick={() => setConfirming(null)}
                style={{
                  padding: "8px 16px",
                  fontFamily: "var(--font)",
                  fontWeight: 700,
                  fontSize: 13,
                  background: "var(--surface)",
                  color: "var(--fg)",
                  border: `1px solid var(--border)`,
                  cursor: isBusy ? "not-allowed" : "pointer",
                }}
              >
                {t("agent.cancelOp")}
              </button>
              <button
                type="button"
                disabled={isBusy}
                onClick={() => void run(confirming, confirmRequest(confirming))}
                style={{
                  padding: "8px 16px",
                  fontFamily: "var(--font)",
                  fontWeight: 700,
                  fontSize: 13,
                  background: "var(--error)",
                  color: "var(--fg)",
                  border: `1px solid var(--border)`,
                  boxShadow: "2px 2px 0 0 rgba(20, 17, 17, 0.45)",
                  cursor: isBusy ? "not-allowed" : "pointer",
                }}
              >
                {t("agent.confirm")}
              </button>
            </div>
          </div>
        </BrutalModal>
      )}

      {/* workspace 更换（DirectoryPicker） */}
      {pickerOpen && (
        <DirectoryPicker
          onCancel={() => setPickerOpen(false)}
          onSelect={(path) => {
            setPickerOpen(false);
            void run("workspace", () =>
              fetch(`/api/members/${encodeURIComponent(agent.id)}/workspace`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ workspacePath: path }),
              }),
            );
          }}
        />
      )}
    </div>
  );
}
