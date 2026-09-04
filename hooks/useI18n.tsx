"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getLocalePlugin, getSupportedLocales, resolveBrowserLocale } from "@/lib/i18n/registry";
import { translateMessage } from "@/lib/i18n/format";
import type { Locale, LocalePlugin, TranslationParams } from "@/lib/i18n/types";

const LOCALE_STORAGE_KEY = "worksplice-locale";
const defaultLocale: Locale = "en";

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: TranslationParams) => string;
  supportedLocales: LocalePlugin[];
}

const I18nContext = createContext<I18nContextValue | null>(null);

function getMessages(): Record<string, Record<string, string>> {
  return Object.fromEntries(getSupportedLocales().flatMap((id) => {
    const plugin = getLocalePlugin(id);
    return plugin ? [[id, plugin.messages]] : [];
  }));
}

function readInitialLocale(): Locale {
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored === "en" || stored === "zh-CN") return stored;
  } catch {
    // 隐私模式或存储不可用时继续使用浏览器语言。
  }
  return resolveBrowserLocale(window.navigator.languages.length ? window.navigator.languages : [window.navigator.language]);
}

/**
 * 提供 worksplice 的界面语言状态和翻译能力。
 * @param props React 子节点
 * @returns 包含语言上下文的 React 节点
 */
export function I18nProvider({ children }: { children: React.ReactNode }) {
  // 首帧即用正确 locale：useState 初始化器在首 render 同步读取 localStorage/浏览器语言，
  // 避免 mount 后 setState 触发 hydration 全树重渲染（曾导致切换频道时请求双发）。
  const [locale, setLocaleState] = useState<Locale>(() => {
    if (typeof window === "undefined") return defaultLocale;
    return readInitialLocale();
  });
  const [hydrated, setHydrated] = useState(false);
  const supportedLocales = useMemo(
    () => getSupportedLocales().map((id) => getLocalePlugin(id)).filter((plugin): plugin is LocalePlugin => Boolean(plugin)),
    [],
  );
  const messages = useMemo(() => getMessages(), []);

  useEffect(() => {
    // locale 已在 useState 初始化器同步读对，仅补 html lang 与水合标记，不再 setLocaleState。
    document.documentElement.lang = locale;
    setHydrated(true);
  }, []);

  const setLocale = useCallback((next: Locale) => {
    if (!getLocalePlugin(next)) return;
    setLocaleState((prev) => {
      if (prev === next) return prev;
      try {
        window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
      } catch {
        // 存储失败不影响当前页面内的语言切换。
      }
      return next;
    });
    document.documentElement.lang = next;
  }, []);

  const t = useCallback((key: string, params?: TranslationParams) => translateMessage(locale, key, messages, params), [locale, messages]);
  // value 引用跟随 t 变化：locale 不变时 t 引用不变 → 下游 useI18n 组件不重渲染。
  // 注意：hydrated 只影响首帧展示语言（defaultLocale → 真实 locale），为避免
  // hydration 翻译闪烁仍保留在 value 中，但 hydration 完成后它不再变化。
  const value = useMemo(() => ({ locale: hydrated ? locale : defaultLocale, setLocale, t, supportedLocales }), [hydrated, locale, setLocale, t, supportedLocales]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/**
 * 获取当前组件树中的国际化能力。
 * @returns 当前 locale、翻译函数、语言切换函数和支持的语言列表
 * @throws 当组件不在 I18nProvider 内时抛出异常
 */
export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used inside I18nProvider");
  return context;
}
