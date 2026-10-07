/**
 * 回复序言修复（reply-json-leak）：模型偶发把 JSON 对象的开头 `{"` 输出成 `","` 或 `,"`。
 *
 * 实证形态（bob，2026-10-07T02:23:33Z 起共 22 次）：
 *   ```json","action":"reply","content":"…","onConflict":"resend"}
 *   ```json,"action":"reply","content":"…"}
 * 围栏剥掉后剩下的文本以 `","` / `,"` 开头，**没有** `{`——因此整串 `JSON.parse`
 * 失败、`extractJsonObject` 也找不到对象开头，解析链一路掉进兜底，把整段碎片当正文落库。
 *
 * 本模块是这条修复判定的**唯一实现**：`parseAgentAction`（loop.ts，防未来）与
 * `scripts/fix-reply-json-leak.mjs`（一次性存量清洗）都从这里取候选与校验，
 * 两处同源同形，不各写一份。
 *
 * 零依赖纯函数：不 import 任何模块，不碰 IO，只做「文本 → 修复候选 → 协议形状校验」。
 * 只认上表两种已实证形态（判据 `LEAK_PROLOGUE_PATTERN`），不对未知形态做猜测性修复。
 */

/** 已实证的两种坏序言开头：`","` 与 `,"`。`?` 覆盖「多一个引号」那一种。 */
export const LEAK_PROLOGUE_PATTERN = /^"?,"/;

/** 修复候选 = 坏序言还原成的正常 JSON 文本；形态不命中则 null。 */
export function repairJsonPrologue(text: string): string | null {
  const match = LEAK_PROLOGUE_PATTERN.exec(text);
  if (!match) return null;
  // `","` 去 3 字符、`,"` 去 2 字符，剩下的原样接在 `{"` 之后
  return `{"${text.slice(match[0].length)}`;
}

export interface RepairedReply {
  /** 候选 JSON.parse 后的完整对象：loop.ts 从这里取 onConflict / task / ops 等既有字段。 */
  readonly value: Record<string, unknown>;
  /** 协议 content 字段（非字符串则为 null）：清洗脚本的回填值，非字符串 = 无从回填。 */
  readonly content: string | null;
}

/**
 * 修复候选 → parse → 协议形状校验。三者任一不过就返回 null（调用方维持现状走兜底）。
 *
 * 形状判据与 parseAgentAction 里 extractJsonObject 分支**逐条同款**：对象、非数组、
 * `action` ∈ {reply, ignore}——只认协议形状，绝不把「碰巧以 `",` 开头的散文」当回复。
 */
export function parseRepairedReply(text: string): RepairedReply | null {
  const candidate = repairJsonPrologue(text);
  if (candidate === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const value = parsed as Record<string, unknown>;
  if (value.action !== "reply" && value.action !== "ignore") return null;
  return { value, content: typeof value.content === "string" ? value.content : null };
}