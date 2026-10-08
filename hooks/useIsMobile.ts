"use client";

import { useSyncExternalStore } from "react";

// 配置面的紧凑断点（消费者：ModelsConfig / SkillsConfig / PluginsConfig / ChatInput 的移动分支）。
// ⚠️ 它不是布局断点：布局断点对齐设计系统 —— ≤900px 抽屉、≤1080px dock 收窄（app/globals.css）。
// 640–900px 区间里配置弹窗仍走桌面形态（D5 的刻意裁决，别「顺手对齐」）。
const MOBILE_QUERY = "(max-width: 640px)";

function subscribe(cb: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia(MOBILE_QUERY);
  mql.addEventListener("change", cb);
  return () => mql.removeEventListener("change", cb);
}

function getSnapshot(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(MOBILE_QUERY).matches;
}

function getServerSnapshot(): boolean {
  return false;
}

/**
 * 配置面的紧凑断点（640px）下返回 true；布局断点见 app/globals.css（900 / 1080）。
 * SSR-safe: renders as desktop (false) on the server and first client paint,
 * then syncs to the real viewport after hydration.
 */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
