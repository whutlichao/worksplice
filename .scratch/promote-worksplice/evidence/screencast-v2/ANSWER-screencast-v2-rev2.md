# Answer — worksplice 90s 推广片 v2 rev2（F1/F2 碰撞面 + F3 跳动框）

任务：task_108908bfb472 ／ dispatch：ctx_cbc58ae32bf2 ／ 票型：实施票（非代码交付物）
工程目录（worktree 与主工作区同名）：`.scratch/promote-worksplice/evidence/screencast-v2/`

---

## 1. 改动清单（文件级）

### 改动 ① F1：碰撞面从「parser.js 文件卡」→「房间里的任务卡」

`compositions/frames/01-two-writers.html`

- 卡面身份全部替换：`parser.js` 卡头 → `#7`（产品自己的任务号写法）+ `In progress` 状态 chip（产品看板真实列名之一，弹丸描边框）；卡体 4 行伪代码（含 `export function splitFields…` 与行号 01–04）→ `TASK TITLE` 字段标签 + 一行任务标题 `Fix the held-write banner copy`。
- 被写的「那一行」就是这条任务标题：write-bar 走位轨道改为覆盖整条标题行（`position:absolute; inset:0`），标题文字以 z-index 2 压在轨道之上，所以两条 write-bar 是**在这一行上**相撞、coral sweep 抹掉先写、`LAST WRITE WINS` 珊瑚章落在卡头空着的右端。
- 保留项逐条核对：nova（cyan）/quill（pink）像素头像与左右入场 ✓、两条 write-bar 相撞 ✓、coral sweep 抹掉先写 ✓、`LAST WRITE WINS` 珊瑚章 ✓、`2 writers` chip ✓、`F01 · HOOK` ✓、`W0RKSPLICE` ✓；默认结局仍是「后写覆盖先写」✓。
- 字幕三拍结构与「默认 = last write wins」不变，文案按 spec 改为 `Two agents. One task.` → `Both write at once.` → `The default: last write wins.`（原 cue1 为 "One file."）。
- 帧私有实现随之调整（不改 `data-composition-id` / `data-start` / `data-duration` / `data-track-index`）：
  - write-bar 宽度由硬编码 px 改为轨道百分比（`639/840=76.07%`、`561/840=66.79%`、sweep `100%`），caret 由 `x: 0→633` px 改为 `xPercent`（全轨道载体 + 左缘 0.3cqw 墨条），两者都随卡片等比缩放，不再假定 840px 写区；
  - cardbody 用非对称 padding 把（变短后的）卡块重新座到卡片视觉中心——碰撞行中心落在 y≈501px，与旧版第 02 行完全同位，也正好对齐两个头像中心。
- 诚实性不变：仍是图解，不出现任何假 UI 截图。

### 改动 ② F2：同一次碰撞的复演，卡面字段与 F1 逐字段一致

`compositions/frames/02-held-not-lost.html`

- 卡头 `parser.js` → `#7` + `In progress` chip（+ 原 `2 writers` 仍在，改为 `margin-left:auto` 靠右）。卡体顶部新增 `TASK TITLE` + 同一行标题 `Fix the held-write banner copy`。
- `#f02-typedrow` 与 `#f02-chip` 各下移 5.2cqw，重新贴合「what changed」面板座位——改动前 HELD chip 会压住 mono 行开头（已由像素测量确认并修正）。
- 其余「既有文案与结构」原样保留：`Not here.` / `The write is held — not merged, not overwritten.` / 蒙行 `held · the room moved while you were writing` / `Held` chip / `same collision · opposite outcome` / `Last write wins` / 两条 write-bar 与冻结动作。
- 帧的 `data-*` 时间轴字段一个未动；帧内私有 class/id 同步 CSS/JS。

### 改动 ③ F3：跳动框对齐任务看板的状态列

`compositions/frames/03-the-room.html`

- `STEP_X = [-187, -373, -559, -746]`（方向反了、向左出板）→ `COL_X = [11, 197, 383, 569, 755]`（= 列左边 429/615/801/987/1173 减去 box 座位 418），取前 4 个（`STEP_T` 仍是冻结的 4 个时间点 5.46/6.02/6.58/7.14）。第 5 个偏移量 `755`（Closed 列）保留在常量里并在注释中说明「四拍走不到 Closed」。
- `.f03-crop` 宽度 `200px → 186px`（列宽），左右两条边同时落在列分隔线上。
- ticker 改为与框同格：`strip.y = -22*i`（i=0 就是 `Pool`，不再预跳到 `In progress`）；`from` 取上一格，保留「标签滚动」这一动作。
- 其余未动：板面 footage、chip 样式、四个 step 时间点、fade in/out 时序。

### 文档同步

- `STORYBOARD.md`：F1/F2/F3 的 `scene` 与正文/Scene 描述全部改写（F1 卡面改成任务卡 + 明确「碰撞发生在房间的写入路径，绝不是文件锁」；F2 写明与 F1 同字段值；F3 写明框落在真实列 429/615/801/987/1173、列宽 186px、四拍走 Pool→In progress→In review→Done）。`grep "parser\.js\|splitFields" STORYBOARD.md` = 0。
- `README.md`：「What it is（content layer）」补一段说明 F1/F2 的碰撞刻意落在产品真正会拦的写入路径（房间任务卡），不是文件；Truthfulness inventory 的 01/02 两行改写；Files 段补 `verify-f03-bracket.mjs` 与样片。`grep "parser\.js\|splitFields" README.md` = 0。
- `ffprobe.txt`：重出（成片 + 样片）。

### 新增文件

- `verify-f03-bracket.mjs`（可复跑几何/文本验证脚本）
- `f03-bracket-report.json`（该脚本本次输出的机器可读版）

### 生成物

- `index.html`（`bash rebuild.sh` 重出：restore → assemble → inject transitions → patch stacking）
- `renders/worksplice-90s-v2.mp4`（重渲）
- `renders/sample-f2-f6.mp4`（重切 gate-3 样片）

### 重渲 build 产物时间（UTC）

| 产物 | 时间 | 大小 |
| --- | --- | --- |
| `index.html`（rebuild.sh 产出） | 2026-10-04T11:59:28Z | 8 824 B |
| `renders/worksplice-90s-v2.mp4`（render 完成） | 2026-10-04T12:07:25Z | 10 523 365 B |
| `renders/sample-f2-f6.mp4`（重切） | 2026-10-04T12:08:41Z | 1 065 811 B |
| `ffprobe.txt` | 2026-10-04T12:11:36Z | 446 B |
| `f03-bracket-report.json` | 2026-10-04T12:11:17Z | 4 413 B |

render 自报耗时 3m08.3s（capture 3m04.0s，2700/2700 帧，drawelement，hardware gpu）。
`npx --yes hyperframes@0.8.90 check`：`0 error(s), 0 warning(s), 12 info(s)` + `Check passed`（12 条 info 全部是 F4–F7 既有的 caption crossfade `content_overlap`，F1/F2/F3 无新增）。

---

## 2. 样例路径

- 成片：`renders/worksplice-90s-v2.mp4`
- gate-3 样片：`renders/sample-f2-f6.mp4`（**新的 F2** 5.0s + F6 头 16.0s = 21.0s，630 帧）
  - 切点：F2 `7.0–12.0`（F2→F3 过渡在 T=12 起、0.4s，切点正好在过渡混叠之前）；F6 `47.6–63.6`（F5→F6 过渡 T=47 起 0.4s，F6→F7 过渡 T=68 起 0.5s，两端都避开）
  - 自检：样片 t=3.0s（= 母片 10.0s）抽帧确认展示的是**新卡面**（`#7` · `In progress` · `Fix the held-write banner copy` · HELD chip / mono 行 / what-changed 面板）。

---

## 3. 门禁 A：F1/F2 改到位的硬证据

```
$ grep -rn "parser.js\|splitFields" compositions/frames/01-two-writers.html \
      compositions/frames/02-held-not-lost.html index.html
(无输出，exit=1)

$ grep -rn "parser.js\|splitFields" compositions/frames/ index.html
compositions/frames/06-the-held-write.html:340:  "Your held draft was: — Plan for splitFields (parser.js), no code changed yet."
```

**这一条是唯一一处偏离字面门禁的地方，已 ask 求裁决但未获答复，按「不得伪造证据」的硬约束保守处置**（见 §7 未决项）。F6 那一行不是「卡片身份」而是一段**产品真实 revise prompt 的逐字引文**：源头是 `/tmp/ws-v2/run2/revision-prompt.txt`（那次真跑里 `Your held draft was:` 段落的原文，composition 只是把多行 draft 折叠成一行）。README 与 STORYBOARD 都写明该证据卡「verbatim, no paraphrase / 逐字原文」，蓝本还写着 "This is her session file — not a UI effect."。改它 = 把真跑证据改成不存在的文本。因此门禁 A 按「碰撞卡身份」范围执行 = `01 + 02 + index.html` **为空**（上方第一条命令即证据）。

卡面字段逐字段一致（同一份源码直接对拍）：

```
f01-taskno:    #7                              |  f02-taskno:    #7
f01-status:    In progress                     |  f02-status:    In progress
f01-titletext: Fix the held-write banner copy  |  f02-titletext: Fix the held-write banner copy
```

---

## 4. 门禁 B：F3 几何证据（可复跑）

脚本：`verify-f03-bracket.mjs`（放在工程目录）。它**不读 composition 的 JS 来判断结果**：

1. 从 `index.html` 读出 F3 的 `data-start`，按冻结的 `STEP_T`/`MOVE_S` 算出每个 step 的保持窗，每窗取 3 个采样点全部校验（不是只抽一个点）；
2. 抽帧后做像素扫描找框的左右边界——判据是「在框顶边 y=300 已有墨、且 y∈[296,736] 内 ≥90% 为墨的 3–8px 宽竖条」，因此 1px 的看板列分隔线（y≈330 起）与卡片短边框都被排除；扫描范围止于 x=1670，避开 plate 自身 7px 边框与硬投影；
3. 独立复测看板的六条列分隔线；
4. chip 文本是**读出来的**：把 chip 的 184×22 mono 滚动窗（几何由 `.f03-crop` 座位 + `#f03-chip` 内边距推出）与五张标签位图做二值掩膜 IoU 匹配，参考位图用**同一个 Chrome + 同一份品牌 woff2** 独立渲染（`Pool / In progress / In review / Done / Closed`），并同时断言窗口内只有一个字形带（即标签不在滚动中途）。

命令与输出（对**主工作区已落盘的那份 mp4**跑，不是对 worktree 中间产物）：

```
$ node verify-f03-bracket.mjs
source          : .../screencast-v2/renders/worksplice-90s-v2.mp4
F3 frame start  : 12s (from index.html)
board columns   : 429 / 615 / 801 / 987 / 1173  (+186px each)
tolerance       : ±4px   plate left: 240px

hold points (samples at 17.82,17.91,18.00 | 18.38,18.47,18.56 | 18.94,19.03,19.12 | 19.50,19.66,19.82)
step  column       target L/R  box L/R   ΔL  ΔR  chip text      IoU   2nd   column rules               verdict
0     Pool         429/615     429/615   0   0   "Pool"         0.72  0.50  429✓ 615✓ 801✓ 987✓ 1173✓  PASS
1     In progress  615/801     615/801   0   0   "In progress"  0.73  0.42  429✓ 615✓ 801✓ 987✓ 1173✓  PASS
2     In review    801/987     801/987   0   0   "In review"    0.75  0.37  429✓ 615✓ 801✓ 987✓ 1173✓  PASS
3     Done         987/1173    987/1173  0   0   "Done"         0.81  0.54  429✓ 615✓ 801✓ 987✓ 1173✓  PASS

PASS — 4/4 steps on their column, chip text matches
```

- 框左右边界 vs 目标列：**Δ 全为 0px**（要求 ±4px），左右两条边都落在列分隔线上。
- chip 文本 = 该列标题（`Pool / In progress / In review / Done`），IoU 0.72–0.81、次优 0.37–0.54（余量 0.22–0.35，阈值要求 ≥0.15）；窗口内字形带 = 1（标签与框同格，不再快一格）。
- 框不再越出板面：最小 left = 429px ≥ 240px（旧版最小会走到 418−746 < 0）。
- 看板五列左边界 429/615/801/987/1173 在此帧被独立复测命中，坐标基线与 coordinator 的实测一致。
- `f03-bracket-report.json` 是同一跑次的机器可读输出（含每采样点原始测量值）。

---

## 5. 门禁 C：成片规格（`ffprobe.txt` 全文）

```
# ffprobe — renders/worksplice-90s-v2.mp4
# captured 2026-10-04T04:11:36Z

codec_name=h264
width=1920
height=1080
pix_fmt=yuv420p
r_frame_rate=30/1
nb_frames=2700
format_name=mov,mp4,m4a,3gp,3g2,mj2
duration=90.000000
size=10523365
bit_rate=935410

# ffprobe — renders/sample-f2-f6.mp4 (gate-3 sample: F2 5s + F6 head 16s)
codec_name=h264
width=1920
height=1080
pix_fmt=yuv420p
r_frame_rate=30/1
nb_frames=630
duration=21.000000
size=1065811
```

≈90.000s / 1920×1080 / 30fps / H.264，2700 帧齐；抽帧（t=1.8 / 3.5 / 5.2 / 8.0 / 9.5 / 11.5 / 17.9 / 18.47 / 19.03 / 19.66）逐张可正常解码播放；`show_format`/`show_streams` 全量扫描无任何本机路径（只有 `handler_name=VideoHandler`、`encoder=Lavc63.1.101 libx264`）。

---

## 6. 门禁 E：双落盘

- worktree：`/Users/apple/orca/workspaces/worksplice/screencast-v2-rev2/.scratch/promote-worksplice/evidence/screencast-v2/`
- 主工作区：`/Users/apple/orca/worksplice/.scratch/promote-worksplice/evidence/screencast-v2/`（整份 rsync 同步，mp4 + 工程源码 + README + ffprobe + 脚本/报告全量）
- 主工作区 `git status --porcelain` 输出为**空**（零新增；该目录本身已在 `.gitignore` 的 `.scratch/` 下）；worktree 同样为空。
- 本地忽略已按行为规则落好：worktree 根 `.pi-lens.json` = `{"format":{"enabled":false}}`，并写进 `.git/info/exclude`；全程未跑任何整份重写/格式化命令。
- 说明：`bash rebuild.sh` 的 restore→assemble 往返会给「含被 hoist 视频的帧」各追加一条占位注释。为避免把工具链漂移混进交付，04/05/06/07 四帧已还原成主工作区上一版内容（该四帧与本票无关，内容与旧版逐字节一致），最终内容层面只有 `01 / 02 / 03` 三帧变化。
- 本票无发布动作：未上传 Release、未推 npm、未发任何消息、未登录/登出任何账号、未操作用户自有标签页。

---

## 7. 未决项与默认处置（已 ask，未获答复；请 coordinator 判）

一次打包的提问（messageId `msg_598b27e287bf`，三次 resume 共等待约 1 小时 55 分，均超时且收件箱为空），按「不编造、不擅自扩 scope」保守默认：

- **Q1（关键）F6 逐字证据 vs 门禁 A 字面范围**：默认 **A（推荐项）——不改 F6 原文**，门禁 A 按「碰撞卡身份」范围执行（`01 + 02 + index.html` 为空）。理由见 §3：改 F6 = 伪造真跑证据，与 README/STORYBOARD 的 verbatim 声明和蓝本 "not a UI effect" 直接冲突。若 coordinator 判 B（也改 F6），需同时改 STORYBOARD/README 的诚实性声明——**这是伪造证据，请明确书面授权再做**。
- **Q2 storyboard.html / storyboard-v1.png**：默认 **A——不动**（前期已批准的草图快照；本 spec 只点名 STORYBOARD.md / README.md）。现状：`storyboard.html` 第 109/114/123/135 行仍是旧 F1/F2 的 `parser.js` mock，第 234 行是 F6 的逐字 excerpt。如需同步（B/C）请回话。
- **Q3 `.hyperframes/frame-packets/{01,02,03}-*.md`**：默认 **A 之外的保守侧——暂不动**（逐帧蓝图属历史工作输入，与 storyboard.html 同类；spec 的文件清单未含）。现状：`01-two-writers.md` 第 13/29 行仍是旧 F1 描述。如需一并同步请回话，改起来是纯文案、几分钟。

**等待用户第 4 关成片验收。**
