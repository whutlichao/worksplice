import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

// R4 的自动断言：`GET /api/sessions/[id]/export` 端到端跑通（真会话文件 + 真 exporter），
// 只断言外部可观测的东西——状态码、Content-Type、Content-Disposition、导出 HTML 里的事实。
//
// 刻意**不做** HTML 快照：快照会把上游模板形态钉死，下次升级要么假红要么没人敢动
// （见 `.scratch/pi-sdk-upgrade-1.5/spec.md` 的 Testing Decisions）。这条测试要守住的是
// 「导出这条路没有在升级中挂掉」——1.5.2 之前这里靠逐字字符串锚点给上游模板打补丁，
// 上游把三个递归函数改成显式栈后锚点全消失，路由直接 500；补丁删除后本测试转绿。
//
// 隔离：导出的 id 解析走 SDK 的默认 sessions 目录（`~/.pi/agent/sessions`），
// 这里把 agent dir 换到临时目录，绝不读使用者的真实会话。

const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-export-route-"));
const agentDir = path.join(root, "agent");
const cwd = path.join(root, "cwd");
fs.mkdirSync(agentDir, { recursive: true });
fs.mkdirSync(cwd, { recursive: true });
process.env.PI_CODING_AGENT_DIR = agentDir;

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { GET } = await jiti.import("./route.ts");

const manager = SessionManager.create(cwd);
manager.appendMessage({ role: "user", content: "export-route-probe: hello from the user" });
manager.appendMessage({
  role: "assistant",
  content: [{ type: "text", text: "export-route-probe: hello from the assistant" }],
  provider: "test-provider",
  model: "test-model",
  timestamp: Date.now(),
});
const sessionId = manager.getSessionId();

test.after(() => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  fs.rmSync(root, { recursive: true, force: true });
});

function callExport(id = sessionId, query = "") {
  return GET(new Request(`http://127.0.0.1/api/sessions/${id}/export${query}`), {
    params: Promise.resolve({ id }),
  });
}

/**
 * 导出文档把会话数据以 base64 放在 `<script id="session-data" type="application/json">` 里，
 * 正文由页面脚本渲染——所以「会话正文进了导出文件」只能从这份载荷上验。取不到就显式报错，
 * 而不是静默降级成「只要 200 就算过」。
 */
function exportedSessionPayload(html) {
  const match = html.match(/<script id="session-data" type="application\/json">([^<]+)<\/script>/);
  assert.ok(match, "导出文档必须带 session-data 数据块");
  return JSON.parse(Buffer.from(match[1].trim(), "base64").toString("utf8"));
}

test("exporting a session returns 200 with a real HTML document (no upstream-patch dependency)", async () => {
  const response = await callExport();
  assert.equal(response.status, 200, await response.clone().text());

  const contentType = response.headers.get("content-type") ?? "";
  assert.match(contentType, /^text\/html; charset=utf-8$/);

  const html = await response.text();
  assert.equal(html.startsWith("<!DOCTYPE html>"), true, "导出必须是完整 HTML 文档");
  assert.equal(html.trimEnd().endsWith("</html>"), true);
  // 会话正文真的进了导出的数据载荷（不是空模板）。
  const payload = JSON.stringify(exportedSessionPayload(html));
  assert.equal(payload.includes("hello from the user"), true);
  assert.equal(payload.includes("hello from the assistant"), true);

  // 默认下载形态：attachment。
  assert.match(response.headers.get("content-disposition") ?? "", /^attachment; filename="/);
});

test("?inline=1 switches Content-Disposition to inline without changing the document", async () => {
  const response = await callExport(sessionId, "?inline=1");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-disposition") ?? "", /^inline; filename="/);
  assert.equal((await response.text()).startsWith("<!DOCTYPE html>"), true);
});

test("an unknown session id is a 404 JSON error, not a 500", async () => {
  const response = await callExport("00000000-0000-4000-8000-000000000000");
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Session not found" });
});
