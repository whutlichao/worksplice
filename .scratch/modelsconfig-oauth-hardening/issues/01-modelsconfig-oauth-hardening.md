# 01: ModelsConfig 的 SSE 登录流程——`JSON.parse` 无 try/catch、`window.open` 未校验跳转目标

**What to build:** 把 `components/ModelsConfig.tsx` 登录流程里三条**既有**的静态检查发现变成
可执行的处置：SSE 帧的 `JSON.parse(e.data)` 有崩溃面、两处 `window.open(...)` 不校验跳转目标。
本票只登记与取证，**不改任何代码**——处置方式（尤其「跳转目标白名单怎么定」）是一个需要论证的
安全决定，不在上一个 effort 的色板改判里顺手拍。

**Type:** security
**Blocked by:** None
**Status:** needs-triage

## 发现（三条，逐字存在于 base commit）

站点：`components/ModelsConfig.tsx`（登录面板，`handleLogin` → `EventSource("/api/auth/login/<provider>")`
→ `es.onmessage`）。行号以当前 `main`（`8a1edab`）为准，与 base `9ce948e` **逐字相同**（见「证据」）。

| # | 位置 | 现状 | 风险面 |
| --- | --- | --- | --- |
| ① | `:1116` | `const data = JSON.parse(e.data) as {...}` —— **无 try/catch** | 任一帧不是合法 JSON（服务端半截输出、代理/中间层插入的非 JSON 数据、端点被替换）即抛异常。异常发生在 `EventSource` 的 message handler 里：不冒泡到 React 错误边界，登录面板停在 `connecting` 相位、`eventSourceRef` 不关闭，且用户看不到任何提示 |
| ② | `:1124` | `window.open(data.url!, "_blank", "noopener,noreferrer")` —— `data.url` 来自**服务端转发的 OAuth 授权地址**，未校验 scheme / host | 登录流程主动把用户跳到由上游响应决定的地址：被污染/被替换的授权响应可把用户引到任意外站（钓鱼面），或非 `http(s)` scheme（`javascript:` / `data:` 等，取决于浏览器拦截策略） |
| ③ | `:1133` | `window.open(data.verificationUri!, "_blank", "noopener,noreferrer")` —— 同上，device-code 流的 verification URI | 同 ② |

三条**都是 base 逐字存在的既有问题**，不是本 effort 引入的：

```sh
# 当前 main（8a1edab）
$ grep -n "JSON.parse(e.data)\|window.open(" components/ModelsConfig.tsx
1116:      const data = JSON.parse(e.data) as {
1124:        window.open(data.url!, "_blank", "noopener,noreferrer");
1133:        window.open(data.verificationUri!, "_blank", "noopener,noreferrer");

# base（9ce948e）——同一文件同一区间，输出逐字相同
$ git show 9ce948e:components/ModelsConfig.tsx | grep -n "JSON.parse(e.data)\|window.open("
1116:      const data = JSON.parse(e.data) as {
1124:        window.open(data.url!, "_blank", "noopener,noreferrer");
1133:        window.open(data.verificationUri!, "_blank", "noopener,noreferrer");
```

## 证据（`9ce948e..8a1edab` 这段改动没有碰这三处）

```sh
$ git diff 9ce948e..8a1edab -- components/ModelsConfig.tsx | grep -c "window.open\|JSON.parse"
0

$ git diff 9ce948e..8a1edab --numstat -- components/ModelsConfig.tsx
33	33	components/ModelsConfig.tsx
```

那 33 处改动**逐行核对全部是色值**（`accentColor` / `background` / `border` 的颜色表达式，
按 ADR-0015 的档位归位），没有一行触及 SSE 解析、跳转或任何行为语义——该文件的零行为改动
边界由上一条 `grep -c` = 0 机械证明。

## 待决问题（triage 拍）

**跳转目标白名单怎么定？** 三个候选，各有代价，需要论证后择一：

1. **仅 scheme**：只放行 `https:`（可选 `http:` 仅限 `localhost`）。最小改动，挡住 `javascript:` /
   `data:`；但挡不住指向任意外站的钓鱼跳转。
2. **scheme + host allowlist**：按 provider 配置允许的授权域名（如 `github.com` / `accounts.google.com`
   / 各 provider 的 device-code 域名）逐 provider 白名单。最贴合语义，代价是**白名单要跟着 provider
   清单走**，新增 provider 必须同步维护，漏了就直接断掉登录。
3. **仅同源**：只允许跳本站自身页面、由服务端做 302 中转。最安全，但要改服务端的登录响应形态
   （增加一次中转），属跨面改动。

附带需要一起定的：① 处是「解析失败即忽略该帧并继续」还是「解析失败即关闭流 + 报错」——两种都是
行为变更，需要产品口径。

## 非目标

- 本票**不改任何代码**（三条都只登记）；上一个 effort（马卡龙色板收口，票 04）明写「登记不修，
  后续动作由它定」，本文件即那份登记。
- 不评估 `EventSource` 端点本身的鉴权面（`/api/auth/login/<provider>`）：那是服务端信任边界的
  另一条，超出本次静态检查发现的范围。

## 来源

- `.scratch/macaron-palette/issues/02-macaron-palette-tokens.md` 的「遗留项 5」；
- `.scratch/macaron-palette/issues/03-macaron-palette-migration.md` 的「偏离与登记 10」；
- 两条都写明：站点与 base 逐字相同、修它要改行为、而「校验策略」是独立的安全范围决定。
