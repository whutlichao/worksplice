import type { NextConfig } from "next";
import { readFileSync } from "fs";
import { join } from "path";

const { version } = JSON.parse(
  readFileSync(join(__dirname, "package.json"), "utf8"),
) as { version: string };
let piVersion = "unknown";
try {
  const piPkgPath = join(
    __dirname,
    "node_modules/@earendil-works/pi-coding-agent/package.json",
  );
  piVersion = (
    JSON.parse(readFileSync(piPkgPath, "utf8")) as { version: string }
  ).version;
} catch {
  /* package not found, use default */
}

const nextConfig: NextConfig = {
  compiler: {
    define: {
      // 客户端源码不得出现 process 词素（Turbopack dev 会注入 polyfill 模块死导入，
      // 旧 chunk 场景下 factory 失配整页崩溃，见 .scratch/i18n-process-fix/issues/01）。
      // dev 判定与版本由此注入为编译期常量，声明见 lib/build-env.d.ts。
      __WS_DEV__: process.env.NODE_ENV !== "production",
      __WS_APP_VERSION__: version,
    },
  },
  serverExternalPackages: [
    "undici",
    "better-sqlite3",
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-tui",
  ],
  allowedDevOrigins: ["192.168.*.*"],
  async headers() {
    return [
      {
        source: "/",
        headers: [
          {
            key: "Cache-Control",
            value: "private, no-cache, max-age=0, must-revalidate",
          },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
        ],
      },
    ];
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    NEXT_PUBLIC_PI_VERSION: piVersion,
  },
};

export default nextConfig;
