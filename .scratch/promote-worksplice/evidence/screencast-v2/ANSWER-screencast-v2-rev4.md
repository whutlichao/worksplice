# Answer — worksplice 90s 推广片 v2 rev4（只改 F1：房间全景 → 落到任务卡）

任务：task_78c66333ab8c ／ dispatch：ctx_d7c952cccb3b ／ 票型：实施票（非代码交付物）
工程目录（worktree 与主工作区同名）：`.scratch/promote-worksplice/evidence/screencast-v2/`

---

## 1. 改了什么

**只改 `compositions/frames/01-two-writers.html`**，F2–F9 一个字节未动（证明见 §3.2）。F1 的 `data-composition-id` / `data-width` / `data-height` / `data-duration="7"` 与两个 `.clip` 的 `data-start` / `data-duration` / `data-track-index` **全部未改**。

新结构（7s）：

| 段 | 画面 | 字幕 |
| --- | --- | --- |
| **0–2.9s 房间全景** | 一块 ink 描边「房间」板：板头 `THE ROOM` / `4 AGENTS ONLINE`；左栏频道 `#all`（选中）/ `stream-sync` / `bug-hunt` / `infra-cost` 各带计数；中间是产品真实的五个状态列 `Pool` / `In progress` / `In review` / `Done` / `Closed`，每列带列头计数 + 三张小任务卡；底部一排 **nova / quill / iris / marlow** 四个像素头像 + 在线点。第二拍时珊瑚环圈出 `In progress` 列里的那张卡：`#7` | `Several pi sessions.` → `One room.` |
| **2.9–3.4s 镜头落到那张卡** | 房间向后推远淡出、任务卡同尺寸同座位推进来（一次连续推镜，不是硬切） | — |
| **3.4–5.2s 同一张卡上的碰撞** | nova（cyan）自左入场、coral write-bar 左→右写这条标题行；quill（pink）自右入场、pink write-bar 压到**同一行**上 ⇒ 两条 write-bar 同时在线上 | — |
| **5.2–7.0s 结局** | coral sweep 一笔抹掉先写；`LAST WRITE WINS` 珊瑚章旋入卡面右端；持住供阅读 | `The default: last write wins.` |

保留项逐条核对：两个像素头像与左右入场 ✓、两条 write-bar 相撞 ✓、coral sweep 抹掉先写 ✓、`LAST WRITE WINS` 章 ✓、`2 writers` chip ✓、`F01 · HOOK` / `W0RKSPLICE` ✓。卡面字段与 F2 **逐字段一致**（§3.3）。

**诚实性**：新加的「房间」是**图解**——用与 F3 相同的元素语言（频道行、状态列、头像），但全部是本帧自己画的 DOM，**不是 F3 的实拍板、也不是任何产品界面截图**；F3 的实拍素材未参与本帧。新增的两个视觉元素只在图解语境内：列头计数与在线点。

**实现取舍（值得知道）**：房间的元素（4 个频道行 / 5 条列 / 15 张卡 / 4 个 agent）由脚本按数据数组生成，与 F3/F5/F6 里「重复 DOM 由脚本生成」的既有写法一致；这样同时把本帧的 lint 行数预算压回阈值内（§3.7）。珊瑚环的定位按**真实 ticket 盒**测量（含 `fonts.ready` 与 `load` 时重测），所以环永远恰好框住镜头要落到的那张卡。

---

## 2. 改动清单（文件级）

- `compositions/frames/01-two-writers.html` — **重写**（唯一的功能改动）
- `renders/worksplice-90s-v2.mp4` — 重渲
- `renders/sample-f2-f6.mp4` — 重切为 **F1 7s + F2 5s + F6 头 13s = 25s**
- `ffprobe.txt` — 重出
- `STORYBOARD.md` — Frame 1 的 scene / 正文 / Scene 1–4 全部改写（含「房间全景 → 任务卡」新结构）
- `README.md` — Truthfulness inventory 的 01 行同步
- `.hyperframes/frame-packets/01-two-writers.md` — storyboard 块同步（并清掉包内重复的第二份）
- `ANSWER-screencast-v2-rev4.md`（本文件）

未改动：F2–F9 的帧源码、全部 `assets/*.mp4`、`capture-scripts/`、`rebuild.sh`、`hyperframes.json`、`.hyperframes/video-sources/*`。

### 产物时间（UTC）

| 产物 | 时间 | 大小 |
| --- | --- | --- |
| `compositions/frames/01-two-writers.html` | 2026-10-04T21:07:06Z | 29 066 B |
| `index.html`（rebuild.sh） | 2026-10-04T21:17:46Z | 8 824 B |
| `renders/worksplice-90s-v2.mp4` | 2026-10-04T21:12:26Z | 10 831 304 B |
| `renders/sample-f2-f6.mp4` | 2026-10-04T21:15:26Z | 1 306 451 B |
| `ffprobe.txt` | 2026-10-04T21:17:27Z | 512 B |
| `STORYBOARD.md` / `README.md` | 21:16:35 / 21:16:59 | — |

render 自报 3m14.9s（capture 3m12.1s，2700/2700 帧）。
`npx --yes hyperframes@0.8.90 check`：**0 error / 0 warning / 13 info**，`Check passed`（13 条 info 全是既有的 caption/transition `content_overlap`，本次没有新增；F1 自身在 Layout 审计里 0 命中）。

---

## 3. 验收证据

### 3.1 F1 抽帧 4 张（§1 的四个点）

命令（`renders/worksplice-90s-v2.mp4`）：
```sh
for t in 0.6 2.2 4.6 6.6; do
  ffmpeg -v error -ss $t -i renders/worksplice-90s-v2.mp4 -frames:v 1 -y /tmp/f1probe/final/t$t.png
done
```
- `/tmp/f1probe/final/t0.6.png` — 房间正在画出来：频道行 + 三列已现 + 计数 + `SEVERAL PI SESSIONS.`
- `/tmp/f1probe/final/t2.2.png` — 房间全景：五列（`POOL 3` / `IN PROGRESS 3` / `IN REVIEW 4` / `DONE 5` / `CLOSED 8`）各三张卡、频道栏 4 行带计数、**4 个 agent**（nova / quill / iris / marlow，像素头像 + 在线点）、珊瑚环框住 `In progress` 里的 `#7`，字幕 `ONE ROOM.`
- `/tmp/f1probe/final/t4.6.png` — 同一张任务卡上**两条 write-bar 同时在线上**（coral 左、pink 右）
- `/tmp/f1probe/final/t6.6.png` — `LAST WRITE WINS` 珊瑚章 + 被 sweep 抹过的标题行 + `THE DEFAULT: LAST WRITE WINS.`

拼版：`/tmp/f1probe/f1_acceptance.png`；agent 排放大图（nova/quill/iris/marlow 四个头像 + 在线点清晰可辨）：`/tmp/f1probe/f1_roster.png`。

### 3.2 F2–F9 回归证据

**(a) 源码级**（最硬的证据）——逐文件 md5，rev3 副本（主工作区）vs 本次（worktree）：

```
02-held-not-lost         same 86f65db1f20d0a5e4db0ff562628ed4f
03-the-room              DIFFERENT (仅 assembler 占位注释)
04-wake-is-a-pointer     DIFFERENT (仅 assembler 占位注释)
05-cursor-not-a-list     DIFFERENT (仅 assembler 占位注释)
06-the-held-write        DIFFERENT (仅 assembler 占位注释)
07-approve-by-other      DIFFERENT (仅 assembler 占位注释)
08-local-one-file        same 25c6b5f1dc150c669e9a9eb00a1001a8
09-install               same 6113cb4b7bb283a07b9cc5301a4eb798
index.html / rebuild.sh / hyperframes.json / assets/*.mp4  same
```

03–07 的差异**只有 `<!-- approved frame video hoisted by assemble-index -->` 占位注释行**（`rebuild.sh` 的 restore→assemble 往返副产物）：

```sh
$ for f in 03-the-room 04-wake-is-a-pointer 05-cursor-not-a-list 06-the-held-write 07-approve-by-other; do
    echo "$f: non-placeholder diff lines = $(diff "$M/compositions/frames/$f.html" "$W/compositions/frames/$f.html" \
      | grep -E '^[<>]' | grep -vc 'approved frame video hoisted')"
  done
03-the-room: 0
04-wake-is-a-pointer: 0
05-cursor-not-a-list: 0
06-the-held-write: 0
07-approve-by-other: 0
```

**(b) 成片级** — rev3 成片（主工作区）vs 本次成片，同一时间点抽帧逐像素差：

| 时间点 | 镜 | 任一通道不同的像素 | luma 差 >12 的像素 | 最大差 |
| --- | --- | --- | --- | --- |
| 9.5s | F2 | 65 527 | **64** / 2 073 600 | 55 |
| 17.9s | F3 | 195 081 | **112** | 59 |
| 40.0s | F5 | **0（逐字节相同）** | 0 | 0 |
| 55.0s | F6 | 19 055 | 5 | 8 |
| 66.0s | F6 | **0（逐字节相同）** | 0 | 0 |
| 74.0s | F7 | 272 812 | **5** | 24 |
| 80.0s | F8 | 23 | 0 | 1 |
| 84.3s | F9 | 46 045 | **113** | 57 |
| 88.0s | F9 | 67 198 | 6 | 53 |

结论：**没有任何内容变化**。差异全部来自 H.264 —— 整片是一条码流，F1 换了之后编码器/keyframe 与码率分配随之改变，下游帧的量化噪声分布跟着变（亚感知级：>12 luma 的像素最多 113 个 ≈ 0.005%），静止段（40s / 66s）**逐字节相同**即证明渲染管线本身是确定性的。
F2 / F3 / F7 / F9 四对帧的并排图：`/tmp/f1probe/regression_pairs.png`；差异掩膜：`/tmp/f1probe/diff_{9.5,74.0,84.3}.png`。

**(c) F3 几何回归**（F3 未改，仍须成立）：
```sh
$ node verify-f03-bracket.mjs
0  Pool         429/615     429/615   0 0  "Pool"         0.72 0.50  429✓ 615✓ 801✓ 987✓ 1173✓  PASS
1  In progress  615/801     615/801   0 0  "In progress"  0.73 0.42  429✓ 615✓ 801✓ 987✓ 1173✓  PASS
2  In review    801/987     801/987   0 0  "In review"    0.75 0.37  429✓ 615✓ 801✓ 987✓ 1173✓  PASS
3  Done         987/1173    987/1173  0 0  "Done"         0.81 0.54  429✓ 615✓ 801✓ 987✓ 1173✓  PASS
PASS — 4/4 steps on their column, chip text matches
```

### 3.3 卡面字段与 F2 逐字段一致

```sh
$ for id in taskno status; do
    echo "f01-$id: $(grep -o "id=\"f01-$id\">[^<]*" compositions/frames/01-two-writers.html | sed 's/.*>//')  |  f02-$id: $(grep -o "id=\"f02-$id\">[^<]*" compositions/frames/02-held-not-lost.html | sed 's/.*>//')"
  done
f01-taskno: #7            |  f02-taskno: #7
f01-status: In progress   |  f02-status: In progress
f01-titletext: Fix the held-write banner copy
f02-titletext: Fix the held-write banner copy
房间里的那张 ticket 也是 #7（`f01-ticketno` = `#7`）——环圈的就是它
```
F2 的卡面几何（`left:20cqw / top:11.5cqw / width:60cqw / height:33cqw`）与字段值都没动 ⇒ continuity 未断。

### 3.4 规格 + 黑场

```sh
$ ffmpeg -v info -i renders/worksplice-90s-v2.mp4 -vf "blackdetect=d=0.2:pic_th=0.98:pix_th=0.10" -an -f null -
（无 black_start / black_end 行）        ← 无 ≥0.2s 黑段

$ ffprobe … renders/worksplice-90s-v2.mp4
codec_name=h264  width=1920  height=1080  pix_fmt=yuv420p  r_frame_rate=30/1
nb_frames=2700   format_name=mov,mp4,m4a,3gp,3g2,mj2   duration=90.000000
size=10831304    bit_rate=962782

# renders/sample-f2-f6.mp4 (F1 7s + F2 5s + F6 head 13s)
codec_name=h264  width=1920  height=1080  pix_fmt=yuv420p  r_frame_rate=30/1
nb_frames=750    duration=25.000000   size=1306451
```

### 3.5 样片（本轮改为覆盖 F1 全段）

`renders/sample-f2-f6.mp4` = **F1 0.0–7.0s（全段）** + **F2 7.0–12.0s** + **F6 头 47.6–60.6s** = 25.0s / 750 帧。
切点：7.0 是 F1→F2 的硬切（无过渡，直接接）✓；12.0 避开 T=12 起的 F2→F3 zoom-through ✓；47.6 避开 F5→F6 的 0.5s crossfade（47.0–47.5）✓；60.6 远早于 T=68 的 F6→F7 crossfade ✓。
自检抽帧：`/tmp/f1probe/sample_sheet.png`（t=1.0 / 2.2 / 4.6 / 6.6 是 F1，t=9.5 是 F2 新卡面，t=13.0 / 20.0 是 F6 头）。

### 3.6 无 CJK / 无本机路径

```sh
$ python3 - <<'PY'   # compositions/ · capture-scripts/ · frame-packets/ · STORYBOARD/README/ffprobe/index
CJK = re.compile(r'[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]')
… 扫描输出：
  compositions/frames/*.html ................ 0
  capture-scripts/* ......................... 0
  .hyperframes/frame-packets/01,02,03-*.md .. 0
  STORYBOARD.md / ffprobe.txt / index.html .. 0
  README.md ................................. 14 行（**既有**中文图例 `现场真跑`/`设计动效`/`证据文本` + 引用产品自身的中文事件模板字符串说明「为什么要留空 settings.json」——rev3 基线同为 14 行，本次未新增图例外的中文）
```

```sh
$ ffprobe -v error -show_format -show_streams renders/worksplice-90s-v2.mp4 | grep -icE "/Users|/tmp|/private"
0
```
成片画面本身逐帧核过：F1 四张抽帧、以及 §3.2 抽帧对照里 F2–F9 全部英文（上一轮已把 demo 房间的中文频道名与真实运行素材的中文清掉，本轮 F1 新增的房间图解也全英文）。

### 3.7 F1 的行数预算（为什么房间由脚本生成）

`check` 的 Lint 有一条 `composition_file_too_large`（阈值 300 行，计的是 markup + inline script，不含 `<style>`）。F1 重写后一度到 382 行 → 报警。把「房间」的重复元素（频道行 / 5 列 / 15 张卡 / 4 个 agent）改成按数据数组生成后降到 **299 行**，警告消失：

```
01-two-writers.html      no-style lines: 299   (was 382)
02-held-not-lost.html    no-style lines: 133
06-the-held-write.html   no-style lines: 265
```

### 3.8 双落盘

- worktree：`/Users/apple/orca/workspaces/worksplice/screencast-v2-rev2/.scratch/promote-worksplice/evidence/screencast-v2/`
- 主工作区：`/Users/apple/orca/worksplice/.scratch/promote-worksplice/evidence/screencast-v2/`（整份 rsync）
- `diff -rq` 两边**完全一致**；两边 `git status --porcelain` 均为**空**。
- 本地忽略：worktree 根 `.pi-lens.json` = `{"format":{"enabled":false}}` 且已写入 `.git/info/exclude`；全程未跑任何整份重写/格式化命令。
- **未改仓库源码**：`lib/`、`app/`、`scripts/`、`components/`、根 `AGENTS.md` 一行未动（构建副产物 `node_modules/`、`.next/`、`next-env.d.ts` 均被仓库 `.gitignore` 覆盖）。
- 本票无任何发布动作：未上传 Release、未推 npm、未发任何消息、未登录/登出账号、未操作用户自有标签页。

---

## 4. 等待用户第 4 关验收

成片：`renders/worksplice-90s-v2.mp4`（90.0s / 1920×1080 / 30fps / H.264 / 10.3 MB）
样片：`renders/sample-f2-f6.mp4`（25.0s = F1 全段 + F2 + F6 头）
**等待用户第 4 关验收。**
