"use client";

import { translateMessage } from "@/lib/i18n/format";
import { enLocale } from "@/lib/i18n/messages/en";
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

/** 无 i18n 上下文时的兜底：直接取 en 包的同名文案（不硬编码任何语言的字符串——
 *  `docs/i18n.md` 的 UI 文案规则要求文案只存在于语言包里）。 */
function fallbackLabel(key: string): string {
  return translateMessage("en", key, { en: enLocale.messages });
}

/** §3.6 状态点四态：绿=在线、黄脉冲=干活、橙=出错、灰=离线。
 *  形态（7px 圆点、working 脉冲 1.5s、`reduce` 下停跳）在 globals.css 的 `.presence` class 块；
 *  颜色按状态内联——既有渲染面断言（app/globals.test.mjs T-D）断的就是 markup 里的语义 token。
 *
 *  可访问名（界面评审 A6）：`aria-label` / `title` 曾是未本地化的枚举（`online` / `working`…），
 *  中文界面里读屏会把英文状态名念出来。现在取 `presence.*` 文案（调用点透传 `t`）。 */
export function StatusDot({
  status,
  translate,
}: {
  status: MemberRow["status"];
  /** 翻译函数（通常传 `useI18n().t`）。缺省时取 en 包文案——本组件也在没有
   *  I18nProvider 的纯渲染路径（测试 / SSR 片段）里被用到，不能硬依赖 hook。 */
  translate?: (key: string) => string;
}) {
  const style = STATUS_DOT[status] ?? STATUS_DOT.offline;
  const name = translate?.(style.labelKey) ?? fallbackLabel(style.labelKey);
  return (
    <span
      aria-label={name}
      title={name}
      className={style.className}
      style={{ background: style.color }}
    />
  );
}
