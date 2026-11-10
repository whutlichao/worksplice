"use client";

import { useMemo } from "react";
import { useI18n } from "@/hooks/useI18n";
import { MarkdownBody } from "./MarkdownBody";
import { parseMentionTokens, type MentionMember, type MentionToken } from "@/lib/mention";

/**
 * 消息正文的 @mention 渲染：命中成员名的 token 高亮成 `.mention` 按钮，
 * 可点击（agent → 右栏详情面板；人类 → 简介弹窗）；代码围栏/行内代码内的
 * token 与未知 @token 保持原文。无 members 时退化为普通 MarkdownBody。
 *
 * 实现口径（界面评审 B6）：**整段只跑一次 Markdown**。旧实现把正文按 token 边界切成
 * 多段、每段各自 `<MarkdownBody>`，于是 `**加粗**` / `- 列表项` 这类结构一旦跨过 token
 * 边界就被切断——真实库的 334 条含 mention 消息里，56 条会漏出字面 `**`、1 条丢 `<li>`。
 * 现在改为把每个 token 先替换成 markdown 链接 `[@name](#mention:<id>)`，由 MarkdownBody
 * 的 `a` 分支识别 `#mention:` 协议并渲染成同样的按钮；正文结构因此完整保留。
 */

/** 链接文本里的 Markdown 元字符转义：成员名含 `*` / `_` / 方括号时不能被当成格式标记。 */
function escapeMarkdownText(text: string): string {
  return text.replace(/[\\`*_[\]<>]/g, (char) => `\\${char}`);
}

/** 把命中 token 替换成 `#mention:` 链接（其余原文一字不动）。 */
export function tokenizeMentions(content: string, tokens: MentionToken[]): string {
  if (tokens.length === 0) return content;
  let output = "";
  let last = 0;
  for (const token of tokens) {
    output += content.slice(last, token.start);
    const text = escapeMarkdownText(content.slice(token.start, token.end));
    output += `[${text}](#mention:${token.memberId})`;
    last = token.end;
  }
  return output + content.slice(last);
}

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
  const markdown = useMemo(() => tokenizeMentions(content, tokens), [content, tokens]);
  const byId = useMemo(() => {
    const map = new Map<string, MentionToken>();
    for (const token of tokens) map.set(token.memberId, token);
    return map;
  }, [tokens]);

  if (tokens.length === 0) {
    return <MarkdownBody>{content}</MarkdownBody>;
  }

  return (
    <MarkdownBody
      onOpenMention={(memberId) => {
        const token = byId.get(memberId);
        if (token) onOpenMember?.(token);
      }}
      mentionTitle={(text) => t("mention.clickHint", { name: text.replace(/^@/, "") })}
    >
      {markdown}
    </MarkdownBody>
  );
}
