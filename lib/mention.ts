/**
 * mention token 解析（纯函数，client/server 共用）。
 * 规则与 协作服务层同源（@名字 / @"带空格名字"，成员名全等匹配、大小写不敏感）；
 * 渲染侧额外跳过代码围栏与行内代码内的 @token，避免破坏 markdown 结构。
 */

import type { MemberStatus } from "./data/types.ts";

export interface MentionMember {
  id: string;
  name: string;
  type: "agent" | "human";
}

export interface MentionToken {
  start: number;
  end: number;
  name: string;
  memberId: string;
  isHuman: boolean;
}

const MENTION_RE = /@"([^"\n]+)"|@([^\s@,;:!?。，；：！？]+)/g;

/** 引用块行（Markdown blockquote）：引用里的旧 @ 不构成邀请。 */
function quoteLineRanges(content: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let offset = 0;
  for (const line of content.split("\n")) {
    if (/^\s*>/.test(line)) ranges.push([offset, offset + line.length]);
    offset += line.length + 1;
  }
  return ranges;
}

function blankRanges(content: string, ranges: Array<[number, number]>): string {
  const chars = content.split("");
  for (const [start, end] of ranges) {
    for (let index = start; index < Math.min(end, chars.length); index += 1) {
      if (chars[index] !== "\n") chars[index] = " ";
    }
  }
  return chars.join("");
}

/** 代码围栏（``` / ~~~，行首 trim 后匹配）与行内代码 `...` 的不可提及区间。 */
export function mentionExcludedRanges(content: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let fenceChar: string | null = null;
  let fenceStart = 0;
  let offset = 0;
  for (const line of content.split("\n")) {
    if (fenceChar) {
      const close = line.trim().match(new RegExp(`^${fenceChar}{3,}`));
      if (close) {
        ranges.push([fenceStart, offset + line.length + 1]);
        fenceChar = null;
      }
    } else {
      const open = line.trim().match(/^(`{3,}|~{3,})/);
      if (open) {
        fenceChar = open[1][0];
        fenceStart = offset;
      }
    }
    offset += line.length + 1;
  }
  if (fenceChar) ranges.push([fenceStart, content.length]);
  for (const match of content.matchAll(/`([^`\n]+)`/g)) {
    ranges.push([match.index, match.index + match[0].length]);
  }
  return ranges;
}

/**
 * 正文提及文本：去掉引用块、代码围栏与行内代码里的内容，只留下真正的正文。
 * 邀请判定（人类正文点名）与 must-respond 判定共用这一口径——引用旧 @、代码示例里的
 * @token 既不算点名，也不构成确定信号。
 */
export function bodyMentionText(content: string): string {
  const withoutQuotes = blankRanges(content, quoteLineRanges(content));
  return blankRanges(withoutQuotes, mentionExcludedRanges(withoutQuotes));
}

/** `@all` / `@everyone`：只认正文（引用块 / 代码里的不算）。 */
export function hasAllMention(content: string): boolean {
  return /@(?:all|everyone)\b/i.test(bodyMentionText(content));
}

function overlaps(start: number, end: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([rs, re]) => start < re && end > rs);
}

/**
 * 解析 content 中的成员提及：返回 token 位置数组（升序）。
 * 未知 @token、代码围栏/行内代码内的 token 一律不返回（保持原文渲染）。
 */
export function parseMentionTokens(
  content: string,
  members: MentionMember[],
): MentionToken[] {
  if (content.length === 0 || members.length === 0) return [];
  const byName = new Map<string, MentionMember>();
  for (const member of members) {
    if (!byName.has(member.name.toLowerCase())) byName.set(member.name.toLowerCase(), member);
  }
  const excluded = mentionExcludedRanges(content);
  const tokens: MentionToken[] = [];
  for (const match of content.matchAll(MENTION_RE)) {
    const start = match.index;
    const end = start + match[0].length;
    if (overlaps(start, end, excluded)) continue;
    const member = byName.get((match[1] ?? match[2]).toLowerCase());
    if (!member) continue;
    tokens.push({
      start,
      end,
      name: member.name,
      memberId: member.id,
      isHuman: member.type === "human",
    });
  }
  return tokens;
}

/** Composer @ 补全候选（§3.2）：仅频道成员 agent，按 agent 列表序；非成员不列入菜单（手输名字仍可穿透唤醒）。 */
export function composerMentionCandidates(
  agents: Array<{ id: string; name: string; status: MemberStatus }>,
  channelMemberIds: ReadonlySet<string>,
): Array<{ id: string; name: string; status: MemberStatus; joined: boolean }> {
  return agents
    .filter((a) => channelMemberIds.has(a.id))
    .map((a) => ({ id: a.id, name: a.name, status: a.status, joined: true }));
}
