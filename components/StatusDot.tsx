"use client";

import type { MemberRow } from "@/lib/data/types";

/** 四态 → `.presence.{status}` 形态 + 该状态的语义 token（spec ED-10）+ 可访问名 i18n 键。 */
const STATUS_DOT: Record<
  MemberRow["status"],
  { className: string; color: string; labelKey: string }
> = {
  online: { className: "presence online", color: "var(--online)", labelKey: "presence.online" },
  working: { className: "presence working", color: "var(--working)", labelKey: "presence.working" },
  error: { className: "presence error", color: "var(--error)", labelKey: "presence.error" },
  offline: { className: "presence offline", color: "var(--offline)", labelKey: "presence.offline" },
};

/** 无 i18n 上下文时的兜底名（与 zh-CN 包同值；界面评审 A6 要求状态名可读、非枚举原文）。 */
const STATUS_DOT_FALLBACK: Record<MemberRow["status"], string> = {
  online: "在线",
  working: "干活中",
  error: "出错",
  offline: "离线",
};

/** §3.6 状态点四态：绿=在线、黄脉冲=干活、橙=出错、灰=离线。
 *  形态（7px 圆点、working 脉冲 1.5s、`reduce` 下停跳）在 globals.css 的 `.presence` class 块；
 *  颜色按状态内联——既有渲染面断言（app/globals.test.mjs T-D）断的就是 markup 里的语义 token。
 *
 *  可访问名（界面评审 A6）：`aria-label` / `title` 曾是未本地化的枚举（`online` / `working`…），
 *  中文界面里读屏会把英文状态名念出来。现在默认取 `presence.*` 文案；调用点若要更具体的
 *  语境（例如「Nova 在线」）可用 `label` 覆盖。 */
export function StatusDot({
  status,
  label,
  translate,
}: {
  status: MemberRow["status"];
  /** 覆盖可访问名（调用点若需更具体的语境，如「Nova 在线」）。 */
  label?: string;
  /** 翻译函数（通常传 `useI18n().t`）。缺省时按四态的中文名兜底——本组件也在
   *  没有 I18nProvider 的纯渲染路径（测试 / SSR 片段）里被用到，不能硬依赖 hook。 */
  translate?: (key: string) => string;
}) {
  const style = STATUS_DOT[status] ?? STATUS_DOT.offline;
  const name = label ?? translate?.(style.labelKey) ?? STATUS_DOT_FALLBACK[status] ?? STATUS_DOT_FALLBACK.offline;
  return (
    <span
      aria-label={name}
      title={name}
      className={style.className}
      style={{ background: style.color }}
    />
  );
}
