"use client";

import { useEffect } from "react";

export function PwaRegistration() {
  useEffect(() => {
    // dev 判定用编译期常量 __WS_DEV__（next.config.ts compiler.define 注入），
    // 源码不得出现 process 词素（Turbopack dev 会注入 polyfill 模块死导入，
    // 旧 chunk 场景下 factory 失配整页崩溃）。typeof 兜底：纯 Node 无注入时回落为 dev。
    const isDevBuild = typeof __WS_DEV__ === "undefined" || __WS_DEV__;
    if (isDevBuild || !("serviceWorker" in navigator)) {
      // dev 主动注销同源残留的生产 SW：其 cache-first 会向 dev 投喂旧 chunk
      // （dev chunk URL 不含内容哈希），polyfill 等模块 factory 失配即整页崩溃。
      if (isDevBuild && "serviceWorker" in navigator) {
        void navigator.serviceWorker
          .getRegistrations()
          .then((registrations) =>
            Promise.all(
              registrations.map((registration) => registration.unregister()),
            ),
          )
          .catch(() => {
            // 注销失败不影响 dev 页面可用性
          });
      }
      return;
    }

    const register = () => {
      const scriptUrl = `/sw.js?v=${encodeURIComponent(__WS_APP_VERSION__)}`;

      void navigator.serviceWorker
        .register(scriptUrl, {
          scope: "/",
          updateViaCache: "none",
        })
        .catch((error: unknown) => {
          console.error(
            "Failed to register the worksplice service worker:",
            error,
          );
        });
    };

    if (document.readyState === "complete") {
      register();
      return;
    }

    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
