"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
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

  const rowStyle = {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "10px 12px",
    background: "var(--surface)",
    border: `1px solid var(--border)`,
    boxShadow: "2px 2px 0 0 rgba(20, 17, 17, 0.4)",
  } as const;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* 搜索头：输入 + 关闭 */}
      <header
        style={{
          flexShrink: 0,
          padding: "14px 16px 10px",
          borderBottom: `1px solid var(--border)`,
          background: "var(--bg)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              fontFamily: "var(--font)",
              fontWeight: 800,
              fontSize: 18,
              letterSpacing: "-0.01em",
              color: "var(--fg)",
              whiteSpace: "nowrap",
            }}
          >
            {t("search.title")}
          </span>
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
            style={{
              flex: 1,
              minWidth: 0,
              height: "var(--control-h)",
              padding: "0 10px",
              background: "var(--surface)",
              color: "var(--fg)",
              border: `1px solid var(--border)`,
              boxShadow: "2px 2px 0 0 rgba(20, 17, 17, 0.35)",
              outline: "none",
              fontFamily: "var(--font)",
              fontSize: 13,
            }}
          />
          <button
            type="button"
            aria-label={t("search.close")}
            title={t("search.close")}
            onClick={onClose}
            style={{
              width: 32,
              height: "var(--control-h)",
              background: "var(--surface)",
              color: "var(--fg)",
              border: `1px solid var(--border)`,
              boxShadow: "2px 2px 0 0 rgba(20, 17, 17, 0.35)",
              cursor: "pointer",
              fontFamily: "var(--font)",
              fontWeight: 700,
              fontSize: 13,
              lineHeight: 1,
            }}
          >
            <X size={13} style={{ display: "block", margin: "auto" }} />
          </button>
        </div>
        {results !== null && !loading && (
          <p style={{ margin: "8px 0 0", color: "var(--muted)", fontSize: 12 }}>
            {t("search.results", { count: String(results.length) })}
          </p>
        )}
      </header>

      {/* 结果区 */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
        {loading ? (
          <div style={{ color: "var(--faint)", fontSize: 13 }}>…</div>
        ) : error ? (
          <div style={{ color: "var(--error)", fontSize: 13 }}>
            {t("search.error", { error })}
          </div>
        ) : results === null ? (
          <div style={{ color: "var(--faint)", fontSize: 13 }}>{t("search.emptyHint")}</div>
        ) : results.length === 0 ? (
          <div style={{ color: "var(--faint)", fontSize: 13 }}>
            {t("search.noResults")}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {results.map((hit) => (
              <div
                key={hit.id}
                role="button"
                tabIndex={0}
                onClick={() => open(hit)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    open(hit);
                  }
                }}
                style={{
                  ...rowStyle,
                  cursor: hit.channel ? "pointer" : "default",
                  opacity: hit.channel ? 1 : 0.6,
                }}
              >
                <Avatar
                  name={hit.author?.name}
                  type={hit.author?.type}
                  size="sm"
                  colorKey={hit.author_id}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      flexWrap: "wrap",
                      fontFamily: "var(--font)",
                      fontSize: 12,
                      fontWeight: 700,
                      color: "var(--muted)",
                    }}
                  >
                    <span style={{ color: "var(--fg)" }}>
                      {hit.author?.name ?? hit.author_id}
                    </span>
                    {hit.channel ? (
                      <span>
                        #<span style={{ fontFamily: "var(--mono)" }}>{hit.channel.name}</span>
                      </span>
                    ) : null}
                    <span style={{ fontFamily: "var(--mono)", color: "var(--faint)" }}>
                      #{hit.seq}
                    </span>
                    {hit.inThread && (
                      <span
                        style={{
                          padding: "1px 5px",
                          background: "var(--accent-soft)",
                          color: "var(--accent)",
                          border: `1px solid var(--border)`,
                          fontFamily: "var(--mono)",
                          fontSize: 10,
                        }}
                      >
                        {t("search.thread")}
                      </span>
                    )}
                    <span style={{ marginLeft: "auto", color: "var(--faint)", fontSize: 11 }}>
                      {hitTime(hit.created_at)}
                    </span>
                  </div>
                  {/* 命中上下文摘要：服务端已做 HTML 转义 + <mark> 高亮（§6.4） */}
                  <div
                    style={{
                      marginTop: 4,
                      fontSize: 13,
                      color: "var(--fg)",
                      lineHeight: 1.5,
                      wordBreak: "break-word",
                    }}
                    dangerouslySetInnerHTML={{ __html: hit.snippet }}
                  />
                </div>
                {hit.channel ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      open(hit);
                    }}
                    style={{
                      flexShrink: 0,
                      padding: "4px 8px",
                      background: "var(--accent-soft)",
                      color: "var(--fg)",
                      border: `1px solid var(--border)`,
                      boxShadow: "2px 2px 0 0 rgba(20, 17, 17, 0.4)",
                      cursor: "pointer",
                      fontFamily: "var(--font)",
                      fontWeight: 700,
                      fontSize: 11,
                    }}
                  >
                    {t("search.open")}
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
