# 90 秒录屏的产出记录（2026-10-03）

**成品**：`worksplice-90s.mp4` — 90.0s / 1600×900 / 30fps / H.264 / 6.4 MB / 无音轨（纯字幕）
永久地址：https://github.com/whutlichao/worksplice/releases/download/v0.1.0/worksplice-90s.mp4

## 怎么做的（以及为什么不是"录屏"）

本机文件沙箱**没有屏幕录制权限**（`screencapture -v` 直接失败），所以没有走"录一张屏幕"的路。
改用：**ego-browser 驱动真实页面 → 逐镜截真图 → ffmpeg 做运镜与拼接**。

- 截图为 1920×1080 的**真实页面**（`page.screenshot`），字幕条是截图前注入页面的 DOM 条，
  因此字幕是烧进画面的，不依赖 ffmpeg 字体。
- 运镜（推近/平移）由 ffmpeg `zoompan` 完成；**字幕条单独叠加、不参与运镜**——第一版把字幕
  一起裁掉了，这是修正后的做法。
- 第 5–7 镜是**真跑**：Release 构建 + 真实模型（免费模型），用
  `PROMPT_LANG=en INTERJECT_DELAY_SECONDS=6` 跑 `scripts/evidence/part-b-real-run.sh`，
  浏览器同步按"界面渲染出的 `#seq` 徽标数"抓 1/2/3 条消息三个瞬间。
- 第 8 镜是**真实 revise prompt 原文**（`/tmp/live3/artifacts6/part-b-revision-prompt.txt`）渲染。
- 第 9 镜是 README「How it relates to other tools」一节的原文渲染。

## 复现步骤

1. `node bin/worksplice.js --demo --port 3120 --no-open` 起演示服务 → 截 1–4、9 镜
   （界面语言设为 `en`；任务板切 Board 靠 `localStorage["worksplice-task-view"]="board"`）。
2. 起一台**非演示**服务（Release 资产装出来的那份）+ `PI_CODING_AGENT_DIR` 指向临时目录
   （最小 settings.json + 符号链接真实 models.json，密钥不复制）。
3. 跑 `PROMPT_LANG=en INTERJECT_DELAY_SECONDS=6 bash scripts/evidence/part-b-real-run.sh`，
   同时用 ego-browser 盯该频道抓帧（按 DOM 渲染条数判定，不要按 API 判定——界面 3 秒一轮）。
4. `python3 gen-clips.py` 生成 13 个片段 → concat → 二次编码（CRF 29，加首尾淡入淡出）。

## 踩过的坑（下次直接照做）

- API 已返回 N 条 ≠ 界面已渲染 N 条：界面 3 秒轮询，必须等它追平（否则截到空频道）。
- 侧栏新频道要等它自己轮询出现；不出现就 reload（hash 深链 `#c/<id>` 不选中频道）。
- 每个 origin 的 `localStorage` 语言独立：换端口后要重设 `worksplice-locale=en`。
- 端口会被先前遗留的 dev server 占用，且 `pkill -f "port NNNN"` 匹配不到——用
  `pkill -f worksplice` 清；起服务后**先确认 `/api/channels` 只有 `#all`** 再开拍。
