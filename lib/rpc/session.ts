// AgentSessionWrapper — 单个 pi 会话的进程内封装（原 lib/rpc-manager.ts 的核心类）。
//
// 职责：把 AgentSession 包装成应用其余部分期望的接口——事件订阅（onEvent）、
// 命令分发（send 的 26 个命令分支）、扩展绑定（session_start / 自定义 UI /
// 命令上下文动作）、生命周期（start/shutdown/destroy/idle 超时）。
// 不负责：会话注册表（registry.ts）、会话启动构造（caller.ts）、
// 运行状态广播（broadcaster.ts）。start() 等处的运行状态通知委托 broadcaster。

import { randomUUID } from "crypto";
import { existsSync, writeFileSync } from "fs";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { SessionManager, Theme, getAgentDir } from "@earendil-works/pi-coding-agent";
import type { SlashCommandInfo } from "@earendil-works/pi-coding-agent";
import { KeybindingsManager as TuiKeybindingsManager, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";
import { validateAgentImages } from "../image-attachments";
import { invalidateModelsCache } from "../models-cache";
import { cacheSessionPath, invalidateSessionListCache } from "../session-reader";
import { getProjectTrustStatus } from "../project-trust";
import { createHeadlessCustomUiTui, DEFAULT_CUSTOM_UI_COLUMNS } from "../custom-ui-terminal";
import { notifyRunningChange } from "./broadcaster.ts";
import { containmentStatus } from "../bash-containment.ts";
import type { BashContainmentDeps, ContainedBash } from "../bash-containment-extension.ts";
import type { AgentSessionLike, ExtensionUiContextLike, ToolInfo } from "../pi-types";
import type { ForcedEmptySystemPromptSwitch } from "./forced-empty-system-prompt";
import { CODING_TOOL_NAMES } from "../tool-presets";
import type { PathGuardScope } from "../tool-path-guard.ts";
import type { ExtensionUiRequest, ExtensionUiResponse, ExtensionWidgetItem } from "../types";

// ============================================================================
// Types
// ============================================================================

export interface AgentEvent {
  type: string;
  [key: string]: unknown;
}

type EventListener = (event: AgentEvent) => void;

/**
 * `AgentSession.messages` 的只读收窄（D1）：模型/API 报错时，末条 assistant message
 * 带 `stopReason: "error"` 与 `errorMessage`（与 session jsonl 同源）。pi-types 的
 * `AgentSessionLike` 未镜像 messages，这里按需收窄——只读，不碰任何写路径。
 */
type SessionMessageLike = {
  role?: string;
  stopReason?: string;
  errorMessage?: string;
  content?: readonly unknown[];
};

type PendingUiResponse = {
  resolve: (response: ExtensionUiResponse) => void;
  cancel: () => void;
};

type CustomUiComponent = {
  render: (width: number) => string[];
  handleInput?: (data: string) => void;
  dispose?: () => void;
  invalidate?: () => void;
};

type ActiveCustomUi = {
  component: CustomUiComponent;
  width: number;
  resolve: (value: unknown) => void;
  settled: boolean;
};

type ExtensionUiRequestBody = Record<string, unknown> & {
  method: ExtensionUiRequest["method"];
  timeout?: number;
  expiresAt?: number;
};

type ExtensionCommandContextActionsLike = {
  waitForIdle: () => Promise<void>;
  newSession: () => Promise<{ cancelled: boolean }>;
  fork: () => Promise<{ cancelled: boolean }>;
  navigateTree: (targetId: string, options?: { summarize?: boolean }) => Promise<{ cancelled: boolean }>;
  switchSession: () => Promise<{ cancelled: boolean }>;
  reload: () => Promise<void>;
};

type ExtensionBindingOptions = {
  forceEmptySystemPrompt?: boolean;
};

const RUNNING_STATE_EVENT_TYPES = new Set([
  "agent_start",
  "agent_end",
  "agent_settled",
  "auto_compaction_start",
  "auto_compaction_end",
  "compaction_start",
  "compaction_end",
]);

const IDLE_RESET_EVENT_TYPES = new Set([
  "agent_end",
  "agent_settled",
  "auto_compaction_end",
  "compaction_end",
]);

/**
 * 把本模块自产的 UI 请求载荷宽化成事件流形状（一处宽化，避免每个 emit 点各叠一层 `as`）。
 * SAFETY: ExtensionUiRequest 与 AgentEvent（`type` + 任意字段）结构兼容，只差一个索引
 * 签名——载荷都是本模块自己构造的，这里做一次无运行时检查的宽化并集中记录不变式。
 */
function asAgentEvent(event: ExtensionUiRequest): AgentEvent {
  // SAFETY: 见上——本模块自产的 UI 载荷与 AgentEvent 结构兼容，只差索引签名。
  return event as unknown as AgentEvent;
}

export interface RpcSessionStartOptions {
  toolNames?: string[];
  initialModel?: { provider: string; modelId: string };
  thinkingLevel?: ThinkingLevel;
  /**
   * 路径守卫的判定域（ADR-0011）：传了就在该会话注册六个同名覆盖的文件工具定义，
   * 落点被限制在允许根内；未传 = 不装守卫（人类会话走 pi 的默认实现）。
   */
  pathGuard?: PathGuardScope;
  /**
   * 沙箱的装配参数（ADR-0012）：只要 `pathGuard` 在场就是「会话归属的成员」（决策三），
   * caller 会据此装配沙箱（工具面同名覆盖定义 + RPC 面 operations 共用一份）。
   * 这一项只用于**覆盖探测输入**（集成测试注入平台 / 可执行文件探测以穷举 fail-closed 姿态），
   * 生产路径（`agent-runtime.startSession`）不传。
   */
  bashContainment?: BashContainmentDeps;
}

// Every colour token the SDK's own `theme-schema.json` marks required, minus the five it
// marks optional (`scrollbarTrack` / `scrollbarThumb` / `thinkingMax` / `searchMatchText` /
// `searchMatchBg`), split into the constructor's foreground and background records. Key names and
// order are copied from `properties.colors.required`; `lib/rpc/session.test.mjs` re-reads the
// installed package's schema and fails if the two ever drift apart.
//
// These records MUST stay complete. `Theme`'s constructor treats every absent token as a hole:
// 0.99.2 synthesises `scrollbarTrack` / `scrollbarThumb` / `searchMatchText` from `muted` / `text`
// and `searchMatchBg` from `selectedBg` (pi-coding-agent's `theme.js:127-132`), so a partial record
// feeds `undefined` into pi-tui's `parseColor` and throws `Invalid color value: undefined` — at
// module-import time, because `PLAIN_TEXT_THEME` below is a module top-level constant. Letting the
// type system demand all 45 foreground keys turns that import-time crash into a compile error.
//
// Values are all `""` — the SDK's documented "terminal default" — because the web UI applies its
// own styling. The values never reach a rendered string: every rendering method on PlainTextTheme
// is the identity function, and the colour state exists only to satisfy the constructor and
// `instanceof Theme`.
const EMPTY_FOREGROUND_COLOR_TOKENS = {
  accent: "",
  border: "",
  borderAccent: "",
  borderMuted: "",
  success: "",
  error: "",
  warning: "",
  muted: "",
  dim: "",
  text: "",
  thinkingText: "",
  userMessageText: "",
  customMessageText: "",
  customMessageLabel: "",
  toolTitle: "",
  toolOutput: "",
  mdHeading: "",
  mdLink: "",
  mdLinkUrl: "",
  mdCode: "",
  mdCodeBlock: "",
  mdCodeBlockBorder: "",
  mdQuote: "",
  mdQuoteBorder: "",
  mdHr: "",
  mdListBullet: "",
  toolDiffAdded: "",
  toolDiffRemoved: "",
  toolDiffContext: "",
  syntaxComment: "",
  syntaxKeyword: "",
  syntaxFunction: "",
  syntaxVariable: "",
  syntaxString: "",
  syntaxNumber: "",
  syntaxType: "",
  syntaxOperator: "",
  syntaxPunctuation: "",
  thinkingOff: "",
  thinkingMinimal: "",
  thinkingLow: "",
  thinkingMedium: "",
  thinkingHigh: "",
  thinkingXhigh: "",
  bashMode: "",
} as const;

const EMPTY_BACKGROUND_COLOR_TOKENS = {
  selectedBg: "",
  userMessageBg: "",
  customMessageBg: "",
  toolPendingBg: "",
  toolSuccessBg: "",
  toolErrorBg: "",
} as const;

// Extensions require a complete Theme, while the web UI applies its own styling.
// `appearance` is passed explicitly because every token above is `""`: without it the constructor
// would fall through to `detectAppearance([], [])` and guess from an empty colour set.
class PlainTextTheme extends Theme {
  constructor() {
    super(EMPTY_FOREGROUND_COLOR_TOKENS, EMPTY_BACKGROUND_COLOR_TOKENS, "truecolor", {
      appearance: "dark",
    });
  }

  override fg(...[, text]: Parameters<Theme["fg"]>): string { return text; }
  override bg(...[, text]: Parameters<Theme["bg"]>): string { return text; }
  override bold(text: string): string { return text; }
  override italic(text: string): string { return text; }
  override underline(text: string): string { return text; }
  override inverse(text: string): string { return text; }
  override strikethrough(text: string): string { return text; }
  override getFgAnsi(): string { return ""; }
  override getBgAnsi(): string { return ""; }
  override getThinkingBorderColor(): (text: string) => string {
    return (text) => text;
  }
  override getBashModeBorderColor(): (text: string) => string { return (text) => text; }

  // 0.99.2 added these three members and they are the reason a complete `super()` is not enough on
  // its own. Left un-overridden, `style()` splices pre-computed escapes from the base's token table
  // (`theme.js:187-200`) and `colors` fills every token with the terminal's guessed default
  // (`theme.js:166-186`) — real ANSI reaching an object whose contract says the web UI owns styling.
  override style(text: string): string { return text; }
  override get appearance(): Theme["appearance"] { return "dark"; }
  // The declared type claims every token is present, but the base only ever populates the table
  // with *concrete* (non-`""`) tokens, so for an all-`""` record it is genuinely empty. Narrowing
  // to the truthful shape is the one cast this class keeps, and it describes upstream, not us.
  override get colors(): Theme["colors"] {
    return {} as Theme["colors"];
  }
}

const PLAIN_TEXT_THEME = new PlainTextTheme();
const CUSTOM_UI_KEYBINDINGS = new TuiKeybindingsManager(TUI_KEYBINDINGS);

/** 把请求的编码工具名 + 全部扩展/包工具合并为活动工具集（caller 启动会话时复用）。 */
export function withExtensionTools(session: AgentSessionLike, toolNames: string[]): string[] {
  if (toolNames.length === 0) return [];

  const codingToolNames = new Set(CODING_TOOL_NAMES);
  const extensionToolNames = session
    .getAllTools()
    .map((t) => t.name)
    .filter((name) => !codingToolNames.has(name));

  return [...new Set([...toolNames, ...extensionToolNames])];
}

// ============================================================================
// AgentSessionWrapper
// Wraps AgentSession with the same interface the rest of the app expects
// ============================================================================

export class AgentSessionWrapper {
  private listeners: EventListener[] = [];
  private pendingUiResponses = new Map<string, PendingUiResponse>();
  private pendingUiRequests = new Map<string, AgentEvent>();
  private activeCustomUis = new Map<string, ActiveCustomUi>();
  private extensionStatuses = new Map<string, string>();
  private extensionWidgets = new Map<string, ExtensionWidgetItem>();
  private promptRunning = false;
  private extensionsBound = false;
  private extensionBindingPromise: Promise<void> | null = null;
  private extensionBindingError: unknown = null;
  private forceEmptySystemPrompt = false;
  /**
   * The live switch the forced-empty-system-prompt extension reads on every
   * `before_agent_start`. Created per wrapper so two sessions never share state;
   * `caller.ts` seeds the matching extension through this field.
   */
  readonly forcedEmptySystemPromptSwitch: ForcedEmptySystemPromptSwitch;
  private unsubscribe: (() => void) | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private onDestroyCallback: (() => void) | null = null;
  private shutdownPromise: Promise<void> | null = null;
  private _alive = true;

  constructor(
    public readonly inner: AgentSessionLike,
    forcedEmptySystemPromptSwitch: ForcedEmptySystemPromptSwitch = { enabled: false },
    /**
     * 该会话的沙箱装配（ADR-0012 决策三：规则是**会话属性**）：RPC 面的 `{type:"bash"}`
     * 与工具面的同名覆盖定义用同一份 operations；未传 = 无人归属的会话（人类自己的会话）不沙箱。
     */
    private readonly bashContainment?: ContainedBash,
  ) {
    this.forcedEmptySystemPromptSwitch = forcedEmptySystemPromptSwitch;
  }

  get sessionId(): string {
    return this.inner.sessionId;
  }

  get sessionFile(): string {
    return this.inner.sessionFile ?? "";
  }

  get cwd(): string {
    return this.inner.sessionManager.getCwd();
  }

  isAlive(): boolean {
    return this._alive;
  }

  isRunning(): boolean {
    return this._alive && (this.promptRunning || this.inner.isStreaming || this.inner.isCompacting || this.inner.isBashRunning);
  }

  start(): void {
    this.unsubscribe = this.inner.subscribe((event: AgentEvent) => {
      if (event.type === "agent_end") {
        invalidateSessionListCache();
      }
      if (IDLE_RESET_EVENT_TYPES.has(event.type)) this.resetIdleTimer();
      this.emit(event);
      if (RUNNING_STATE_EVENT_TYPES.has(event.type)) notifyRunningChange();
    });
    this.resetIdleTimer();
    notifyRunningChange();
  }

  setForceEmptySystemPrompt(force: boolean): void {
    this.forceEmptySystemPrompt = force;
    this.applyForcedEmptySystemPrompt();
  }

  beginExtensionBinding(options: ExtensionBindingOptions = {}): void {
    void this.ensureExtensionsBound(options).catch((err) => {
      console.error("[worksplice] failed to dispatch session_start to extensions:", err instanceof Error ? err.message : err);
    });
  }

  async waitUntilReady(): Promise<void> {
    await this.waitForExtensionsBound();
  }

  private ensureExtensionsBound(options: ExtensionBindingOptions = {}): Promise<void> {
    if (options.forceEmptySystemPrompt) this.forceEmptySystemPrompt = true;
    if (this.extensionsBound) {
      this.applyForcedEmptySystemPrompt();
      return Promise.resolve();
    }
    if (this.extensionBindingPromise) return this.extensionBindingPromise;

    this.extensionBindingError = null;
    this.extensionBindingPromise = (async () => {
      if (!this._alive) return;
      const uiContext = this.createExtensionUiContext();
      if (typeof this.inner.bindExtensions === "function") {
        const bindExtensions = this.inner.bindExtensions as (bindings: {
          uiContext?: ExtensionUiContextLike;
          mode?: "rpc";
          commandContextActions?: ExtensionCommandContextActionsLike;
          shutdownHandler?: () => void;
          onError?: (error: { extensionPath: string; event: string; error: string }) => void;
        }) => Promise<void>;
        await bindExtensions.call(this.inner, {
          uiContext,
          mode: "rpc",
          commandContextActions: this.createExtensionCommandContextActions(),
          shutdownHandler: () => this.emit(asAgentEvent({
            type: "extension_ui_request",
            id: randomUUID(),
            method: "notify",
            notifyType: "warning",
            message: "Extension requested shutdown, but shutdown is not supported in worksplice.",
          })),
          onError: (error) => this.emit({
            type: "extension_error",
            extensionPath: error.extensionPath,
            event: error.event,
            error: error.error,
          }),
        });
      } else {
        this.inner.extensionRunner.setUIContext?.(uiContext, "rpc");
      }
      this.extensionsBound = true;
      this.applyForcedEmptySystemPrompt();
      console.log(`[worksplice] session_start dispatched to extensions for session ${this.inner.sessionId}`);
    })().catch((err) => {
      this.extensionBindingError = err;
      throw err;
    });

    return this.extensionBindingPromise;
  }

  private async waitForExtensionsBound(): Promise<void> {
    try {
      if (this.extensionBindingPromise) await this.extensionBindingPromise;
    } catch (err) {
      throw err instanceof Error ? err : new Error(String(err));
    }
    if (this.extensionBindingError) {
      throw this.extensionBindingError instanceof Error
        ? this.extensionBindingError
        : new Error(String(this.extensionBindingError));
    }
  }

  private shouldWaitForExtensions(type: string): boolean {
    return type === "prompt" || type === "steer" || type === "follow_up" || type === "get_commands";
  }

  private async withFinalRunningNotification<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } finally {
      this.resetIdleTimer();
      notifyRunningChange();
    }
  }

  /**
   * Keep the forced-empty-system-prompt extension's live switch in step with
   * `forceEmptySystemPrompt`.
   *
   * This used to write `this.inner.agent.state.systemPrompt = ""` directly. That
   * property is getter-only since 0.99.x, so the assignment threw
   * `TypeError: Cannot set property systemPrompt of #<Object> which has only a getter`
   * and took `POST /api/agent/new` with `toolNames: []` down with a 500. The empty
   * prompt is now produced by the extension's `before_agent_start` handler reading
   * `this.forcedEmptySystemPromptSwitch` (lib/rpc/forced-empty-system-prompt.ts);
   * all that is left here is to flip the switch.
   */
  private applyForcedEmptySystemPrompt(): void {
    this.forcedEmptySystemPromptSwitch.enabled = this.forceEmptySystemPrompt;
  }

  private emit(event: AgentEvent): void {
    for (const l of this.listeners) l(event);
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.isRunning()) {
        this.resetIdleTimer();
        return;
      }
      void this.shutdown().catch((error) => {
        console.error("[worksplice] failed to shut down idle session:", error instanceof Error ? error.message : error);
      });
    }, 10 * 60 * 1000);
  }

  private persistBashOnlySession(): void {
    const manager = this.inner.sessionManager;
    const sessionFile = manager.getSessionFile();
    if (!sessionFile || existsSync(sessionFile)) return;

    const header = manager.getHeader();
    if (!header) return;

    const content = [header, ...manager.getEntries()]
      .map((entry) => JSON.stringify(entry))
      .join("\n") + "\n";
    writeFileSync(sessionFile, content, { encoding: "utf8", flag: "wx" });

    // Pi normally delays the first flush until an assistant message exists.
    // A leading shell command has no assistant message, so mark this SDK
    // manager as flushed after writing its own generated entries.
    // SAFETY: `flushed` 是 SDK manager 内部的未导出状态位，用来阻止 pi 把自己再刷一遍；
    // 这里就是“手工把这份 manager 当成已刷过”的意图，无公开接口可替代。
    (manager as unknown as { flushed: boolean }).flushed = true;
    cacheSessionPath(this.inner.sessionId, sessionFile);
  }

  onEvent(listener: EventListener): () => void {
    this.listeners.push(listener);
    for (const event of this.pendingUiRequests.values()) listener(event);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i !== -1) this.listeners.splice(i, 1);
    };
  }

  onDestroy(cb: () => void): void {
    this.onDestroyCallback = cb;
  }

  async send(command: Record<string, unknown>): Promise<unknown> {
    this.resetIdleTimer();
    const type = command.type as string;
    if (this.shouldWaitForExtensions(type)) await this.waitForExtensionsBound();

    if (type === "prompt" || type === "steer" || type === "follow_up") {
      const imageError = validateAgentImages(command.images);
      if (imageError) throw new Error(imageError);
    }

    switch (type) {
      case "prompt": {
        if (this.inner.isBashRunning) {
          throw new Error("Cannot send a prompt while a shell command is running");
        }
        // Fire and forget — events come via subscribe
        const promptImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
        const streamingBehavior = command.streamingBehavior as "steer" | "followUp" | undefined;
        this.promptRunning = true;
        notifyRunningChange();
        this.inner.prompt(command.message as string, {
          ...(promptImages?.length ? { images: promptImages } : {}),
          ...(streamingBehavior ? { streamingBehavior } : {}),
          source: "rpc",
        }).then(() => {
          this.promptRunning = false;
          this.resetIdleTimer();
          if (!streamingBehavior) this.emit({ type: "prompt_done" });
          notifyRunningChange();
        }).catch((error) => {
          this.promptRunning = false;
          this.resetIdleTimer();
          invalidateSessionListCache();
          this.emit({
            type: "prompt_error",
            errorMessage: error instanceof Error ? error.message : String(error),
          });
          if (!streamingBehavior) this.emit({ type: "prompt_done" });
          notifyRunningChange();
        });
        return null;
      }

      case "abort":
        await this.withFinalRunningNotification(() => this.inner.abort());
        return null;

      case "get_state": {
        const model = this.inner.model;
        const contextUsage = this.inner.getContextUsage();
        return {
          sessionId: this.inner.sessionId,
          sessionFile: this.inner.sessionFile ?? "",
          isStreaming: this.inner.isStreaming,
          isPromptRunning: this.promptRunning,
          isBashRunning: this.inner.isBashRunning,
          isCompacting: this.inner.isCompacting,
          autoCompactionEnabled: this.inner.autoCompactionEnabled,
          autoRetryEnabled: this.inner.autoRetryEnabled,
          model: model ? { id: model.id, provider: model.provider } : undefined,
          messageCount: 0,
          pendingMessageCount: this.inner.pendingMessageCount,
          queuedMessages: {
            steering: [...this.inner.getSteeringMessages()],
            followUp: [...this.inner.getFollowUpMessages()],
          },
          contextUsage: contextUsage
            ? { percent: contextUsage.percent, contextWindow: contextUsage.contextWindow, tokens: contextUsage.tokens }
            : null,
          systemPrompt: this.inner.agent.state?.systemPrompt ?? "",
          thinkingLevel: this.inner.agent.state?.thinkingLevel ?? "off",
          extensionStatuses: this.getExtensionStatuses(),
          extensionWidgets: this.getExtensionWidgets(),
          // 沙箱状态（ADR-0012 决策五）：`null` = 无人归属的会话（不沙箱）；
          // `available: false` 时档位展示要能解释「本平台无沙箱 ⇒ 该档位实际不含 bash」。
          bashContainment: this.bashContainment ? containmentStatus(this.bashContainment.resolution) : null,
        };
      }

      case "set_model": {
        const { provider, modelId } = command as { provider: string; modelId: string };
        let model = this.inner.modelRuntime.getModel(provider, modelId);
        if (!model) {
          await this.inner.modelRuntime.refresh({ allowNetwork: false });
          model = this.inner.modelRuntime.getModel(provider, modelId);
        }
        if (!model) throw new Error(`Model not found: ${provider}/${modelId}`);
        await this.inner.setModel(model);
        // 0.84.3+ 的 setModel 不再写全局默认（docs/spike-b2-persist.md §6.1）——
        // 显式写 SettingsManager，不用 `{persist:true}`（它会顺手改 enabledModels）。
        this.inner.settingsManager.setDefaultModelAndProvider(model.provider, model.id);
        await this.inner.settingsManager.flush();
        invalidateModelsCache();
        invalidateSessionListCache();
        return { id: model.id, provider: model.provider };
      }

      case "fork": {
        if (this.inner.isBashRunning) {
          throw new Error("Cannot fork while a shell command is running");
        }
        const entryId = command.entryId as string;
        const sessionManager = this.inner.sessionManager;
        const currentSessionFile = this.inner.sessionFile;

        if (!sessionManager.isPersisted()) return { cancelled: true };
        if (!currentSessionFile) throw new Error("Persisted session is missing a session file");

        const entry = sessionManager.getEntry(entryId);
        if (!entry) throw new Error("Invalid entry ID for forking");

        const sessionDir = sessionManager.getSessionDir();
        let newSessionFile: string;

        if (!entry.parentId) {
          // Fork before the first message: create an empty session linked to this one
          const newManager = SessionManager.create(sessionManager.getCwd(), sessionDir);
          newManager.newSession({ parentSession: currentSessionFile });
          newSessionFile = newManager.getSessionFile() as string;
        } else {
          // Fork after some history: copy path up to (but not including) the fork point
          const sourceManager = SessionManager.open(currentSessionFile, sessionDir);
          const forkedPath = sourceManager.createBranchedSession(entry.parentId);
          if (!forkedPath) throw new Error("Failed to create forked session");
          newSessionFile = forkedPath;
        }

        const newSessionId = SessionManager.open(newSessionFile, sessionDir).getSessionId();
        cacheSessionPath(newSessionId, newSessionFile);
        invalidateSessionListCache();
        await this.shutdown();
        return { cancelled: false, newSessionId };
      }

      case "navigate_tree": {
        if (this.inner.isBashRunning) {
          throw new Error("Cannot navigate while a shell command is running");
        }
        const result = await this.inner.navigateTree(command.targetId as string, {});
        return { cancelled: result.cancelled };
      }

      case "set_thinking_level": {
        const level = command.level as string;
        this.inner.setThinkingLevel(level);
        // setThinkingLevel clamps xhigh→high for models where supportsXhigh()===false.
        // If the model has DeepSeek thinking compat (reasoningEffortMap maps xhigh→max),
        // force the state back so the compat layer can use it correctly.
        if (level === "xhigh" && (this.inner.model as { compat?: { thinkingFormat?: string } } | null)?.compat?.thinkingFormat === "deepseek" && this.inner.agent?.state) {
          this.inner.agent.state.thinkingLevel = "xhigh";
        }
        // 生效值，从 setter 与 DeepSeek 修正都跑完之后的状态读——写请求值 `level`
        // 会复现 spike §4.4 STEP 3c 实测到的「全局默认落成当前模型用不了的档位」。
        // `?? "off"` 与 get_state 分支同一兜底：state 缺失时别把 undefined 写进设置。
        this.inner.settingsManager.setDefaultThinkingLevel(
          (this.inner.agent?.state?.thinkingLevel ?? "off") as ThinkingLevel,
        );
        await this.inner.settingsManager.flush();
        invalidateSessionListCache();
        return null;
      }

      case "compact": {
        try {
          return await this.withFinalRunningNotification(() =>
            this.inner.compact(command.customInstructions as string | undefined)
          );
        } finally {
          invalidateSessionListCache();
        }
      }

      case "set_session_name": {
        const name = (command.name as string | undefined)?.trim();
        if (!name) throw new Error("Session name cannot be empty");
        this.inner.setSessionName(name);
        invalidateSessionListCache();
        return null;
      }

      case "get_session_stats": {
        return {
          ...this.inner.getSessionStats(),
          sessionName: this.inner.sessionManager.getSessionName(),
        };
      }

      case "get_last_assistant_text": {
        return { text: this.inner.getLastAssistantText() ?? "" };
      }

      case "get_last_assistant_error": {
        // D1：pi SDK 对模型/API 报错不 reject prompt()——事件流照发 prompt_done、
        // getLastAssistantText() 拿到空文本，真实原因只落在末条 assistant message 的
        // stopReason/errorMessage 上。这条只读命令只是把它取出来，供 agent-loop 写进
        // round_logs.reason（可观测面板看得见「为什么失败」）。
        // 选取口径与 getLastAssistantText() 对齐（跳过 aborted 且无内容的条目）：
        // 不改变后者的语义，也不影响其既有消费方。
        // SAFETY: `AgentSessionLike` 未镜像 `messages`，但真实 AgentSession 必有（getLastAssistantText
        // 就读它）；缺省 `?? []` 让假 inner（只读测试）走「无消息 → null」而不是抛错。
        const messages =
          (this.inner as unknown as { messages?: SessionMessageLike[] }).messages ?? [];
        const lastAssistant = [...messages]
          .reverse()
          .find(
            (message) =>
              message.role === "assistant" &&
              !(message.stopReason === "aborted" && (message.content?.length ?? 0) === 0),
          );
        return {
          stopReason: lastAssistant?.stopReason ?? null,
          errorMessage: lastAssistant?.errorMessage ?? null,
        };
      }

      case "set_auto_compaction": {
        this.inner.setAutoCompactionEnabled(command.enabled as boolean);
        return null;
      }

      case "clear_queue": {
        // Full clear only: pi has no single-item dequeue, and clear+requeue
        // races against the agent loop pulling messages mid-flight.
        return this.inner.clearQueue();
      }

      case "steer": {
        const steerImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
        await this.inner.steer(command.message as string, steerImages?.length ? steerImages : undefined);
        return null;
      }

      case "follow_up": {
        const followImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
        await this.inner.followUp(command.message as string, followImages?.length ? followImages : undefined);
        return null;
      }

      case "get_tools": {
        const all: ToolInfo[] = this.inner.getAllTools();
        const active = new Set<string>(this.inner.getActiveToolNames());
        return all.map((t) => ({
          name: t.name,
          description: t.description,
          active: active.has(t.name),
        }));
      }

      case "get_commands": {
        const commands: SlashCommandInfo[] = [];
        for (const registered of this.inner.extensionRunner.getRegisteredCommands()) {
          commands.push({
            name: registered.invocationName,
            description: registered.description,
            source: "extension",
            sourceInfo: registered.sourceInfo,
          });
        }
        for (const template of this.inner.promptTemplates) {
          commands.push({
            name: template.name,
            description: template.description,
            source: "prompt",
            sourceInfo: template.sourceInfo,
          });
        }
        for (const skill of this.inner.resourceLoader.getSkills().skills) {
          commands.push({
            name: `skill:${skill.name}`,
            description: skill.description,
            source: "skill",
            sourceInfo: skill.sourceInfo,
          });
        }
        return { commands };
      }

      case "set_tools": {
        const toolNames = command.toolNames as string[];
        this.setForceEmptySystemPrompt(toolNames.length === 0);
        this.inner.setActiveToolsByName(withExtensionTools(this.inner, toolNames));
        this.applyForcedEmptySystemPrompt();
        return null;
      }

      case "reload": {
        await this.waitForExtensionsBound();
        this.extensionStatuses.clear();
        this.extensionWidgets.clear();
        this.syncProjectTrust();
        await this.inner.reload();
        if (typeof this.inner.bindExtensions !== "function") {
          this.inner.extensionRunner.setUIContext?.(this.createExtensionUiContext(), "rpc");
        }
        this.applyForcedEmptySystemPrompt();
        invalidateModelsCache();
        return { success: true };
      }

      case "abort_compaction": {
        this.inner.abortCompaction();
        return null;
      }

      case "extension_ui_response": {
        this.resolveExtensionUiResponse(command as ExtensionUiResponse);
        return null;
      }

      case "extension_ui_input": {
        this.handleExtensionUiInput(command.id as string, command.data as string);
        return null;
      }

      case "set_auto_retry": {
        this.inner.setAutoRetryEnabled(command.enabled as boolean);
        return null;
      }

      case "bash": {
        if (this.promptRunning || this.inner.isStreaming || this.inner.isCompacting || this.inner.isBashRunning) {
          throw new Error("Cannot run a shell command while the session is busy");
        }
        const execution = this.inner.executeBash(
          command.command as string,
          undefined,
          {
            excludeFromContext: command.excludeFromContext as boolean | undefined,
            // 人类 `!bash` 在**成员会话**里同样进沙箱（ADR-0012 决策三：规则是会话属性）；
            // 无人归属的会话没有这份装配，走 pi 的默认本地实现。
            ...(this.bashContainment ? { operations: this.bashContainment.operations } : {}),
          },
        );
        notifyRunningChange();
        try {
          const result = await execution;
          this.persistBashOnlySession();
          return result;
        } finally {
          this.resetIdleTimer();
          invalidateSessionListCache();
          notifyRunningChange();
        }
      }

      case "abort_bash": {
        this.inner.abortBash();
        return null;
      }

      default:
        throw new Error(`Unsupported command: ${type}`);
    }
  }

  destroy(): void {
    if (!this._alive) return;
    this._alive = false;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.inner.isBashRunning) this.inner.abortBash();
    this.unsubscribe?.();
    for (const pending of this.pendingUiResponses.values()) pending.cancel();
    for (const id of Array.from(this.activeCustomUis.keys())) this.closeCustomUi(id, undefined);
    this.pendingUiResponses.clear();
    this.pendingUiRequests.clear();
    try {
      this.inner.dispose();
    } finally {
      try {
        this.onDestroyCallback?.();
      } finally {
        notifyRunningChange();
      }
    }
  }

  async shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    if (!this._alive) return;

    this.shutdownPromise = (async () => {
      try {
        try {
          await this.waitForExtensionsBound();
        } catch (error) {
          console.error(
            "[worksplice] extension binding failed before session shutdown:",
            error instanceof Error ? error.message : error,
          );
        }
        await this.inner.extensionRunner.emit?.({ type: "session_shutdown", reason: "quit" });
      } finally {
        this.destroy();
      }
    })();
    return this.shutdownPromise;
  }

  private resolveExtensionUiResponse(response: ExtensionUiResponse): void {
    const pending = this.pendingUiResponses.get(response.id);
    if (!pending) return;
    pending.resolve(response);
  }

  private getExtensionStatuses(): Array<{ key: string; text: string }> {
    return Array.from(this.extensionStatuses, ([key, text]) => ({ key, text }));
  }

  private getExtensionWidgets(): ExtensionWidgetItem[] {
    return Array.from(this.extensionWidgets.values());
  }

  private getCustomUiWidth(options: unknown): number {
    if (!options || typeof options !== "object") return DEFAULT_CUSTOM_UI_COLUMNS;
    const overlayOptions = (options as { overlayOptions?: unknown }).overlayOptions;
    const resolved = typeof overlayOptions === "function" ? overlayOptions() : overlayOptions;
    if (!resolved || typeof resolved !== "object") return DEFAULT_CUSTOM_UI_COLUMNS;
    const width = (resolved as { width?: unknown }).width;
    return typeof width === "number" && Number.isFinite(width)
      ? Math.max(40, Math.min(140, Math.round(width)))
      : 92;
  }

  private emitCustomUiRender(id: string, custom: ActiveCustomUi): void {
    let lines: string[];
    try {
      lines = custom.component.render(custom.width);
    } catch (error) {
      lines = [`Extension custom UI render failed: ${error instanceof Error ? error.message : String(error)}`];
    }
    const event = asAgentEvent({
      type: "extension_ui_request",
      id,
      method: "custom",
      lines,
    });
    this.pendingUiRequests.set(id, event);
    this.emit(event);
  }

  private closeCustomUi(id: string, value: unknown): void {
    const custom = this.activeCustomUis.get(id);
    if (!custom || custom.settled) return;
    custom.settled = true;
    this.activeCustomUis.delete(id);
    this.pendingUiRequests.delete(id);
    try {
      custom.component.dispose?.();
    } catch {
      // Ignore dispose errors from extension UI components.
    }
    this.emit(asAgentEvent({
      type: "extension_ui_request",
      id,
      method: "custom",
      lines: [],
      closed: true,
    }));
    custom.resolve(value);
  }

  private handleExtensionUiInput(id: string, data: string): void {
    const custom = this.activeCustomUis.get(id);
    if (!custom || typeof data !== "string") return;
    try {
      custom.component.handleInput?.(data);
      if (this.activeCustomUis.has(id)) this.emitCustomUiRender(id, custom);
    } catch (error) {
      this.closeCustomUi(id, undefined);
      this.emit({
        type: "extension_error",
        extensionPath: `custom-ui:${id}`,
        event: "custom_ui_input",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private requestExtensionCustomUi<T>(
    factory: unknown,
    options?: unknown,
  ): Promise<T> {
    if (typeof factory !== "function") return Promise.resolve(undefined as T);

    const id = randomUUID();
    const width = this.getCustomUiWidth(options);

    return new Promise<T>((resolve) => {
      let completed = false;
      const tui = createHeadlessCustomUiTui(
        () => {
          const custom = this.activeCustomUis.get(id);
          if (custom) this.emitCustomUiRender(id, custom);
        },
        width,
      );
      const finish = (value: T) => {
        if (completed) return;
        completed = true;
        resolve(value);
      };
      const done = (value: T) => {
        if (this.activeCustomUis.has(id)) {
          this.closeCustomUi(id, value);
        } else {
          finish(value);
        }
      };

      Promise.resolve()
        .then(() => factory(tui, PLAIN_TEXT_THEME, CUSTOM_UI_KEYBINDINGS, done))
        .then((component) => {
          if (completed) {
            try {
              (component as CustomUiComponent | undefined)?.dispose?.();
            } catch {
              // Ignore dispose errors from a component completed before mounting.
            }
            return;
          }
          if (!component || typeof component !== "object" || typeof (component as CustomUiComponent).render !== "function") {
            finish(undefined as T);
            return;
          }
          const custom: ActiveCustomUi = {
            component: component as CustomUiComponent,
            width,
            resolve: (value) => finish(value as T),
            settled: false,
          };
          this.activeCustomUis.set(id, custom);
          this.emitCustomUiRender(id, custom);
        })
        .catch((error) => {
          if (completed) return;
          this.emit({
            type: "extension_error",
            extensionPath: `custom-ui:${id}`,
            event: "custom_ui",
            error: error instanceof Error ? error.message : String(error),
          });
          finish(undefined as T);
        });
    });
  }

  private requestExtensionUi<T>(
    request: ExtensionUiRequestBody,
    defaultValue: T,
    parseResponse: (response: ExtensionUiResponse) => T,
    timeout?: number,
    signal?: AbortSignal,
  ): Promise<T> {
    if (signal?.aborted) return Promise.resolve(defaultValue);

    const id = randomUUID();
    const fullRequest = {
      type: "extension_ui_request",
      id,
      ...request,
      ...(timeout ? { timeout, expiresAt: Date.now() + timeout } : {}),
    };

    return new Promise((resolve) => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        signal?.removeEventListener("abort", onAbort);
        this.pendingUiRequests.delete(id);
        this.pendingUiResponses.delete(id);
      };
      const settle = (value: T) => {
        cleanup();
        resolve(value);
      };
      const onAbort = () => settle(defaultValue);

      if (timeout) timeoutId = setTimeout(() => settle(defaultValue), timeout);
      signal?.addEventListener("abort", onAbort, { once: true });

      this.pendingUiRequests.set(id, fullRequest as AgentEvent);
      this.pendingUiResponses.set(id, {
        resolve: (response) => settle(parseResponse(response)),
        cancel: () => settle(defaultValue),
      });
      this.emit(fullRequest as AgentEvent);
    });
  }

  private createExtensionUiContext(): ExtensionUiContextLike {
    return {
      select: (title, options, opts) => this.requestExtensionUi(
        { method: "select", title, options, ...(opts?.timeout ? { timeout: opts.timeout } : {}) },
        undefined,
        (response) => "value" in response ? response.value : undefined,
        opts?.timeout,
        opts?.signal,
      ),
      confirm: (title, message, opts) => this.requestExtensionUi(
        { method: "confirm", title, message, ...(opts?.timeout ? { timeout: opts.timeout } : {}) },
        false,
        (response) => "confirmed" in response ? response.confirmed : false,
        opts?.timeout,
        opts?.signal,
      ),
      input: (title, placeholder, opts) => this.requestExtensionUi(
        { method: "input", title, ...(placeholder !== undefined ? { placeholder } : {}), ...(opts?.timeout ? { timeout: opts.timeout } : {}) },
        undefined,
        (response) => "value" in response ? response.value : undefined,
        opts?.timeout,
        opts?.signal,
      ),
      editor: (title, prefill, opts) => this.requestExtensionUi(
        { method: "editor", title, ...(prefill !== undefined ? { prefill } : {}), ...(opts?.timeout ? { timeout: opts.timeout } : {}) },
        undefined,
        (response) => "value" in response ? response.value : undefined,
        opts?.timeout,
        opts?.signal,
      ),
      notify: (message, type) => {
        this.emit(asAgentEvent({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "notify",
          message,
          notifyType: type,
        }));
      },
      onTerminalInput: () => () => {},
      setStatus: (key, text) => {
        if (text === undefined) this.extensionStatuses.delete(key);
        else this.extensionStatuses.set(key, text);
        this.emit(asAgentEvent({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "setStatus",
          statusKey: key,
          statusText: text,
        }));
      },
      setWorkingMessage: () => {},
      setWorkingVisible: () => {},
      setWorkingIndicator: () => {},
      setHiddenThinkingLabel: () => {},
      setWidget: (key, content, options) => {
        if (content !== undefined && !Array.isArray(content)) return;
        if (content === undefined) {
          this.extensionWidgets.delete(key);
        } else {
          this.extensionWidgets.set(key, {
            key,
            lines: content,
            placement: options?.placement ?? "aboveEditor",
          });
        }
        this.emit(asAgentEvent({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "setWidget",
          widgetKey: key,
          widgetLines: content,
          widgetPlacement: options?.placement,
        }));
      },
      setFooter: () => {},
      setHeader: () => {},
      setTitle: (title) => {
        this.emit(asAgentEvent({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "setTitle",
          title,
        }));
      },
      custom: <T = unknown>(factory: unknown, options?: unknown) => this.requestExtensionCustomUi<T>(factory, options),
      pasteToEditor: (text) => {
        this.emit(asAgentEvent({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "set_editor_text",
          text,
        }));
      },
      setEditorText: (text) => {
        this.emit(asAgentEvent({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "set_editor_text",
          text,
        }));
      },
      getEditorText: () => "",
      addAutocompleteProvider: () => {},
      setEditorComponent: () => {},
      getEditorComponent: () => undefined,
      get theme() { return PLAIN_TEXT_THEME; },
      getAllThemes: () => [],
      getTheme: () => undefined,
      setTheme: () => ({ success: false, error: "Theme switching is not supported in worksplice extension UI yet" }),
      getToolsExpanded: () => false,
      setToolsExpanded: () => {},
    };
  }

  private createExtensionCommandContextActions(): ExtensionCommandContextActionsLike {
    return {
      waitForIdle: async () => {
        const agent = this.inner.agent as { waitForIdle?: () => Promise<void> };
        await agent.waitForIdle?.();
      },
      newSession: async () => ({ cancelled: true }),
      fork: async () => ({ cancelled: true }),
      navigateTree: async (targetId, options) => {
        const result = await this.inner.navigateTree(targetId, { summarize: options?.summarize });
        return { cancelled: result.cancelled };
      },
      switchSession: async () => ({ cancelled: true }),
      reload: async () => {
        this.extensionStatuses.clear();
        this.extensionWidgets.clear();
        this.syncProjectTrust();
        await this.inner.reload({
          beforeSessionStart: () => {
            this.inner.extensionRunner.setUIContext?.(this.createExtensionUiContext(), "rpc");
          },
        });
        this.applyForcedEmptySystemPrompt();
      },
    };
  }

  private syncProjectTrust(): void {
    const status = getProjectTrustStatus(this.cwd, getAgentDir());
    this.inner.settingsManager.setProjectTrusted(status.trusted);
  }
}
