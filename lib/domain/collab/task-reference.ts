import { bodyMentionText } from "../../mention.ts";

/**
 * 「这条正文提到了哪些任务」的**共享纯判定**（票 #250 从 `handoff-trigger.ts` 抽出）。
 *
 * 两处消费方必须用同一份口径：
 * - `handoff-trigger.ts`（handoff 触发：唯一 `Task #N` 引用 ⇒ 叫全局首席分流）；
 * - `invitations.ts`（选人：涉及任务的消息**不归频道首席**，见 `selectChiefRecipient`）。
 *
 * 抽成独立模块是为了断开导入方向——`handoff-trigger` 已经 import `invitations`，
 * `invitations` 反向引用它会成环；本模块零依赖（只做文本解析，不碰 DB）。
 * 引用块 / 代码围栏 / 行内代码不算，与 @mention 共用 `bodyMentionText` 的正文口径。
 */

const TASK_REFERENCE_RE = /\bTask\s+#(\d+)\b/gi;

/** 正文里的 `Task #N` 引用（去重、升序）。 */
export function parseTaskReferenceNumbers(content: string): number[] {
  const body = bodyMentionText(content);
  const numbers = new Set<number>();
  for (const match of body.matchAll(TASK_REFERENCE_RE)) {
    const number = Number(match[1]);
    if (Number.isSafeInteger(number) && number > 0) numbers.add(number);
  }
  return [...numbers].sort((a, b) => a - b);
}

/** 正文是否涉及任务：任一条 `Task #N` 引用即算（任务创建事件的正文也带这个前缀）。 */
export function hasTaskReference(content: string): boolean {
  return parseTaskReferenceNumbers(content).length > 0;
}
