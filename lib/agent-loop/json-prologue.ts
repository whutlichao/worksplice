/**
 * 回复 JSON 泄漏修复（reply-json-leak）：**四档相互独立的放宽**，各有已实证形态。
 *
 * **第一档（票 01）**——模型偶发把 JSON 对象的开头 `{"` 输出成 `","` 或 `,"`：
 *   ```json","action":"reply","content":"…","onConflict":"resend"}
 *   ```json,"action":"reply","content":"…"}
 * 围栏剥掉后剩下的文本以 `","` / `,"` 开头，**没有** `{`——整串 `JSON.parse` 失败、
 * `extractJsonObject` 也找不到对象开头，解析链一路掉进兜底。判据 `LEAK_PROLOGUE_PATTERN`。
 *
 * **第二档（票 02）**——协议 JSON 的形状**写对了**，但字符串字面量里吐的是**裸控制字符**
 * （真实换行 / 制表 / …，码点 0x01–0x1f）而不是 JSON 要求的 `\n` / `\t` 转义：
 *   {"action":"reply","content":"第一行<裸 LF><裸 LF>第二行","onConflict":"revise"}
 * 整串 `JSON.parse` 报 `Bad control character in string literal`；`extractJsonObject` 反而
 * **取得到**平衡的 `{…}`（裸换行不影响括号配对），再 parse 报同一个错；第一档也不命中——
 * 整段 JSON 当正文落库。判据见 `repairRawControlChars`。
 *
 * **第三档（reply-json-leak-tail）**——协议 JSON 的字面量与转义都**写对了**，但对象的**最后一个
 * 成员名是空字符串**，没有冒号也没有值，紧接 `}` 闭合（live 实测 messages.id `fc9bc7f1…`）：
 *   {"action":"reply","content":"…用正确格式重提 #1 并在本串外汇报验证结果。",""}
 * `JSON.parse` 报 `Expected ':' after property name in JSON at position 1868`；
 * `extractJsonObject` 取得到平衡的 `{…}`（空键不影响括号配对），再 parse 报同一个错；
 * 前两档都不命中（不以 `","` / `,"` 开头，也没有裸控制字符）→ 整段 JSON 当正文落库，
 * 顺带把 `task` / `ops` 声明整段吞掉。判据见 `scanProtocolTail`。
 *
 * **第四档（reply-json-leak-unescaped-quote，issue #262）**——协议对象的结构、字面量与转义都写对了，
 * 但 `content` 字符串值里出现了**未转义的双引号**（模型把正文里的引号原样输出，没写成 `\"`）：
 *   {"action":"reply","content":"…能挡掉一半的"其实不用改代码"。…","task":{"number":5,"op":"complete"}}
 * `JSON.parse` 在正文里第一个引号处提前合上字符串（`Expected ',' or '}' after property value`），
 * 第一档不命中（有 `{"` 开头）、第二档也不命中（**一条裸控制字符都没有**——最新 live 样本正是
 * 这样，它连候选面都进不去）、第三档只认尾部空键 → 整段 JSON 当正文落库，`task` 被吞。
 * 判据见 `parseUnescapedQuoteReply`。
 *
 * 四档是**各自独立**的放宽，不共用判据：形态复发时重新评估一档，而不是扩大另一档的常量。
 * 第三档尤其不能借第二档的判据：后者的语义是「字符串字面量里有哪些字符要转义」（一个逐字符
 * 变换），前者是「对象尾部有没有一段结构上不合法的成员」——两件事的输入面与失败模式都不同。
 * 而且第三档必须同时回答**两个**问题（这段文本值得当候选看吗？这段文本能修吗？），
 * 第二档只有前者（改完能 parse 就是能修）——共用一个 `changed` 标记会把「只报告」误读成「能修」。
 * 第四档则必须**先定边界**再谈修复：`content` 的结尾引号是未知量，所以它的候选生成与采纳判定
 * 必然纠缠在一起（试边界 = 试 parse），这与前三档「先生成候选、再统一校验」不同，是本档的固有形态。
 * 四档共用的是**同一份形状校验口径**（`acceptProtocolObject`）与**同一个返回形状**
 * （`RepairedReply`），所以调用方只跨 `parseLeakedReply` 一个 seam。
 *
 * 本模块是这四条修复判定的**唯一实现**：`parseAgentAction`（loop.ts，防未来）与
 * `scripts/fix-reply-json-leak.mjs`（一次性存量清洗）都从这里取候选与校验，两处同源同形。
 * 零依赖纯函数：不 import 任何模块，不碰 IO，只做「文本 → 修复候选 → 协议形状校验」。
 */

// ----------------------------------------------------------------------------
// 第一档：坏序言（`","` / `,"`）
// ----------------------------------------------------------------------------

/** 第一档的已实证坏序言开头：`","` 与 `,"`。`?` 覆盖「多一个引号」那一种。 */
export const LEAK_PROLOGUE_PATTERN = /^"?,"/;

/** 第一档的修复候选 = 坏序言还原成的正常 JSON 文本；形态不命中则 null。 */
export function repairJsonPrologue(text: string): string | null {
  const match = LEAK_PROLOGUE_PATTERN.exec(text);
  if (!match) return null;
  // `","` 去 3 字符、`,"` 去 2 字符，剩下的原样接在 `{"` 之后
  return `{"${text.slice(match[0].length)}`;
}

// ----------------------------------------------------------------------------
// 三档共用的类型与校验
// ----------------------------------------------------------------------------

/** 命中的是哪一档。 */
export type ReplyLeakForm = "prologue" | "raw-control" | "trailing-key" | "unescaped-quote";

export interface RepairedReply {
  /** 命中档位。 */
  readonly form: ReplyLeakForm;
  /** 候选 JSON.parse 后的完整对象：loop.ts 从这里取 onConflict / task / ops 等既有字段。 */
  readonly value: Record<string, unknown>;
  /** 协议 content 字段（非字符串则为 null）：清洗脚本的回填值，非字符串 = 无从回填。 */
  readonly content: string | null;
}

/** 协议合法 action 集合：reply | ignore | conclude（parseAgentAction 的提取分支同源）。 */
export type ProtocolAction = "reply" | "ignore" | "conclude";
const PROTOCOL_ACTIONS: ReadonlySet<string> = new Set<ProtocolAction>([
  "reply",
  "ignore",
  "conclude",
]);

/** 严格判定协议 action：只接受字符串字面量，数组/对象等一律拒绝。 */
export function isProtocolAction(value: unknown): value is ProtocolAction {
  return typeof value === "string" && PROTOCOL_ACTIONS.has(value);
}

/**
 * 协议形状校验——**三档共用同一份口径**（与 parseAgentAction 里 extractJsonObject 分支
 * 逐条同款）：对象、非数组、`action` ∈ {reply, ignore, conclude}。绝不把「碰巧长得像」
 * 的文本当回复。
 */
function acceptProtocolObject(parsed: unknown): Record<string, unknown> | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const value = parsed as Record<string, unknown>;
  if (!isProtocolAction(value.action)) return null;
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

/** 第一档：坏序言 → 候选 → parse → 形状校验。 */
export function parseRepairedReply(text: string): RepairedReply | null {
  const candidate = repairJsonPrologue(text);
  if (candidate === null) return null;
  return parseCandidate(candidate, "prologue");
}

// ----------------------------------------------------------------------------
// 第二档：字符串字面量里的裸控制字符
// ----------------------------------------------------------------------------

/**
 * 裸控制字符码点区间（含端点），**唯一权威表示**——源码侧与脚本 SQL 侧都从它派生，
 * 免得两处对「哪些字符算裸控制字符」各说各话：
 * - JS 侧转义：下面的 `RAW_CONTROL_CHAR`
 * - 脚本 SQL 侧的 GLOB 字符类（`scripts/fix-reply-json-leak.mjs` 的 `CANDIDATE_SQL`）
 *
 * 起点是 1 而不是 0：SQLite 的 GLOB `[<U+0001>-<U+001F>]` 覆盖不了 NUL（其字符串处理在第一个
 * NUL 就截断），所以 JS 侧也一并排除——否则会出现「JS 能修、脚本永远捞不到」的单向不一致。
 */
export const RAW_CONTROL_MIN_CODE = 1;
export const RAW_CONTROL_MAX_CODE = 31;

/** 是否为 JSON 只认转义形态的裸控制字符（码点落在上面区间里）。 */
function isRawControlChar(ch: string): boolean {
  const code = ch.codePointAt(0) ?? -1;
  return code >= RAW_CONTROL_MIN_CODE && code <= RAW_CONTROL_MAX_CODE;
}

/** 能用 JSON 短转义表达的裸控制字符；其余（如 U+001F）走 `\u00XX`。 */
const CONTROL_ESCAPES: Record<string, string> = {
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
  "\b": "\\b",
  "\f": "\\f",
};

/** 单个裸控制字符的 JSON 转义（短转义优先，其余 `\u00XX`）——第二、第四档共用。 */
function escapeRawControlChar(ch: string): string {
  return (
    CONTROL_ESCAPES[ch] ?? `\\u${(ch.codePointAt(0) ?? 0).toString(16).padStart(4, "0")}`
  );
}

/**
 * 第二档的候选判据：`trim()` 后以 `{` 开头且以 `}` 结尾——先排掉绝大多数散文，
 * 避免对每段自然语言都做逐字符扫描。这是**便宜的前置筛**，不是采纳判据。
 */
function looksLikeProtocolObject(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith("{") && trimmed.endsWith("}");
}

/**
 * 第二档的修复候选：把**字符串字面量内**的裸控制字符转义掉，让该文本能被 `JSON.parse` 读回来。
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
    if (isRawControlChar(ch)) {
      changed = true;
      out += escapeRawControlChar(ch);
      continue;
    }
    out += ch;
  }
  return changed ? out : null;
}

/** 第二档：裸控制字符 → 候选 → parse → 形状校验。 */
function parseRawControlReply(text: string): RepairedReply | null {
  const candidate = repairRawControlChars(text);
  if (candidate === null) return null;
  return parseCandidate(candidate, "raw-control");
}

// ----------------------------------------------------------------------------
// 第三档：协议对象尾部的结构性缺陷
// ----------------------------------------------------------------------------

/**
 * RFC 8259 意义上的可忽略空白（空格 / 制表 / LF / CR）。
 *
 * 与脚本 SQL 侧的 `trim(content, char(32)||char(9)||char(10)||char(13))` 是**同一组字符**的两份表示
 * （那份不变量由 `fix-reply-json-leak.test.mjs` 的「SQL 候选捞取不漏斗」用例钉住：以空格开头的
 * 候选行只能靠 SQL 的 trim 捞到，trim 掉了就红）。这里刻意不用 JS `trim()`：它还会吃一堆
 * Unicode 空白，SQLite 的 trim 不吃，两边就分叉了。制表 / LF / CR 开头的行另已被第二档的
 * 裸控制字符 GLOB 捞到，所以这三字符上即使漂移也只会多捞不会漏斗。
 */
const PROTOCOL_WHITESPACE_EDGES = /^[ \t\n\r]+|[ \t\n\r]+$/g;

/** 去掉两端可忽略空白——本档的结构扫描都在这个切片上做（不是 JS `trim()`）。 */
function stripProtocolWhitespace(text: string): string {
  return text.replace(PROTOCOL_WHITESPACE_EDGES, "");
}

function isProtocolWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

/**
 * 第三档的结构判定结果。两种缺陷共用**同一个前置筛**（去空白后以 `{"` 开头，即
 * “协议对象形状”），但处理方式不同：
 * - `trailing-key`：可从结构上剥离的冗余空成员名尾，**可修**；
 * - `unclosed`：对象/字符串写到一半就断了，**只报告、绝不修**（补全括号或把残文当正文都是有损猜测）。
 */
type ProtocolTailDefect =
  | { readonly kind: "trailing-key"; readonly start: number; readonly end: number }
  | { readonly kind: "unclosed" };

/**
 * 从逗号位置往后看：`[空白] "" [空白] }` —— 即一个**只有名字、没有冒号与值**的成员。
 * 返回要剥离的区间 `[逗号, 空成员名闭合引号之外)`；不是这个形状则 null。
 *
 * ⚠️ 只在字面量之外调用（调用方已跟踪 inString）。合法 JSON 在字面量之外**永远**不会出现
 * `,` + `""` + `}` 这个序列（逗号后必须是成员名，而成员名必须跟冒号与值），所以它既能被
 * 无歧义地识别，也就能被无歧义地剥离——这正是本档的“凭什么是这一档”。
 */
function matchTrailingKeyAt(text: string, commaIndex: number): { start: number; end: number } | null {
  let i = commaIndex + 1;
  while (i < text.length && isProtocolWhitespace(text[i])) i += 1;
  if (text[i] !== '"' || text[i + 1] !== '"') return null;
  const end = i + 2;
  let j = end;
  while (j < text.length && isProtocolWhitespace(text[j])) j += 1;
  if (text[j] !== "}") return null;
  return { start: commaIndex, end };
}

/**
 * 第三档的结构扫描：拉一次字符级走查（跟踪字符串字面量与转义），同时回答两件事——
 * 字面量之外是否存在可剥离的冗余空成员名尾（取**文档序最后**那一个，即最贴近文本末尾的；
 * 嵌套对象里的同名缺陷同属本档——它们同样是 `,` + `""` + `}` 这种在合法 JSON 里不可能出现的序列），
 * 以及走到文本尽头时对象/字符串是否仍未闭合。
 *
 * 不做任何猜测性修复：不配平引号、不做通用尾部垃圾剥离、不补全截断。
 */
function scanProtocolTail(text: string): ProtocolTailDefect | null {
  const trimmed = stripProtocolWhitespace(text);
  if (!trimmed.startsWith('{"')) return null;
  let inString = false;
  let escaped = false;
  let depth = 0;
  let trailingKey: { start: number; end: number } | null = null;
  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{" || ch === "[") depth += 1;
    else if (ch === "}" || ch === "]") depth -= 1;
    else if (ch === ",") {
      const match = matchTrailingKeyAt(trimmed, i);
      if (match) trailingKey = match;
    }
  }
  if (trailingKey) return { kind: "trailing-key", ...trailingKey };
  if (inString || depth > 0) return { kind: "unclosed" };
  return null;
}

/**
 * 第三档的修复候选：把那段冗余空成员名尾（连同它前面的分隔逗号）拿掉，剩下原样。
 * 只剥离**结构上已证实**的那一段；是否真的采纳仍由 `parseCandidate` 的 parse + 形状校验决定。
 */
function repairTrailingKey(text: string): string | null {
  const defect = scanProtocolTail(text);
  if (defect === null || defect.kind !== "trailing-key") return null;
  const trimmed = stripProtocolWhitespace(text);
  return trimmed.slice(0, defect.start) + trimmed.slice(defect.end);
}

/** 第三档：尾部空成员名 → 候选 → parse → 形状校验。 */
function parseTrailingKeyReply(text: string): RepairedReply | null {
  const candidate = repairTrailingKey(text);
  if (candidate === null) return null;
  return parseCandidate(candidate, "trailing-key");
}

// ----------------------------------------------------------------------------
// 第四档：content 字符串值里未转义的双引号
// ----------------------------------------------------------------------------

/**
 * 第四档的前置扫描结果。`bodyStart` 之后的未转义双引号里**包含**真正的结尾引号——
 * 本档不知道它是哪一个，这正是要靠 parse 逐个试边界的原因。
 */
interface ContentLiteral {
  /** content 字符串值内部起点（紧接开引号之后）。 */
  readonly bodyStart: number;
  /** body 起所有未转义双引号的下标（升序）。 */
  readonly quotePositions: readonly number[];
}

/** 整段是不是合法 JSON（本档的守卫：合法 JSON 走原生解析路径，不是泄漏）。 */
function isWellFormedJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function skipProtocolWhitespace(text: string, from: number): number {
  let i = from;
  while (i < text.length && isProtocolWhitespace(text[i])) i += 1;
  return i;
}

/** 一个已闭合的字符串是不是根对象的 `"content"` 成员名（深度 1 + 名字对得上 + 后面紧跟 `:`）。 */
function isRootContentKey(text: string, nameStart: number, quoteIndex: number, depth: number): boolean {
  if (depth !== 1 || text.slice(nameStart, quoteIndex) !== "content") return false;
  return text[skipProtocolWhitespace(text, quoteIndex + 1)] === ":";
}

/**
 * 成员名闭合引号之后找值：字符串则返回其**内部起点**（紧接开引号之后），否则 -1。
 * -1 是「找到了 content、但它不是字符串」——本档到此为止（不是猜得出来的正文）。
 */
function contentValueStartAt(text: string, afterKeyQuote: number): number {
  const colon = skipProtocolWhitespace(text, afterKeyQuote);
  const literal = skipProtocolWhitespace(text, colon + 1);
  return text[literal] === '"' ? literal + 1 : -1;
}

/**
 * 找根对象上 `"content"` 的字符串值**内部起点**（紧接开引号之后）；没有则 -1。
 *
 * 只认 `depth === 1` 上的 `"content"`（嵌在 `ops` / `task` 里的同名字段不是回复正文），
 * 且后面必须紧跟 `:` 与一个开引号（content 不是字符串就不是本档）。
 * 「成员名」与「前一个成员的字符串值」靠那个冒号判据自然分开：值的闭合引号后面是 `,` 或 `}`，
 * 不是 `:`，所以不需要额外维护「现在该读键还是读值」的状态机。
 * 重复键取**第一个**（合法 JSON 走不到这里，见 `isWellFormedJson` 守卫）。
 */
function findContentValueStart(text: string): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let stringStart = -1;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') {
        inString = false;
        if (isRootContentKey(text, stringStart, i, depth)) {
          return contentValueStartAt(text, i + 1);
        }
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      stringStart = i + 1;
    } else if (ch === "{" || ch === "[") depth += 1;
    else if (ch === "}" || ch === "]") depth -= 1;
  }
  return -1;
}

/**
 * 第四档的前置筛：整段是**协议对象形状**（去两端可忽略空白后 `{"` 开头、`}` 结尾）
 * 且根对象上有 `"content"` 字符串值。不满足即 null（未闭合、非对象形状、content 不是字符串）。
 *
 * 含 U+0000 的文本一律不认，与第二档的裸控制字符区间从 0x01 起是**同一个理由**：
 * SQLite 的字符串处理在第一个 NUL 就截断、GLOB 字符类也覆盖不了它，若 JS 侧认它，
 * 就会出现「loop 能修、清洗脚本永远捞不到」的单向不一致。
 */
function scanContentLiteral(text: string): ContentLiteral | null {
  const trimmed = stripProtocolWhitespace(text);
  if (!trimmed.startsWith('{"') || !trimmed.endsWith("}")) return null;
  if (trimmed.includes("\u0000")) return null;
  const bodyStart = findContentValueStart(trimmed);
  if (bodyStart < 0) return null;
  const quotePositions: number[] = [];
  let escaped = false;
  for (let i = bodyStart; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (escaped) escaped = false;
    else if (ch === "\\") escaped = true;
    else if (ch === '"') quotePositions.push(i);
  }
  return { bodyStart, quotePositions };
}

/**
 * content 值的 body 转义：把 `[bodyStart, end)` 里的未转义双引号与裸控制字符就地转义。
 *
 * 只动这一段——边界之外的结构字段（`action` / `onConflict` / `task` / `ops` …）一字不改。
 * `\` 之后的下一个字符一律不看：那是既有的（合法或非法的）转义序列，本档不得二次转义
 * （否则 `\"xxx\"` 会被写成 `\\\"xxx\\\"`）。
 */
function escapeContentBody(body: string): string {
  let out = "";
  let escaped = false;
  for (const ch of body) {
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
      out += '\\"';
      continue;
    }
    if (isRawControlChar(ch)) {
      out += escapeRawControlChar(ch);
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * 第四档：content 值里的未转义双引号 → 候选 → parse → 形状校验。
 *
 * **边界是逐个试的**，因为 content 的结尾引号正是未知量：从早到晚取每一个未转义双引号当作结尾、
 * 把它之前的引号当作正文引号转义，然后要求整段重新 `JSON.parse` 成功且通过 `acceptProtocolObject`。
 * 「整个对象因此合法」这一条同时回答了两个问题：
 * - **太早的边界**（把正文切在半句）接不上后续结构，parse 失败；
 * - **太晚的边界**（把 `,"task":…}` / `,"onConflict":"…"` 吞进正文）会留下多余的闭合括号，
 *   parse 同样失败。
 * 因此不需要「优先保留后续协议成员」这类启发式：能 parse 的边界就是保留了后续协议成员的那个。
 * 早到晚的顺序保证万一有两处都成立，选的是**正文更短、协议成员更全**的那一个（结构字段优先
 * 留在结构里，不被吞进正文）。
 *
 * 三个硬条件（都是必要条件，不是启发式）：
 * - 整段已是合法 JSON 时**不修**：那是原生解析路径的活，本档只碰坏掉的文本；
 * - 整段必须是协议对象形状（见 `scanContentLiteral`）；
 * - 试的边界后面必须紧跟 `,` 或 `}`（JSON 语法决定对象里字符串值之后只能是这两个），
 *   据此跳过绝大多数中间引号，不做无谓 parse。
 *
 * 候选生成与采纳判定在这里必然同居（试边界 = 试 parse），与前三档「先生成候选、再统一校验」不同：
 * 本档的候选面（`isLeakedReplyCandidate`）只回答「值得报告吗」，边界仍只在 parse 成功时才确定。
 *
 * 已知边界（不猜，只按 JSON 语义取边界）：正文以**裸反斜杠**结尾时（如 Windows 路径 `C:\`），
 * 意图的闭合引号被那个反斜杠转义——JSON 语义上字符串并未结束。本档照 JSON 语义继续往后找可
 * parse 的边界，正文因此会吸收中间的成员序列（多数尾巴吸收后 parse 不过，直接返回 null）。
 * 这种形态本身就「无法确定意图」，拒绝与吸收同样任意；live 实测三条样本的正文都不以反斜杠结尾。
 */
function parseUnescapedQuoteReply(text: string): RepairedReply | null {
  const literal = scanContentLiteral(text);
  if (literal === null) return null;
  const trimmed = stripProtocolWhitespace(text);
  if (isWellFormedJson(trimmed)) return null;
  for (const end of literal.quotePositions) {
    const after = skipProtocolWhitespace(trimmed, end + 1);
    if (trimmed[after] !== "," && trimmed[after] !== "}") continue;
    const body = trimmed.slice(literal.bodyStart, end);
    const candidate = `${trimmed.slice(0, literal.bodyStart)}${escapeContentBody(body)}"${trimmed.slice(end + 1)}`;
    const repaired = parseCandidate(candidate, "unescaped-quote");
    if (repaired !== null) return repaired;
  }
  return null;
}

/**
 * 四档合一——`parseAgentAction` 与清洗脚本跨的就是这一个 seam：同一份形状校验、
 * 同一个返回形状，档位由 `RepairedReply.form` 带出。四档判据**各自独立**、按固定顺序判：
 * 前三档的顺序与行为一字未动，第四档排在最后（只在前三档都不成立时才被问到）。
 */
export function parseLeakedReply(text: string): RepairedReply | null {
  return (
    parseRepairedReply(text) ??
    parseRawControlReply(text) ??
    parseTrailingKeyReply(text) ??
    parseUnescapedQuoteReply(text)
  );
}

/**
 * 第四档的候选面：协议对象形状 + 根对象 `"content"` 是字符串值 + **整段不是合法 JSON**。
 *
 * 最后一条是本档与前几档最不一样的地方：合法 JSON 不进候选面（原生路径负责），只有坏掉的
 * 协议对象形状才值得报告。这里不包含「边界是否能 parse」这个采纳判据（那在
 * `parseUnescapedQuoteReply` 里），所以「进候选面 ≠ 可修」的区分在本档照旧成立。
 */
function isUnescapedQuoteCandidate(text: string): boolean {
  if (scanContentLiteral(text) === null) return false;
  return !isWellFormedJson(stripProtocolWhitespace(text));
}

/**
 * 文本是否落在**任一档的候选面**上（前置判据，不含修复采纳）。
 * 清洗脚本 SQL 里那份「捞候选」的条件与它是同一件事的两份表示，由测试钉住不变式
 * （JS 候选面必须被 SQL 全部捞到；SQL 多捞的只允许进 skipped）。
 *
 * ⚠️ 本函数回答的是**值不值得当候选**，不是**能不能修**：第三档把“未闭合尾”也算候选
 * （只报告不修），第四档把「协议对象形状 + content 是字符串 + 整段 parse 不了」当候选
 * （边界猜不出来就不修），所以 `isLeakedReplyCandidate(x) === true` 与
 * `parseLeakedReply(x) !== null` 不是同一件事。这个区分是本模块能否站住的关键（有独立用例钉住）。
 */
export function isLeakedReplyCandidate(text: string): boolean {
  return (
    LEAK_PROLOGUE_PATTERN.test(text) ||
    repairRawControlChars(text) !== null ||
    scanProtocolTail(text) !== null ||
    isUnescapedQuoteCandidate(text)
  );
}
