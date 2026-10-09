# scripts/screencast — 90 秒介绍视频的可重跑管线

产出一支 90 秒的 worksplice 介绍视频（1600×900 / 30fps / h264 / 纯字幕烧录），
画面取自当前仓库的真实 UI（生产构建 + 演示数据）。分镜与真跑口径见 [storyboard.md](./storyboard.md)。

```
capture.mjs   捕获：抓 UI 源图 + 驱动 hold-run 场景 + 浏览器舞台页逐帧渲染（运镜与字幕）
compose.sh    合成：每镜编码为同参段 → concat → ffprobe 校验
run-all.sh    一键：清洗数据 → seed → 构建 → 起服务 → 捕获 → 合成 → 校验
endcard.html  片尾卡（第 10 镜）源页
```

## 依赖

- Node ≥ 22.19（本仓 `package.json` engines）、Bun（`bun install`）
- `ffmpeg` / `ffprobe`（仅做编码与校验；本机构建不必含 drawtext/subtitles——运镜与字幕在捕获阶段
  由浏览器逐帧烧进 PNG 序列）
- Playwright + Chromium：优先 `import "playwright"`（可 `npm i -D playwright`），
  否则用 `PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs` 或全局安装（`npm root -g`）

## 一键重跑

```bash
bash scripts/screencast/run-all.sh
```

默认数据目录 `/tmp/screencast-90s-v2/demo-data`、输出目录 `/tmp/screencast-90s-v2/out`、
端口 `30153`（避开开发默认端口 30142）。可用环境变量覆盖：`DATA_DIR` / `OUT` / `PORT` / `BASE` / `TAG`。

产物：`$OUT/worksplice-90s.mp4`（mp4 不进 git；默认输出在 /tmp，避免污染 `git status`）。

## 分步

```bash
# 0) 依赖（worktree 里 node_modules 是 symlink 会让 Turbopack panic——用真实目录）
bun install

# 1) 演示数据（独立目录；脚本拒绝写 ~/.worksplice）
DATA=/tmp/screencast-90s-v2/demo-data
rm -rf "$DATA" && WORKSPLICE_DATA_DIR=$DATA node scripts/seed-demo.mjs

# 2) 生产构建 + 起服务（不要 next dev --webpack：必崩；端口避开 30142）
npm run build
WORKSPLICE_DATA_DIR=$DATA npx next start -H 127.0.0.1 -p 30153 &

# 3) 捕获（UI 源图 + hold-run 真实写路径 + 逐帧渲染；全片约 2700 帧）
OUT=/tmp/screencast-90s-v2/out
WORKSPLICE_DATA_DIR=$DATA BASE=http://127.0.0.1:30153 \
  OUT=$OUT TAG=20261009 node scripts/screencast/capture.mjs

# 4) 合成与校验
OUT=$OUT bash scripts/screencast/compose.sh
```

冒烟测试（每镜只渲染前 N 帧，验证管线连通，不做成片）：

```bash
FRAME_CAP=4 WORKSPLICE_DATA_DIR=$DATA BASE=http://127.0.0.1:30153 \
  OUT=/tmp/screencast-smoke node scripts/screencast/capture.mjs
```

## 产出物结构

```
$OUT/
  sources/      UI 源图（2x）+ hold-payload.json（服务器真实返回的 hold 负载）
  frames/       shot01..shot09 的 PNG 序列 + 各镜舞台页 HTML
  segments/     每镜编码段 + concat 清单
  manifest.json 镜头表（帧数 / 时长 / 静态镜头标记）
  worksplice-90s.mp4
```

## 注意

- **不触碰 live 数据**：`capture.mjs` 与 `seed-demo.mjs` 都要求显式 `WORKSPLICE_DATA_DIR`，
  且拒绝指向 `~/.worksplice`。
- **重跑前清洗数据目录**：hold-run 房间每次捕获新建（`hold-run-<TAG>`），不清洗会在侧栏累积。
  `run-all.sh` 每次重建数据目录。
- **唤醒抑制**：hold-run 房间对 Iris 静音（`muteChannel`），并把建频道触发的在途轮次落定后
  复位其状态（`setAgentStatus` offline）——本机没有模型，唤醒只会留下 error 标记，与剧本无关。
  只改 `members.status`，不碰房间内容。
- 第 5–7 镜为「真实机制 + 脚本驱动」，第 8 镜展示真实 hold 负载；与 v0.1.0 旧片（真模型驱动）
  的差异与原因见 storyboard.md。
- 本机 ffmpeg 若不是全量构建（无 libass/freetype），不要试图用 `subtitles`/`drawtext`；管线已把
  文字放进浏览器渲染层。
