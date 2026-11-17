"use client";

import { useEffect, useRef } from "react";

/** 轮询原语：取数 + 合并注入 + 后台 tab 暂停 + interval 注入。
 *
 * 刻意不做通用资源框架：不持业务 state / cache / error，也不做请求代际守卫；
 * 这些仍由各数据集 hook 自己持有（#278 第一步只抽「轮询纪律」这一条缝）。
 *
 * - `intervalMs` 由调用方注入（本原语不定义业务周期）；
 * - `load` 每轮按作用域取数，`merge` 接收取数结果与发起它的作用域并合并进调用方状态；
 * - `scopeKey` 变化时重建计时器（切频道/线程不沿用旧作用域的相位），undefined 即停；
 * - `document.hidden` 时跳过本轮（后台 tab 暂停），卸载时清理计时器。
 *
 * `load` / `merge` 走 ref 保鲜：调用方每次渲染重建闭包不会重置计时器。
 * 作用域在计时器创建时固定并显式传给 load/merge：作用域切换后，旧请求即使先返回
 * 也不会被合并进新作用域。
 */
export interface PollingResourceOptions<T> {
  scopeKey: string | undefined;
  intervalMs: number;
  load: (scopeKey: string) => Promise<T>;
  merge: (incoming: T, scopeKey: string) => void;
}

export function usePollingResource<T>({
  scopeKey,
  intervalMs,
  load,
  merge,
}: PollingResourceOptions<T>): void {
  const loadRef = useRef(load);
  loadRef.current = load;
  const mergeRef = useRef(merge);
  mergeRef.current = merge;
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;

  useEffect(() => {
    if (!scopeKey) return;
    const activeScope = scopeKey;
    let disposed = false;
    const tick = () => {
      if (disposed || document.hidden) return;
      void loadRef
        .current(activeScope)
        .then((incoming) => {
          if (disposed || scopeRef.current !== activeScope) return;
          mergeRef.current(incoming, activeScope);
        })
        .catch(() => undefined);
    };
    const timer = setInterval(tick, intervalMs);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [scopeKey, intervalMs]);
}
