"use client";

/** §4 视觉：仅亮色一档，不响应 prefers-color-scheme。旧组件（FileViewer/MermaidBlock）
 *  仍读取 isDark 决定语法高亮主题，这里恒定返回亮色。 */
export function useTheme() {
  return { theme: "light", toggleTheme: () => {}, isDark: false } as const;
}
