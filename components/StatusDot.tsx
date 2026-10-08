"use client";

import type { MemberRow } from "@/lib/data/types";

/** 四态 → `.presence.{status}` 形态 + 该状态的语义 token（spec ED-10）。 */
const STATUS_DOT: Record<MemberRow["status"], { className: string; color: string }> = {
  online: { className: "presence online", color: "var(--online)" },
  working: { className: "presence working", color: "var(--working)" },
  error: { className: "presence error", color: "var(--error)" },
  offline: { className: "presence offline", color: "var(--offline)" },
};

/** §3.6 状态点四态：绿=在线、黄脉冲=干活、橙=出错、灰=离线。
 *  形态（7px 圆点、working 脉冲 1.5s、`reduce` 下停跳）在 globals.css 的 `.presence` class 块；
 *  颜色按状态内联——既有渲染面断言（app/globals.test.mjs T-D）断的就是 markup 里的语义 token。 */
export function StatusDot({ status }: { status: MemberRow["status"] }) {
  const style = STATUS_DOT[status] ?? STATUS_DOT.offline;
  return (
    <span
      aria-label={status}
      title={status}
      className={style.className}
      style={{ background: style.color }}
    />
  );
}
