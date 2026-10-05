import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const assetPath = path.join(here, "SYSTEM-GUIDE.md");
const content = fs.readFileSync(assetPath, "utf8");
const lines = content.split(/\r?\n/);

test("SYSTEM-GUIDE.md 手册：篇幅 ~700 行预算内（spec §5.3/§5.4）", () => {
  assert.ok(lines.length <= 700, `got ${lines.length} lines`);
  assert.ok(lines.length >= 300, `suspiciously short: ${lines.length} lines`);
});

test("SYSTEM-GUIDE.md 手册：首行来源注明（§8.4-1，含「草稿」二字）", () => {
  assert.match(lines[0], /基于 spec-bootstrap-agent\.md 草稿 2026-08-08 撰写/);
});

test("SYSTEM-GUIDE.md 手册：5 章齐全（spec §5.3）", () => {
  const chapters = lines.filter((l) => /^## \d+\./.test(l));
  assert.equal(chapters.length, 5);
  assert.deepEqual(
    chapters.map((c) => c.replace(/^## \d+\.\s*/, "")),
    [
      "产品概念",
      "系统 API 用法",
      "常见操作路径",
      "权限边界与兜底话术",
      "术语表",
    ],
  );
});

test("SYSTEM-GUIDE.md 手册：§1 概念 8 节齐全且每节附「秘书用不用得上」（spec §5.3-1）", () => {
  const section1 = content.split("## 2. 系统 API 用法")[0];
  for (const concept of ["频道与 thread", "任务板", "提醒", "inbox 与 wake", "搜索", "附件", "reaction", "pinned"]) {
    assert.ok(section1.includes(concept), `missing concept: ${concept}`);
  }
  const withUsefulness = section1.match(/秘书用不用得上/g) ?? [];
  assert.ok(withUsefulness.length >= 8, `found ${withUsefulness.length} usefulness notes`);
});

test("SYSTEM-GUIDE.md 手册：§2 地址来源要点（base URL/loopback 放行/无运行时发现）", () => {
  assert.match(content, /127\.0\.0\.1:30141/);
  assert.match(content, /loopback 恒放行/);
  assert.match(content, /无运行时发现/);
  assert.match(content, /-u pi:<密码>/);
});

test("SYSTEM-GUIDE.md 手册：§2 只读类 8 接口 + 创建类 5 接口 curl 齐全（spec §5.3-2）", () => {
  const curls = content.match(/^curl -s[^\n]*$/gm) ?? [];
  const joined = curls.join("\n");
  const endpoints = [
    "http://127.0.0.1:30141/api/channels",
    "http://127.0.0.1:30141/api/members",
    "/api/channels/<channelId>/messages",
    "/api/channels/<channelId>/tasks",
    "/api/reminders",
    "--data-urlencode \"q=关键词\"",
    "/api/members/<agentId>/inbox",
    "/api/models",
    "-X POST http://127.0.0.1:30141/api/messages",
    "-X POST http://127.0.0.1:30141/api/channels",
    "-X POST http://127.0.0.1:30141/api/members",
    "-X POST http://127.0.0.1:30141/api/tasks",
    "-X POST http://127.0.0.1:30141/api/reminders",
  ];
  for (const endpoint of endpoints) {
    assert.ok(joined.includes(endpoint), `missing curl for ${endpoint}`);
  }
});

test("SYSTEM-GUIDE.md 手册：§2 典型错误 400/404/409 held 有说明", () => {
  assert.match(content, /400/);
  assert.match(content, /404/);
  assert.match(content, /409/);
  assert.match(content, /held/);
  assert.match(content, /"held":true,"roomSeq"/);
});

test("SYSTEM-GUIDE.md 手册：§4 三条共律 + 兜底三话术完整版（02 契约 §4）", () => {
  assert.match(content, /不硬编/);
  assert.match(content, /不假装成功/);
  assert.match(content, /不越权/);
  assert.match(content, /重试一次/);
  assert.match(content, /如实说不确定/);
  assert.match(content, /引导 Owner UI/);
});

test("SYSTEM-GUIDE.md 手册：手册更新流程随资产交付（§8.4-2）", () => {
  assert.match(content, /手册更新流程/);
  assert.match(content, /查 §5\.4 来源/);
  assert.match(content, /更新(手册)?首行日期/);
});

test("SYSTEM-GUIDE.md 手册：§5 术语表含关键术语（主 spec §1.3 + 秘书语境）", () => {
  const section5 = content.split("## 5. 术语表")[1] ?? "";
  for (const term of ["channel", "thread", "seq", "inbox", "freshness-hold", "target", "任务板", "提醒", "pinned", "FTS"]) {
    assert.ok(section5.includes(term), `missing glossary term: ${term}`);
  }
  assert.match(section5, /秘书/);
  assert.match(section5, /事件系统消息/);
});
