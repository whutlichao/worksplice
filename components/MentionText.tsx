"use client";

import { useMemo } from "react";
import { useI18n } from "@/hooks/useI18n";
import { MarkdownBody } from "./MarkdownBody";
import { parseMentionTokens, type MentionMember, type MentionToken } from "@/lib/mention";

/**
 * 消息正文的 @mention 渲染：命中成员名的 token 黄底粗体高亮，
 * 可点击（agent → 右栏详情面板；人类 → 简介弹窗）；代码围栏/行内代码内的
 * token 与未知 @token 保持原文。无 members 时退化为普通 MarkdownBody。
 */
export function MentionText({
  content,
  members,
  onOpenMember,
}: {
  content: string;
  members?: MentionMember[];
  onOpenMember?: (token: MentionToken) => void;
}) {
  const { t } = useI18n();
  const tokens = useMemo(
    () => (members && members.length > 0 ? parseMentionTokens(content, members) : []),
    [content, members],
  );

  if (tokens.length === 0) {
    return <MarkdownBody>{content}</MarkdownBody>;
  }

  const parts: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const token of tokens) {
    if (token.start > last) {
      parts.push(<MarkdownBody key={key++}>{content.slice(last, token.start)}</MarkdownBody>);
    }
    parts.push(
      <button
        key={key++}
        type="button"
        title={t("mention.clickHint", { name: token.name })}
        onClick={(e) => {
          e.stopPropagation();
          onOpenMember?.(token);
        }}
        style={{
          display: "inline",
          padding: "0 2px",
          border: "1px solid transparent",
          borderRadius: "var(--r-sm)",
          background: "var(--accent-soft)",
          color: "var(--accent)",
          font: "inherit",
          fontSize: "inherit",
          fontWeight: 700,
          lineHeight: "inherit",
          cursor: "pointer",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = "var(--border-strong)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = "transparent";
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = "var(--border-strong)";
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = "transparent";
        }}
      >
        {content.slice(token.start, token.end)}
      </button>,
    );
    last = token.end;
  }
  if (last < content.length) {
    parts.push(<MarkdownBody key={key++}>{content.slice(last)}</MarkdownBody>);
  }
  return <>{parts}</>;
}
