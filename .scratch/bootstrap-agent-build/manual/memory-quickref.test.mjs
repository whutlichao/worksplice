import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const assetPath = path.join(here, "MEMORY.md");
const content = fs.readFileSync(assetPath, "utf8");
const lines = content.split(/\r?\n/);

test("MEMORY.md 速查：篇幅 ≤150 行（spec §5.2 预算）", () => {
  assert.ok(lines.length <= 150, `got ${lines.length} lines`);
});

test("MEMORY.md 速查：首行来源注明（§8.4-1）", () => {
  assert.match(lines[0], /基于 spec-bootstrap-agent\.md 草稿 2026-08-08 撰写/);
});

test("MEMORY.md 速查：5 章齐全（spec §5.2）", () => {
  const chapters = lines.filter((l) => /^## \d+\./.test(l));
  assert.equal(chapters.length, 5);
  assert.deepEqual(
    chapters.map((c) => c.replace(/^## \d+\.\s*/, "")),
    [
      "身份与开口规则",
      "能力边界（硬性）",
      "操作速查（bash + curl，7 条全部实测可用）",
      "SYSTEM-GUIDE.md 读取指引",
      "当前工作 / 工作流程 / Skill 使用",
    ],
  );
});

test("MEMORY.md 速查：保留 ADR-0001「当前工作」节名", () => {
  assert.ok(lines.some((l) => l.trim() === "### 当前工作"));
});

test("MEMORY.md 速查：base URL 声明含默认端口/自定义端口/密码提示", () => {
  assert.match(content, /127\.0\.0\.1:30141/);
  assert.match(content, /自定义端口/);
  assert.match(content, /-u pi:<密码>/);
});

test("MEMORY.md 速查：7 条一行式 curl（频道/成员/消息/频道建/agent/搜索/提醒）", () => {
  const curls = content.match(/`curl -s[^`]*`/g) ?? [];
  assert.equal(curls.length, 7);
  const joined = curls.join("\n");
  for (const endpoint of [
    "http://127.0.0.1:30141/api/channels`",
    "http://127.0.0.1:30141/api/members`",
    "-X POST http://127.0.0.1:30141/api/messages",
    "-X POST http://127.0.0.1:30141/api/channels",
    "-X POST http://127.0.0.1:30141/api/members",
    "--data-urlencode \"q=关键词\" http://127.0.0.1:30141/api/search",
    "-X POST http://127.0.0.1:30141/api/reminders",
  ]) {
    assert.ok(joined.includes(endpoint), `missing curl for ${endpoint}`);
  }
});

test("MEMORY.md 速查：建 agent 前先 GET /api/models 的提示", () => {
  assert.match(content, /先.*GET \/api\/models/);
});

test("MEMORY.md 速查：兜底三话术速记与不可做清单在内", () => {
  assert.match(content, /不硬编答案/);
  assert.match(content, /不假装成功/);
  assert.match(content, /引导 Owner UI/);
  assert.match(content, /不主动认领任务/);
});

test("MEMORY.md 速查：SYSTEM-GUIDE 映射表（概念/API/怎么X/权限）", () => {
  assert.match(content, /概念不懂/);
  assert.match(content, /API 不会调/);
  assert.match(content, /怎么 X/);
  assert.match(content, /越权边界/);
});
