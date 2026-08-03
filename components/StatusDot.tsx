"use client";

import type { MemberRow } from "@/lib/data/db";

const INK = "#141111";

const STATUS_DOT: Record<MemberRow["status"], { color: string; pulse?: boolean }> = {
  online: { color: "var(--success)" },
  working: { color: "var(--yellow)", pulse: true },
  error: { color: "var(--coral)" },
  offline: { color: "var(--stone)" },
};

/** §3.6 状态点四态：绿=在线、黄脉冲=干活、橙=出错、灰=离线。 */
export function StatusDot({ status }: { status: MemberRow["status"] }) {
  const style = STATUS_DOT[status] ?? STATUS_DOT.offline;
  return (
    <span
      aria-label={status}
      title={status}
      style={{
        width: 9,
        height: 9,
        flexShrink: 0,
        background: style.color,
        border: `2px solid ${INK}`,
        display: "inline-block",
        animation: style.pulse ? "ws-status-pulse 1.2s ease-in-out infinite" : undefined,
      }}
    />
  );
}
