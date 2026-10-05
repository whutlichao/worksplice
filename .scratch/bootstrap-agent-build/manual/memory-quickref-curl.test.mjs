// MEMORY.md 速查 §3 的 7 条一行式 curl 全链路复验（spec-bootstrap-agent.md §9.2-5，构建 effort ticket 08）
// 用法：先起隔离实例（临时 WORKSPLICE_DATA_DIR + 端口，避免污染真实数据），再
//   PORT=30142 node --test .scratch/bootstrap-agent-build/manual/memory-quickref-curl.test.mjs
// 环境变量 PORT 覆盖目标端口（默认 30142，手册正文为默认 30141，回放时替换）。
// 覆盖：7 条速查 curl 全部 2xx 可用 + §9.2-1 启动自动创建 Susan（curl 可见）+
// §9.2-2 事件系统消息经 curl 可见（建频道报到 / 建 agent 欢迎）+ §9.2-3 静默加入（无欢迎 Susan 自己）。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const BASE_PORT = process.env.PORT ?? "30142";
const BASE = `http://127.0.0.1:${BASE_PORT}`;
const HOSTPORT = `127.0.0.1:${BASE_PORT}`;
const TEST_PROVIDER = "opencode-go";
const TEST_MODEL = "deepseek-v4-flash";
const TEST_THINKING = "max";
const manual = fs.readFileSync(path.join(here, "MEMORY.md"), "utf8");

const curl = (args) =>
  execFileSync("curl", ["-s", ...args], { encoding: "utf8", timeout: 30000 }).trim();

function jsonStatus(args) {
  const code = execFileSync("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", ...args], {
    encoding: "utf8",
    timeout: 30000,
  });
  return Number(code);
}

/** 提取 MEMORY.md §3 操作速查表的 7 条 curl（表行形态：`| 用途 | \`curl ...\` |`）。 */
function quickRefCurls() {
  const table = manual.slice(manual.indexOf("| 用途 |"), manual.indexOf("## 4."));
  const rows = table.match(/\| `curl [^`]+` \|/g) ?? [];
  return rows.map((row) => row.replace(/^\| `/, "").replace(/` \|$/, ""));
}

function buildArgs(cmd) {
  const raw = cmd.split(/\s+/).slice(1);
  const tokens = [];
  for (let i = 0; i < raw.length; i++) {
    let t = raw[i];
    if ((t.startsWith("'") || t.startsWith('"')) && !(t.length > 1 && t.endsWith(t[0]))) {
      while (!(t.length > 1 && t.endsWith(t[0])) && i + 1 < raw.length) {
        t += " " + raw[++i];
      }
    }
    t = t.replace(/^'/, "").replace(/'$/, "").replace(/^"/, "").replace(/"$/, "");
    tokens.push(t);
  }
  const args = [];
  let method = "GET";
  let url = "";
  const queryParams = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === "-X") method = tokens[++i];
    else if (t === "-H") args.push("-H", tokens[++i]);
    else if (t === "-d") args.push("-d", tokens[++i]);
    else if (t === "-G") { /* 查询参数在下方拼接 */ }
    else if (t === "--data-urlencode") {
      const kv = tokens[++i];
      const [k, ...v] = kv.split("=");
      queryParams.push(`${k}=${encodeURIComponent(v.join("="))}`);
    }
    else if (t.startsWith("http")) url = t;
  }
  if (queryParams.length > 0) {
    url += (url.includes("?") ? "&" : "?") + queryParams.join("&");
  }
  return { method, url, headers: args };
}

function fillPlaceholders(s) {
  return s
    .replace(/<provider>/g, TEST_PROVIDER)
    .replace(/<modelId>/g, TEST_MODEL)
    .replace(/<thinkingLevel>/g, TEST_THINKING)
    .replace(/127\.0\.0\.1:30141/g, HOSTPORT);
}

/** 逐条回放速查表：成功类全部 2xx（表内无错误示例）。 */
test("§9.2-5 MEMORY.md 速查 7 条 curl 全链路回放（全部 2xx）", () => {
  // -G 回归守卫：buildArgs 对 -G 分支是"重合成 GET"而非透传，丢 -G 的改动不会自然失败——
  // 显式断言搜索行保留 -G（否则 --data-urlencode 语义变成 POST body，服务端 405）
  const searchRow = quickRefCurls().find((c) => c.includes("/api/search"));
  assert.ok(searchRow.includes("-G"), "search quick-ref must keep -G (GET + --data-urlencode)");
  const curls = quickRefCurls();
  assert.equal(curls.length, 7, `expected 7 quick-ref curls, got ${curls.length}`);
  let executed = 0;
  for (const cmd of curls) {
    const filled = fillPlaceholders(cmd);
    assert.ok(!filled.includes("<"), `unfilled placeholder: ${filled}`);
    const { method, url, headers } = buildArgs(filled);
    const code = jsonStatus([...(method === "GET" ? [] : ["-X", method]), ...headers, url]);
    assert.ok(code >= 200 && code < 300, `FAIL ${method} ${url} => ${code}\ncmd: ${cmd}`);
    executed++;
  }
  assert.equal(executed, 7);
});

/** §9.2-1 curl 形态：隔离实例启动后自动创建 Susan（启动助手/自动创建在服务端完成）。 */
test("§9.2-1 启动自动创建 Susan 经 curl 可见（成员列表）", () => {
  const { agents } = JSON.parse(curl([`${BASE}/api/members`]));
  const susan = agents.find((a) => a.name === "Susan" && a.type === "agent" && a.deleted === 0);
  assert.ok(susan, "Susan must exist in members after startup auto-create");
  assert.ok(susan.workspace_path, "Susan has a home dir");
});

/** §9.2-2/§9.2-3 curl 形态：建频道 → 报到事件消息（Owner 署名）经消息流可见。 */
test("§9.2-2/3 建频道 → 事件消息可见（@Susan 新频道报到，不含欢迎 Susan 自己）", () => {
  const name = `e2e-${Date.now().toString(36)}`;
  const created = JSON.parse(
    curl([
      "-X", "POST", `${BASE}/api/channels`,
      "-H", "Content-Type: application/json",
      "-d", JSON.stringify({ name, type: "public", description: "e2e" }),
    ]),
  ).channel;
  assert.ok(created.id, "channel created");

  // 事件消息：Owner 署名 + @Susan 报到（§4.1 节点 2 触发面）
  const page = JSON.parse(curl([`${BASE}/api/channels/${created.id}/messages`]));
  assert.equal(page.targetKind, "channel");
  const eventMsg = page.messages.find((m) => m.content.includes("@Susan 新频道"));
  assert.ok(eventMsg, "channel-created event message must be visible via curl");
  assert.equal(eventMsg.author_id, "owner");
  assert.equal(eventMsg.content, `@Susan 新频道 #${name} 已建立`);

  // 静默加入：Susan 已自动加入新公开频道（成员列表可见），且无"欢迎 @Susan 加入"事件
  const members = JSON.parse(curl([`${BASE}/api/channels/${created.id}/members`])).members;
  assert.ok(members.some((m) => m.name === "Susan"), "Susan auto-joined the new public channel");
  for (const m of page.messages) {
    assert.ok(!m.content.includes("新成员 @Susan 加入频道"), `no welcome-Susan-herself: ${m.content}`);
  }
});

/** §9.2-2 curl 形态：建 agent → 欢迎事件消息（Owner 署名 + @Susan）经 #all 可见。 */
test("§9.2-2 建 agent → 事件消息可见（@Susan 新成员欢迎）", () => {
  const name = `e2e-agent-${Date.now().toString(36)}`;
  const created = JSON.parse(
    curl([
      "-X", "POST", `${BASE}/api/members`,
      "-H", "Content-Type: application/json",
      "-d", JSON.stringify({ name, provider: TEST_PROVIDER, modelId: TEST_MODEL, thinkingLevel: TEST_THINKING }),
    ]),
  ).agent;
  assert.ok(created.id, "agent created");

  const page = JSON.parse(curl([`${BASE}/api/channels/%23all/messages`]));
  const eventMsg = page.messages.find((m) => m.content.includes(`@Susan 新成员 @${name} 加入频道`));
  assert.ok(eventMsg, "agent-created event message must be visible via curl");
  assert.equal(eventMsg.author_id, "owner");
  assert.equal(eventMsg.content, `@Susan 新成员 @${name} 加入频道`);
});

/** 发消息（带 baseSeq）与设提醒经 curl 全链路可用（速查 §3 的另两条创建类）。 */
test("§9.2-5 发消息 / 设提醒 curl 可用", () => {
  // 发消息：不带 baseSeq 也成功（速查形态），带 baseSeq 走 freshness
  const sent = JSON.parse(
    curl([
      "-X", "POST", `${BASE}/api/messages`,
      "-H", "Content-Type: application/json",
      "-d", JSON.stringify({ targetId: "#all", content: "e2e 复验消息" }),
    ]),
  ).message;
  assert.ok(sent.id, "message sent");

  // 设提醒：fireAt 未来 5 分钟 + every:2m
  const fireAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const reminder = JSON.parse(
    curl([
      "-X", "POST", `${BASE}/api/reminders`,
      "-H", "Content-Type: application/json",
      "-d", JSON.stringify({ title: "e2e 复验提醒", fireAt, recurrence: "every:2m", targetId: "#all" }),
    ]),
  ).reminder;
  assert.ok(reminder.id, "reminder created");
  assert.equal(reminder.status, "scheduled");
});
