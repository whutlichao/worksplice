import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

import { createJiti } from "jiti";

// 加载真实的 TS 配置（而不是读源文本），断言的就是 Next dev server 实际拿到的清单。
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const nextConfig = await jiti.import("../next.config.ts", { default: true });
const allowedDevOrigins = nextConfig.allowedDevOrigins ?? [];

// 直接用 Next 自己的跨源判定（dev server 拦截 `/_next/*` 时调的就是它），
// 避免测试里另写一套会与真实语义漂移的 wildcard 匹配。
// 注意：这是 Next 的私有路径，由 package.json 里精确锁定的 next 版本兜底；
// 升级 Next 后该路径若迁移，本文件会在加载期直接报错——这是要人重新核对语义的信号，
// 不要为了变绿改成跳过。
const require = createRequire(import.meta.url);
const { isCsrfOriginAllowed } = require(
  "next/dist/server/app-render/csrf-protection.js",
);
const isAllowed = (host) => isCsrfOriginAllowed(host, allowedDevOrigins);

test("放行 Orca worktree 的 `<worktree>.orca.localhost` 子域", () => {
  assert.ok(
    allowedDevOrigins.includes("*.orca.localhost"),
    `allowedDevOrigins 缺 *.orca.localhost，实际为 ${JSON.stringify(allowedDevOrigins)}`,
  );
  // 单层子域命中；多一层标签不命中——Next 的 `*` 只吃一层，这正是必须显式放行的原因。
  assert.ok(isAllowed("worksplice.orca.localhost"));
  assert.ok(!isAllowed("a.b.orca.localhost"));
});

test("保留既有的 192.168.*.* 局域网放行", () => {
  assert.ok(
    allowedDevOrigins.includes("192.168.*.*"),
    `allowedDevOrigins 不应丢掉 192.168.*.*，实际为 ${JSON.stringify(allowedDevOrigins)}`,
  );
});

test("没有比 *.orca.localhost 更宽的放行项", () => {
  assert.ok(Array.isArray(nextConfig.allowedDevOrigins));
  for (const origin of allowedDevOrigins) {
    // 整域通配会让任何来源通过；`**` 会跨层匹配，等于把子域放行放大成任意深度后缀。
    assert.notEqual(origin.trim(), "*", `不允许整域通配：${origin}`);
    assert.ok(!origin.includes("**"), `不允许跨层通配：${origin}`);
  }

  // 这些主机必须保持被拦截：外部域名、伪装成 Orca 后缀的外部域名、多一层子域。
  // 用真实判定而非模式文本比较，`*.*.localhost` 这类「每层都通配」的写法也会在这里现形。
  for (const host of [
    "evil.example",
    "worksplice.orca.localhost.attacker.example",
    "a.b.localhost",
    "a.b.orca.localhost",
  ]) {
    assert.ok(!isAllowed(host), `${host} 不应被放行`);
  }
});
