"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Search, X } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { Avatar } from "./Avatar";
import type { MessageSearchHit } from "@/lib/domain/collab";

const DEBOUNCE_MS = 250;

/** §6.4 命中时间展示（与 ChannelView 同一格式：今天只显示时分）。 */
const hitTime = (iso: string): string => {
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return isToday ? time : `${d.toLocaleDateString()} ${time}`;
};

/**
 * 全文搜索结果视图（§6.4）：中央区域替代 ChannelView。
 * - 输入框预填侧栏查询，可继续精化（250ms 防抖）；
 * - 结果 = 作者 + 归属 channel/thread + 命中上下文摘要（<mark> 高亮，服务端转义）；
 * - "打开消息"动作 = 深链 #c/<channelId>?m=<messageId>（AppShell 深链处理定位/展开线程）。
 *
 * 形态（票 09）= 上游 `ui_kits/app/app.css` 的 search view 块（逐字搬进 globals.css）：
 * `.search-view` 列 / `.search-scroll` + `.search-inner`（760px 内栏）/ `.search-field`
 * （`:focus-within` accent 环替换 ink 边框）/ 命中行 `.result*` / 空态 `.empty`。
 * facet 行与结果分组**不渲染**：本仓没有对应实体（§6.4 只锁消息正文、结果平铺、i18n 无
 * facet 键），`.facet-row` 只作词汇表——登记见 globals.css 段头与票 09 Answer。
 */
export function SearchView({
  initialQuery,
  onClose,
  onOpenMessage,
}: {
  initialQuery: string;
  onClose: () => void;
  onOpenMessage: (channelId: string, messageId: string) => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<MessageSearchHit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const run = useCallback((q: string) => {
    const trimmed = q.trim();
    if (!trimmed) {
      setResults(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    void fetch(`/api/search?q=${encodeURIComponent(trimmed)}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `search ${res.status}`);
        }
        const body = (await res.json()) as { results?: MessageSearchHit[] };
        setResults(body.results ?? []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 输入防抖搜索；初始查询挂载即跑一次
  useEffect(() => {
    const timer = setTimeout(() => run(query), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, run]);

  const open = (hit: MessageSearchHit) => {
    if (hit.channel) onOpenMessage(hit.channel.id, hit.id);
  };

  return (
    <div className="search-view">
      {/* 视图头（本仓 chrome：原型的搜索视图没有标题与关闭钮，按 ED-1…ED-10 外推）——
          标题 + `.icon-btn` 关闭（票 04 原语）；搜索框本体在下面的 `.search-inner` 里，
          焦点环因此落在字段容器上而不是这一行。 */}
      <header
        style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "var(--sp-6) var(--sp-9) var(--sp-4)",
          background: "var(--bg)",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font)",
            fontWeight: "var(--fw-heavy)",
            fontSize: "var(--fs-title)",
            letterSpacing: "var(--ls-snug)",
            color: "var(--fg)",
            whiteSpace: "nowrap",
          }}
        >
          {t("search.title")}
        </span>
        <button
          type="button"
          className="icon-btn"
          aria-label={t("search.close")}
          title={t("search.close")}
          onClick={onClose}
          style={{ marginLeft: "auto" }}
        >
          <X size={15} />
        </button>
      </header>

      {/* 结果区：`.search-scroll` 承载滚动，`.search-inner` 是原型那根 760px 内栏 */}
      <div className="search-scroll">
        <div className="search-inner">
          <div className="search-field">
            <Search
              size={16}
              strokeWidth={2}
              aria-hidden="true"
              style={{ color: "var(--faint)", flex: "0 0 auto" }}
            />
            <input
              ref={inputRef}
              type="search"
              value={query}
              placeholder={t("search.placeholder")}
              aria-label={t("search.placeholder")}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") run(query);
                if (e.key === "Escape") onClose();
              }}
            />
          </div>
          {results !== null && !loading && (
            <p style={{ margin: "var(--sp-4) 0 0", color: "var(--muted)", fontSize: "var(--fs-sm)" }}>
              {t("search.results", { count: String(results.length) })}
            </p>
          )}
          {loading ? (
            <div style={{ marginTop: "var(--sp-5)", color: "var(--faint)", fontSize: "var(--fs-body)" }}>
              …
            </div>
          ) : error ? (
            <div style={{ marginTop: "var(--sp-5)", color: "var(--error)", fontSize: "var(--fs-body)" }}>
              {t("search.error", { error })}
            </div>
          ) : results === null ? (
            <div className="empty">
              <Search size={26} strokeWidth={1.6} aria-hidden="true" />
              <b>{t("search.emptyHint")}</b>
            </div>
          ) : results.length === 0 ? (
            <div className="empty">
              <Search size={26} strokeWidth={1.6} aria-hidden="true" />
              <b>{t("search.noResults")}</b>
            </div>
          ) : (
            results.map((hit) => <SearchHitRow key={hit.id} hit={hit} onOpen={open} />)
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * 命中摘要的渲染（§6.4）：服务端 `buildSearchSnippet` 已把正文转义、只留 `<mark>` 高亮
 * （`lib/data/types.ts` 的 `escapeHtml`），这里把它还原成 JSX 节点——文本走 React 自己的转义
 * （不再有 `dangerouslySetInnerHTML` 这个注入 sink），只有裸 `<mark>` / `</mark>` 被认作高亮标记，
 * 其余标签一律当文本显示。
 *
 * 实体解码与 `HTML_ESCAPES` 一一对应，且是**单遍**替换：`&amp;lt;` 仍渲染成字面 `&lt;`
 * （与浏览器对同一份服务端 HTML 的行为一致），不做二次转义。
 */
const SNIPPET_ENTITIES: Record<string, string> = {
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&amp;": "&",
};

function decodeSnippetEntities(text: string): string {
  return text.replace(/&(?:lt|gt|quot|#39|amp);/g, (entity) => SNIPPET_ENTITIES[entity] ?? entity);
}

function renderSnippetMarkup(html: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let inMark = false;
  for (const [index, part] of html.split(/(<mark>|<\/mark>)/).entries()) {
    if (part === "<mark>") {
      inMark = true;
      continue;
    }
    if (part === "</mark>") {
      inMark = false;
      continue;
    }
    if (part === "") continue;
    const text = decodeSnippetEntities(part);
    nodes.push(inMark ? <mark key={index}>{text}</mark> : text);
  }
  return nodes;
}

/**
 * 命中行（`.result` 形态：卡片面 + 发丝 + hover 强化）。
 *
 * 导出供渲染级断言复用（`components/SearchView.test.mjs`）——命中只在异步 fetch 之后出现，
 * 静态渲染不可达；同票 06 的 `TaskCard` / `TaskBoard` 先例。
 */
export function SearchHitRow({
  hit,
  onOpen,
}: {
  hit: MessageSearchHit;
  onOpen: (hit: MessageSearchHit) => void;
}) {
  const { t } = useI18n();
  return (
    <div
      className="result"
      role="button"
      tabIndex={0}
      onClick={() => onOpen(hit)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(hit);
        }
      }}
      style={{
        cursor: hit.channel ? "pointer" : "default",
        opacity: hit.channel ? 1 : 0.6,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        {/* 命中作者头像：22px（`.avatar.sm` 消费 `--avatar-sm`）；名称缺失 → `?` 占位，
            `aria-label` 回退到 `hit.author_id`（`Avatar` 的 initials/label，票 04 迁入） */}
        <Avatar
          name={hit.author?.name}
          type={hit.author?.type}
          size="sm"
          colorKey={hit.author_id}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="r-top">
            <span style={{ color: "var(--accent)", fontWeight: "var(--fw-semi)" }}>
              {hit.author?.name ?? hit.author_id}
            </span>
            {hit.channel ? (
              <span>
                #<span style={{ fontFamily: "var(--mono)" }}>{hit.channel.name}</span>
              </span>
            ) : null}
            <span className="hash">#{hit.seq}</span>
            {hit.inThread && <span className="card-tag">{t("search.thread")}</span>}
            <span
              style={{
                marginLeft: "auto",
                color: "var(--faint)",
                fontSize: "var(--fs-mono-xs)",
              }}
            >
              {hitTime(hit.created_at)}
            </span>
          </div>
          {/* 命中上下文摘要：服务端已做 HTML 转义 + <mark> 高亮（§6.4），这里还原成 JSX */}
          <div className="r-snip">{renderSnippetMarkup(hit.snippet)}</div>
        </div>
        {hit.channel ? (
          <button
            type="button"
            className="btn btn-sm"
            style={{ flexShrink: 0 }}
            onClick={(e) => {
              e.stopPropagation();
              onOpen(hit);
            }}
          >
            {t("search.open")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
