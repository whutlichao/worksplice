/**
 * 回复 JSON 泄漏修复（reply-json-leak）：**两档相互独立的放宽**，各有已实证形态。
 *
 * **第一形态（票 01）**——模型偶发把 JSON 对象的开头 `{"` 输出成 `","` 或 `,"`：
 *   ```json","action":"reply","content":"…","onConflict":"resend"}
 *   ```json,"action":"reply","content":"…"}
 * 围栏剥掉后剩下的文本以 `","` / `,"` 开头，**没有** `{`——整串 `JSON.parse` 失败、
 * `extractJsonObject` 也找不到对象开头，解析链一路掉进兜底。判据 `LEAK_PROLOGUE_PATTERN`。
 *
 * **第二形态（票 02）**——协议 JSON 的形状**写对了**，但字符串字面量里吐的是**裸控制字符**
 * （真实换行 / 制表 / …，码点 < 0x20）而不是 JSON 要求的 `\n` / `\t` 转义：
 *   {"action":"reply","content":"第一行<裸 LF><裸 LF>第二行","onConflict":"revise"}
 * 这一档下 `JSON.parse` 报 `Bad control character in string literal`；`extractJsonObject`
 * 反而**取得到**平衡的 `{…}`（裸换行不影响括号配对），再 parse 报同一个错；第一形态的
 * 序言档也不命中——三档全落空，整段 JSON 当正文落库。判据见 `repairRawControlChars`。
 *
 * 两档是**各自独立**的放宽，不共用判据：形态复发时重新评估一档，而不是扩大另一档的常量
 * （票 01 的既有纪律）。两档共用的是**同一份形状校验口径**（`acceptProtocolObject`）与
 * **同一个返回形状**（`RepairedReply`），所以调用方只跨 `parseLeakedReply` 一个 seam。
 *
 * 本模块是这两条修复判定的**唯一实现**：`parseAgentAction`（loop.ts，防未来）与
 * `scripts/fix-reply-json-leak.mjs`（一次性存量清洗）都从这里取候选与校验，
 * 两处同源同形，不各写一份。
 *
 * 零依赖纯函数：不 import 任何模块，不碰 IO，只做「文本 → 修复候选 → 协议形状校验」。
 * 只认上表两种已实证形态，不对未知形态做猜测性修复。
 */

/** 第一形态的已实证坏序言开头：`","` 与 `,"`。`?` 覆盖「多一个引号」那一种。 */
export const LEAK_PROLOGUE_PATTERN = /^"?,"/;

/** 修复候选 = 坏序言还原成的正常 JSON 文本；形态不命中则 null。 */
export function repairJsonPrologue(text: string): string | null {
  const match = LEAK_PROLOGUE_PATTERN.exec(text);
  if (!match) return null;
  // `","` 去 3 字符、`,"` 去 2 字符，剩下的原样接在 `{"` 之后
  return `{"${text.slice(match[0].length)}`;
}

/** 命中的是哪一档——报告里要说清（清洗脚本的 repaired / skipped 逐条带出）。 */
export type ReplyLeakForm = "prologue" | "raw-control";

export interface RepairedReply {
  /** 命中档位。 */
  readonly form: ReplyLeakForm;
  /** 候选 JSON.parse 后的完整对象：loop.ts 从这里取 onConflict / task / ops 等既有字段。 */
  readonly value: Record<string, unknown>;
  /** 协议 content 字段（非字符串则为 null）：清洗脚本的回填值，非字符串 = 无从回填。 */
  readonly content: string | null;
}

/**
 * 协议形状校验——**两档共用同一份口径**（与 parseAgentAction 里 extractJsonObject 分支
 * 逐条同款）：对象、非数组、`action` ∈ {reply, ignore}。绝不把「碰巧长得像」的文本当回复。
 */
function acceptProtocolObject(parsed: unknown): Record<string, unknown> | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const value = parsed as Record<string, unknown>;
  if (value.action !== "reply" && value.action !== "ignore") return null;
  return value;
}

/** 候选文本 → parse → 形状校验。parse 失败或形状不合协议即 null（调用方维持现状走兜底）。 */
function parseCandidate(candidate: string, form: ReplyLeakForm): RepairedReply | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return null;
  }
  const value = acceptProtocolObject(parsed);
  if (value === null) return null;
  return { form, value, content: typeof value.content === "string" ? value.content : null };
}

/** 第一形态：坏序言 → 候选 → parse → 形状校验。 */
export function parseRepairedReply(text: string): RepairedReply | null {
  const candidate = repairJsonPrologue(text);
  if (candidate === null) return null;
  return parseCandidate(candidate, "prologue");
}

// ----------------------------------------------------------------------------
// 第二形态：字符串字面量里的裸控制字符
// ----------------------------------------------------------------------------

/** JSON 只认转义形态的控制字符集合。 */
const RAW_CONTROL_CHAR = /^[\u0000-\u001f]$/;
/** 能用 JSON 短转义表达的裸控制字符；其余（如 U+001F）走 `\u00XX`。 */
const CONTROL_ESCAPES: Record<string, string> = {
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
  "\b": "\\b",
  "\f": "\\f",
};

/**
 * 第二形态的候选判据：`trim()` 后以 `{` 开头且以 `}` 结尾——先排掉绝大多数散文，
 * 避免对每段自然语言都做逐字符扫描。这是**便宜的前置筛**，不是采纳判据。
 */
function looksLikeProtocolObject(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith("{") && trimmed.endsWith("}");
}

/**
 * 第二形态的修复候选：把**字符串字面量内**的裸控制字符转义掉，让该文本能被 `JSON.parse` 读回来。
 *
 * 只动两处，别的都不碰：
 * - **只在字符串字面量内**动手。字面量外的裸换行（美化过的 JSON）本来就是合法空白，
 *   `JSON.parse` 自己会吃；顺手转义它属于「做了没被要求的事」。
 * - **`\` 之后的字符一律原样保留**：那是既有的（合法或非法的）转义序列，本档不改写既有转义语义
 *   （因此 `\n` 仍是字面转义、仍是真换行，不走这一档）。
 *
 * 本档**只管裸控制字符这一件事**，因此它天然救不回另一种坏法：字符串值里原本就未转义的双引号
 * （live 实测有 1 条，正文里是 Markdown 片段 `` `<link rel="stylesheet" href="tokens.css">` ``，
 * 模型把其中的 `"` 原样输出）。转义完裸控制字符后，JSON 仍在 `rel=` 之后被那个 `"` 提前合上，
 * `parse` 报 `Expected ',' or '}' after property value`——该候选落回 null，调用方维持整段兜底。
 * 这是**设计意图**，不是缺陷：为它做启发式引号配平属于「猜测性修复」，明确排除。
 *
 * 候选判据不成立时返回 null；文本里**根本没有**裸控制字符时也返回 null——后者说明它不属本档
 * （真若是合法 JSON，档① 已经吃掉了），保持本档窄而精确。
 */
function repairRawControlChars(text: string): string | null {
  if (!looksLikeProtocolObject(text)) return null;
  const trimmed = text.trim();
  let out = "";
  let inString = false;
  let escaped = false;
  let changed = false;
  for (const ch of trimmed) {
    if (!inString) {
      if (ch === '"') inString = true;
      out += ch;
      continue;
    }
    if (escaped) {
      escaped = false;
      out += ch;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      out += ch;
      continue;
    }
    if (ch === '"') {
      inString = false;
      out += ch;
      continue;
    }
    if (RAW_CONTROL_CHAR.test(ch)) {
      changed = true;
      out +=
        CONTROL_ESCAPES[ch] ??
        `\\u${(ch.codePointAt(0) ?? 0).toString(16).padStart(4, "0")}`;
      continue;
    }
    out += ch;
  }
  return changed ? out : null;
}

/** 第二形态：裸控制字符 → 候选 → parse → 形状校验。 */
function parseRawControlReply(text: string): RepairedReply | null {
  const candidate = repairRawControlChars(text);
  if (candidate === null) return null;
  return parseCandidate(candidate, "raw-control");
}

/**
 * 两档合一——`parseAgentAction` 与清洗脚本跨的就是这一个 seam：同一份形状校验、
 * 同一个返回形状，档位由 `RepairedReply.form` 带出。两档判据互不重叠
 * （第一形态要求开头没有 `{`，第二形态要求 `{`…`}`），顺序不影响结果。
 */
export function parseLeakedReply(text: string): RepairedReply | null {
  return parseRepairedReply(text) ?? parseRawControlReply(text);
}

/**
 * 文本是否落在**任一档的候选面**上（前置判据，不含 parse / 形状校验）。
 * 清洗脚本 SQL 里那份「捞候选」的增补条件与它是同一件事的两份表示，由测试钉住等价性。
 */
export function isLeakedReplyCandidate(text: string): boolean {
  return LEAK_PROLOGUE_PATTERN.test(text) || repairRawControlChars(text) !== null;
}
