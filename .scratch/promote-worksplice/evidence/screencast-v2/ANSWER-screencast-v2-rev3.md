# Answer — worksplice 90s 推广片 v2 rev3（用户复核「阻断 1 + 建议 5 + 细节 3」全做）

任务：task_c2c5af64ccdb ／ dispatch：ctx_ad4e481a4b89 ／ 票型：实施票（非代码交付物）
工程目录（worktree 与主工作区同名）：`.scratch/promote-worksplice/evidence/screencast-v2/`

---

## 0. 一句话结论

阻断项 **A** 的根因不是「模型不听英文指令」，而是 **worksplice 启动时会自动创建中文秘书 Susan**——她的建立会投递产品自带的中文事件消息（`新频道 … 已建立` / `新成员 … 加入频道`），她的欢迎语也是中文。**把 `PI_CODING_AGENT_DIR/settings.json` 留空（不配 defaultModel）后 `autoCreateSecretary` 直接跳过**，`findSusanMember()` 返回 undefined，事件消息一条都不会投，房间从源头就是英文。据此重跑了真实运行并重采了全部 demo 素材，A–J 全部落地，全片重渲。

---

## 1. 逐条对照（A–J）

| 项 | 处置 | 证据 |
| --- | --- | --- |
| **A 阻断** 真实运行素材改英文 | **重跑真实运行**（新数据目录 + 空 settings.json ⇒ 不建 Susan；agent dir 与实跑项目各放一份英文 `AGENTS.md`；模型换 `step-5-preview`）。F4/F6 的上镜素材 `hold-wake.mp4` / `hold-wake-story.mp4` / `hold-reply-story.mp4` 全部重新捕获并重切；F6 证据卡换成**这一次真跑的英文逐字原文** | §3.1（抽帧）、§3.2（源扫描 = 0 CJK）、§3.3（新 revise prompt 原文） |
| **B** F7 印章 lime → coral | `07-approve-by-other.html`：`.f07-stamp { background: #A9D877 → #F97264 }`（文案不变） | §3.6 `grep` + 抽帧 |
| **C** F3 看板补卡 | 用产品自己的协作域 API（`createTask` / `claimTask` / `updateTaskStatus`）给 demo 房间的 `#all` 补卡：Pool 2 / In progress 2 / In review 1（保留原卡）/ Done 1 / Closed 1 | §3.3 板面截图 + 计数 |
| **D** F5 位置线 | 线从「feed 下方空白区」移到**真实消息 #11 与 #12 之间**（改 `#f05-seat { top: 36.6 → 37.4cqw }`），readout 从虚构的 `seq 42` 改为真实的 **`seq 11`**，ack 步进 11→12；`messages.mp4` 重采并在 F5 scene 2（asset t 3–6s）**真的滚动一次** | §3.5（抽帧 + 61.4% 像素差 + 行带测量） |
| **E** 采集指针不压字 | 三处检查点逐一核对并修：board 停在列体空白、**channel 的列表已满所以改停到列表上方的空白带**（原来压在消息正文上）、messages 停在列表下边界空白带 | §3.4（三张放大抽帧） |
| **F** F9 入场黑场 | wordmark 组装**从第 0 帧开始**（sq/letters 0.0s、caption 0.1s），并把 lockup 放大（方 92→136px、字 100→126px）让 ink 板一开场就有内容 | §3.7 `blackdetect` = **无黑段** |
| **G** F3 cue3 晚 1s | cue2 退出 10.06→9.30、cue3 进入 10.44→9.42 ⇒ cue3 在 **21.8s 已完全落地**（< 22s） | §3.8 cue 抽帧 |
| **H** F6 静止过长 | HELD 印章落定 6.65s → 抬起 11.7→**8.35s** ⇒ 印章静止约 **1.7s**（原 ~5.05s）；freeze-and-stamp 招牌动作保留 | §3.8 命令与数值 |
| **I** F8 诚实说明字号 | `.f08-note` 27px → **36px**（行高 1.55→1.5，颜色略深 `#6F6A5E`→`#5F5A50`），两行仍落在 caption band 之上（~920 < 944） | §3.8 抽帧 |
| **J** 文档同步 | `.hyperframes/frame-packets/{01,02,03}-*.md` 的 storyboard 块同步成新现实（并清掉包里**重复的第二份** storyboard 块）；`storyboard.html` / `storyboard-v1.png` 按 Q2=A **保留不动**，README 写明「草图早于 F1/F2 改动」 | §3.9 |

顺带修掉的既有缺陷（属 D 的连带、也在验收范围内）：`messages.mp4` 原 7.8s 却占 9s 槽、`review.mp4` 原 8.53s 占 9s 槽 ⇒ 末段冻结；新素材分别 10.6s / 9.8s，**`data-media-start + data-duration ≤ 素材时长` 全部成立**。
另外把 F4 载荷卡里的示例值改成与画面一致（`targetId: "csv-split" → "parser-fix"`、`seq: 7 → 2`）。

---

## 2. 改动清单（文件级）

全部在 `.scratch/promote-worksplice/evidence/screencast-v2/` 内（未改仓库源码）：

**合成（画面）**
- `compositions/frames/03-the-room.html` — cue3 时序
- `compositions/frames/04-wake-is-a-pointer.html` — 载荷卡取值
- `compositions/frames/05-cursor-not-a-list.html` — 位置线 y、readout 数字（`f05-num42/43` → `f05-numfrom/numto`，11/12）
- `compositions/frames/06-the-held-write.html` — 证据卡三行换成新真跑原文；HELD 印章抬起时序
- `compositions/frames/07-approve-by-other.html` — 印章 coral
- `compositions/frames/08-local-one-file.html` — 说明字号
- `compositions/frames/09-install.html` — 入场时序 + lockup 尺寸
- `compositions/frames/01,02-*.html` — 无改动（rev2 已改）

**素材（全部重采/重切）**
- `assets/hold-wake.mp4`、`assets/hold-wake-story.mp4`、`assets/hold-reply-story.mp4` — 真实运行重跑（英文）
- `assets/board.mp4`、`assets/channel.mp4`、`assets/messages.mp4`、`assets/review.mp4` — demo 房间重采（补卡 / 滚动 / 指针）
- 删除未被引用的旧中文素材：`assets/hold-reply.mp4`、`assets/hold-wake-close.mp4`、`assets/hold-reply-close.mp4`

**工程与证据**
- `index.html`（rebuild.sh 重出）、`renders/worksplice-90s-v2.mp4`、`renders/sample-f2-f6.mp4`、`ffprobe.txt`
- `STORYBOARD.md`、`README.md`
- `.hyperframes/frame-packets/01,02,03-*.md`
- `capture-scripts/`（新增，采集驱动与英文约束原文：real-run-capture.mjs / demo-capture.mjs / demo-channel-take.mjs / demo-align-cuts.mjs / demo-add-cards.mjs / demo-finish-cards.mjs / real-run-AGENTS.md / real-run-project-*）
- `verify-f03-bracket.mjs`、`f03-bracket-report.json`、本 ANSWER

### 重渲 build 产物时间（UTC）

| 产物 | 时间 | 大小 |
| --- | --- | --- |
| `index.html`（rebuild.sh） | 2026-10-04T20:20:16Z | 8 824 B |
| `renders/worksplice-90s-v2.mp4` | 2026-10-04T20:12:13Z | 10 577 042 B |
| `renders/sample-f2-f6.mp4` | 2026-10-04T20:17:45Z | 1 060 969 B |
| `ffprobe.txt` | 2026-10-04T20:17:45Z | 499 B |
| 素材 board / channel / messages / review | 20:05:27 / 20:05:44 / 20:06:12 / 20:06:15 | — |
| 素材 hold-wake / hold-wake-story / hold-reply-story | 14:18:41 / 14:18:44 / 14:18:47 | — |

render 自报 3m38.1s（capture 3m24.0s，2700/2700 帧）。
`npx --yes hyperframes@0.8.90 check`：**0 error / 0 warning / 12 info**（12 条 info 全部是 F4–F7 既有的 caption crossfade `content_overlap`，与本次改动无关）。

---

## 3. 验收证据（逐条给命令与输出/帧路径）

全片时间点下的抽帧目录：`/tmp/r3probe/film/t<秒>.png`（下同，命令形如
`ffmpeg -v error -ss <t> -i renders/worksplice-90s-v2.mp4 -frames:v 1 -y out.png`）。

### 3.1 英文素材证据 —— 每个上镜实拍帧全英文

| 镜 | 抽帧时间点 | 画面内容 |
| --- | --- | --- |
| F3 | 14s / 22s / 26s | board（五列都有卡）、channel（`#all` / `stream-sync` 等英文行）、cue2→cue3 |
| F4 | 29s / 32s / 35s | 唤醒行抵达、`WAKE` kicker、载荷卡 |
| F5 | 40s / 44s | 消息 feed + `read: seq 11` 位置线 |
| F6 | 49s / 55s / 60s / 66s | 插话抵达、HELD 印章、证据卡、修订后回复 |
| F7 | 70s / 74s / 76s | In-review 卡 + Approve/Reject 悬停、状态条、coral 印章 |

侧栏（F3/F5/F7 的 plate 里可见）在本次一并查过：`#all / stream-sync / bug-hunt / infra-cost / secretary-office`、agent 名 `Marlow / Iris / Rune / Nova / Quill / Susan` —— **全部英文**（放大对照图 `/tmp/r3probe/sidebar_check.png`）。

### 3.2 「采集源无 CJK」扫描命令与输出

```sh
$ cd capture-scripts && python3 - <<'PY'
import re, pathlib
CJK = re.compile(r'[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]')
total = 0
for p in sorted(pathlib.Path('.').glob('*')):
    if p.is_file():
        n = len(CJK.findall(p.read_text(errors='replace'))); total += n
        print(f'  {p.name:34s} CJK: {n}')
print('TOTAL:', total)
PY
  demo-add-cards.mjs                 CJK: 0
  demo-align-cuts.mjs                CJK: 0
  demo-capture.mjs                   CJK: 0
  demo-channel-take.mjs              CJK: 0
  demo-finish-cards.mjs              CJK: 0
  real-run-AGENTS.md                 CJK: 0
  real-run-capture.mjs               CJK: 0
  real-run-project-README.md         CJK: 0
  real-run-project-parser.js         CJK: 0
TOTAL: 0
```

实跑侧同一把尺子（驱动脚本运行时的自检，取自 `/tmp/ws-v2r3/out/timeline.log`）：

```
0.0s  pre-flight: Susan present? no
0.0s  pre-flight CJK rows (all channels): 0 (none)
18.3s quiet; rounds=1
24.6s WAKE posted 201 2 at 6.3s
24.7s INTERJECT posted 201 3 at 6.4s
44.5s REVISION MARKER at 26.3s
53.6s REPLY IN DB at 35.3s
69.7s MESSAGES: 4 rows; CJK rows: 0
69.7s ALL-CHANNEL CJK rows: 0
69.7s revise prompt saved 1659 CJK: false
```

英文约束落在两处 `AGENTS.md`（原文随包交付）：
- `capture-scripts/real-run-AGENTS.md`（agent dir，全局）
  `- The people in this workspace speak and write **English**. Always answer in English. / - Never reply in Chinese …`
- 实跑项目 `/tmp/ws-v2r3/project/AGENTS.md`（同内容 + repo 语境）

`PI_CODING_AGENT_DIR=/tmp/ws-v2r3/pi-agent/settings.json` = `{}`（**关键**），服务端启动日志：
`[worksplice] secretary auto-create skipped: no default model configured`。

### 3.3 demo 看板补卡（C）+ 新 revise prompt（A）

板面截图：`/tmp/r3probe/film/t14.png`（五列卡片）
计数（产品自己的表）：

```
#1 in_review  Quill      ← 原卡保留
#2 todo       -          #3 todo       -
#4 in_progress Nova      #5 in_progress Iris
#6 done       Marlow     #7 closed     Rune
→ Pool 2 / In progress 2 / In review 1 / Done 1 / Closed 1      （每列 ≥1 ✓）
```

新真跑的 revise prompt（**F6 证据卡三行的逐字来源**，`/tmp/ws-v2r3/out/revision-prompt.txt`）：

```
Your reply to channel parser-fix was held because the room changed while you were writing.
What happened: 1 new message(s) arrived in this target (seq 3)
The room is now at seq 3.

Messages that arrived while you were writing:
#3 @Owner: Hold on — splitting on commas breaks inside quoted fields. Explain the approach first, don't edit code.

Your held draft was:
---
I've read parser.js and README.md. Current splitFields naively splits on every comma and trims, …
```

卡片三行取值（每一行都是上面原文的逐字片段；第三行取 draft 的首句，README/STORYBOARD 已把它写明为**该次 revise prompt 的逐字摘录**）：

```
Your reply to channel parser-fix was held because the room changed while you were writing.
What happened: 1 new message(s) arrived in this target (seq 3)
Your held draft was: — I've read parser.js and README.md.
```

### 3.4 指针停位（E）

放大抽帧（`:400%` 缩放，`/tmp/r3probe/film_e_check.png`）：

| 镜 | 全片 t | 指针落点（页面坐标） | 结果 |
| --- | --- | --- | --- |
| F3 board | 14s | (760, 730) — In progress 列**卡片下方的空白列体** | 无遮字 ✓ |
| F3 channel | 22s | (1000, 158) — 列表上方**空白带**（该频道消息已满，原落点压在末条正文上，已改） | 无遮字 ✓ |
| F5 feed | 44s | (1700, 930) — 列表下边界**空白带** | 无遮字 ✓ |

### 3.5 F5（D）

- 位置线落在真实消息 **#11 与 #12 之间**：`messages.mp4` t=1.4 的行带测量 `… (699,705) / (742,748) …`，线占 y 720–730 ⇒ **GAP（不压任何文字）**；readout 显示 **`read: seq 11`**，ack 步进 **11 → 12**。
- feed 真的滚动：`messages.mp4` t=1 与 t=6 相差 **1 274 214 像素 = 61.4%**（`FEED SCROLLED`）。

### 3.6 F7 印章（B）

```
$ grep -n "A9D877\|F97264" compositions/frames/07-approve-by-other.html
147:      background: #F97264;
```
抽帧 `/tmp/r3probe/film/t76.png`：`APPROVE REQUIRES SOMEONE ELSE` 为 coral。

### 3.7 blackdetect（F）

```
$ ffmpeg -v info -i renders/worksplice-90s-v2.mp4 \
    -vf "blackdetect=d=0.2:pic_th=0.98:pix_th=0.10" -an -f null -
（无 black_start / black_end 行）
```
对照：改动前 `black_start:84 black_end:84.833333 black_duration:0.833333`。
F9 首帧亮像素占比实测：`t=84.02 → 0.00%`，`t=84.10 → 2.16%` ⇒ 黑段 ≈ **0.09s**，远小于 0.2s；终态亮像素 3.26%。

### 3.8 G / H / I 的改动前后对照

| 项 | 改前 | 改后 | 证据 |
| --- | --- | --- | --- |
| F3 cue3 落地 | cue3 起 10.44s ⇒ 全片 ~23.0s 才落齐 | cue3 起 9.42s ⇒ **21.8s 已完全落地** | `/tmp/r3probe/cue3_new.png`（21.8 / 22.0 / 22.2 三帧同文案，无残留 cue2） |
| F6 印章静止 | 落定 6.65s → 抬起 11.7s = **~5.05s 静止** | 落定 6.65s → 抬起 **8.35s** = **~1.7s**，随后切进 scrim/证据卡 | `grep -n "tl.to(held" compositions/frames/06-the-held-write.html` |
| F8 说明字号 | 27px（line-height 1.55） | **36px**（line-height 1.5，色 `#5F5A50`） | 抽帧 `/tmp/r3probe/film/t82.5.png`（两行说明明显变大，仍在 caption band 之上） |
| F4 载荷卡取值 | `targetId: "csv-split"`, `seq: 7` | `targetId: "parser-fix"`, `seq: 2`（= 本次真跑的频道与唤醒 seq） | 抽帧 `/tmp/r3probe/film/t35.png` |

### 3.9 文档同步（J）与几何回归

- `grep -c "parser\.js\|splitFields" STORYBOARD.md README.md` → 0 / 0；
  `grep -c "Chinese rows\|left as-is" README.md` → 0（旧的中文 caveat 已整段替换为「为什么这次是纯英文」的说明）。
- `.hyperframes/frame-packets/01,02,03-*.md`：storyboard 块与 `STORYBOARD.md` 同步，`parser.js` 命中 0，且每个包里**重复的第二份 storyboard 块已删除**。
- `storyboard.html` / `storyboard-v1.png`：**未改动**（关口 2 批准快照）；README 已写明它们早于 F1/F2 改动。
- F3 跳动框几何回归（`verify-f03-bracket.mjs`，对成片）：

```
step  column       target L/R  box L/R   ΔL  ΔR  chip text      IoU   2nd   column rules               verdict
0     Pool         429/615     429/615   0   0   "Pool"         0.72  0.50  429✓ 615✓ 801✓ 987✓ 1173✓  PASS
1     In progress  615/801     615/801   0   0   "In progress"  0.73  0.42  429✓ 615✓ 801✓ 987✓ 1173✓  PASS
2     In review    801/987     801/987   0   0   "In review"    0.75  0.37  429✓ 615✓ 801✓ 987✓ 1173✓  PASS
3     Done         987/1173    987/1173  0   0   "Done"         0.81  0.53  429✓ 615✓ 801✓ 987✓ 1173✓  PASS

PASS — 4/4 steps on their column, chip text matches
```

### 3.10 成片规格（ffprobe 全文见 `ffprobe.txt`）

```
codec_name=h264   width=1920   height=1080   pix_fmt=yuv420p
r_frame_rate=30/1   nb_frames=2700
format_name=mov,mp4,m4a,3gp,3g2,mj2   duration=90.000000
size=10577042   bit_rate=940181

# renders/sample-f2-f6.mp4 (gate-3 sample: F2 5s + F6 head 20s)
codec_name=h264   width=1920   height=1080   pix_fmt=yuv420p
r_frame_rate=30/1   nb_frames=750   duration=25.000000   size=1060969
```
`show_format`/`show_streams` 全量扫描中 `/Users|/tmp|/private` 命中 **0**。

### 3.11 样片

- `renders/sample-f2-f6.mp4` = **新的 F2** 5.0s（7.0–12.0s，避开 T=12 的 zoom-through）+ **F6 头** 20.0s（47.6–67.6s，避开 T=68 起的 crossfade），总 25.0s / 750 帧。
- 自检：t=3s 显示新 F2 卡面（`#7` · `In progress` · `TASK TITLE` · HELD chip）；
  t=24s 显示 F6 的**修订后回复**（Owner #1–#3 + Alice #4），**全英文**（`/tmp/r3probe/sample_check.png`、`/tmp/r3probe/s_t24.png`）。

### 3.12 双落盘

- worktree：`/Users/apple/orca/workspaces/worksplice/screencast-v2-rev2/.scratch/promote-worksplice/evidence/screencast-v2/`
- 主工作区：`/Users/apple/orca/worksplice/.scratch/promote-worksplice/evidence/screencast-v2/`（整份 rsync）
- worktree 与主工作区 `diff -rq` 一致；两边 `git status --porcelain` 均为空（`.scratch/` 已 gitignore）。
- 本地忽略：worktree 根 `.pi-lens.json` = `{"format":{"enabled":false}}` 并写入 `.git/info/exclude`；全程未跑任何整份重写/格式化命令；未改仓库源码（`lib/`、`app/`、`scripts/`、根 `AGENTS.md` 一行未动）。
- 构建/采集副产物（`node_modules/`、`.next/`、`demo/`）均已被仓库 `.gitignore` 覆盖，主工作区 `git status` 仍为空。
- 本票无任何发布动作：未上传 Release、未推 npm、未发任何消息、未登录/登出账号、未操作用户自有标签页。

---

## 4. 需要 coordinator 知道的两处判断（本票内的主动取舍）

1. **demo 房间的中文频道名**：种子脚本创建的秘书频道名叫 `秘书办公室`，它会出现在 F3/F5/F7 的侧栏里，违反「肉眼全英文」。产品**没有 rename API**，因此我在自己的 demo 数据目录里把该频道的 name/description 改成英文（`secretary-office` / `The secretary's 1:1 channel`）——只改数据、不改源码，且该房间在片中被明确标注 `DEMO DATA`。若希望改成「干脆不出现这个频道」，回话即可（一次重采 + 重渲）。
2. **F6 证据卡第三行是 draft 首句**：本次真跑的 held draft 是**一整段**（不像上一版是短首行），卡片一行放不下 ~185 字符。取 draft 的**首句** `I've read parser.js and README.md.`（逐字，未改一个字符），并在 README/STORYBOARD 里把它写明为「那次 revise prompt 的逐字摘录」。若要求必须凑出「短首行」的草稿，需要按新的英文草稿规范再跑一次真跑（约 10 分钟 + 模型调用），回话即可。

---

## 5. 等待用户第 4 关成片验收

成片：`renders/worksplice-90s-v2.mp4`（90.0s / 1920×1080 / 30fps / H.264 / 10.6MB）
样片：`renders/sample-f2-f6.mp4`（25.0s，新 F2 + F6 头）
**等待用户第 4 关成片验收。**
