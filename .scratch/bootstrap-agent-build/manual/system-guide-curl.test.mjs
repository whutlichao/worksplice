// SYSTEM-GUIDE.md 手册 curl 实测回放（spec §8.3-2：curl 示例逐个实测）
// 用法：先起隔离实例（临时 WORKSPLICE_DATA_DIR + 端口），再
//   node --test .scratch/bootstrap-agent-build/manual/system-guide-curl.test.mjs
// 环境变量 PORT 覆盖目标端口（默认 30142，手册正文为默认 30141，回放时替换）。
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
const manual = fs.readFileSync(path.join(here, "SYSTEM-GUIDE.md"), "utf8");

const curl = (args) =>
  execFileSync("curl", ["-s", ...args], { encoding: "utf8", timeout: 30000 }).trim();

function jsonStatus(args) {
  const code = execFileSync("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", ...args], {
    encoding: "utf8",
    timeout: 30000,
  });
  return Number(code);
}

// 准备真实 id：频道（#all）、成员（建一个测试 agent）、消息（发一条）
const channels = JSON.parse(curl([`${BASE}/api/channels`])).channels;
const channelId = channels.find((c) => c.id === "#all").id;

const created = JSON.parse(
  curl([
    "-X", "POST", `${BASE}/api/members`,
    "-H", "Content-Type: application/json",
    "-d", JSON.stringify({ name: "回放测试成员", provider: "opencode-go", modelId: "deepseek-v4-flash", thinkingLevel: "max" }),
  ]),
).agent;
const agentId = created.id;

const sent = JSON.parse(
  curl([
    "-X", "POST", `${BASE}/api/messages`,
    "-H", "Content-Type: application/json",
    "-d", JSON.stringify({ targetId: channelId, content: "回放用消息" }),
  ]),
).message;
const messageId = sent.id;

// /api/models 要求 cwd 在文件访问白名单（session cwd 自动入白名单；测试实例先注册服务器 cwd）
const serverCwd = process.env.SERVER_CWD ?? process.cwd();
try {
  curl([
    "-X", "POST", `${BASE}/api/cwd/validate`,
    "-H", "Content-Type: application/json",
    "-d", JSON.stringify({ cwd: serverCwd }),
  ]);
} catch { /* 目录不存在等忽略 */ }

const seen = new Set();

/** 解析手册 bash 代码块中的 curl 命令（# 注释行跳过、\ 续行合并），返回 {cmd, url, args, isError} */
function parseCurls() {
  const results = [];
  const re = /```bash\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(manual)) !== null) {
    const block = m[1];
    const lines = block.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#"));
    let buf = "";
    for (const line of lines) {
      buf += line.trim().replace(/\\$/, "");
      if (line.trimEnd().endsWith("\\")) continue;
      if (!buf.startsWith("curl ")) { buf = ""; continue; }
      results.push(buf);
      buf = "";
    }
    if (buf.startsWith("curl ")) results.push(buf);
  }
  return results;
}

function buildArgs(cmd) {
  const raw = cmd.split(/\s+/).slice(1); // 去掉 curl
  // 先合并引号内含空格的值（'Content-Type: application/json' / '{"targetId":...}'）
  const tokens = [];
  for (let i = 0; i < raw.length; i++) {
    let t = raw[i];
    if ((t.startsWith("'") || t.startsWith('"')) && !(t.length > 1 && t.endsWith(t[0]) && !t.endsWith(t[0] + t[0]))) {
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
    if (t === "-X") { method = tokens[++i]; }
    else if (t === "-H") { args.push("-H", tokens[++i]); }
    else if (t === "-d") { args.push("-d", tokens[++i]); }
    else if (t === "-i") { /* 错误示例标记，跳过 */ }
    else if (t === "-G") { /* GET + --data-urlencode 组合，拼接 query */ }
    else if (t === "--data-urlencode") {
      const kv = tokens[++i];
      const [k, ...v] = kv.split("=");
      queryParams.push(`${k}=${encodeURIComponent(v.join("="))}`);
    }
    else if (t.startsWith("http")) { url = t; }
  }
  if (queryParams.length > 0) {
    url += (url.includes("?") ? "&" : "?") + queryParams.join("&");
  }
  return { method, url, headers: args };
}

function fillPlaceholders(s) {
  const encodedChannel = channelId === "#all" ? "%23all" : channelId;
  return s
    .replace(/<channelId>/g, encodedChannel)
    .replace(/<消息id>/g, messageId)
    .replace(/<agentId>/g, agentId)
    .replace(/<成员id>/g, agentId)
    .replace(/<provider>/g, "opencode-go")
    .replace(/<modelId>/g, "deepseek-v4-flash")
    .replace(/127\.0\.0\.1:30141/g, HOSTPORT);
}

test("SYSTEM-GUIDE.md 手册：成功类 curl 全部可回放（2xx）", () => {
  const curls = parseCurls().filter((c) => !c.includes("-i")); // 错误示例用 -i 标记，另测
  assert.ok(curls.length >= 20, `expected >=20 curls, got ${curls.length}`);
  let executed = 0;
  for (const raw of curls) {
    const { method, url, headers } = buildArgs(fillPlaceholders(raw));
    if (url.includes("<")) continue; // 含未填充占位符的跳过（错误示例用 -i 标记，另测）
    if (seen.has(url + method)) continue;
    seen.add(url + method);
    const code = jsonStatus([...(method === "GET" ? [] : ["-X", method]), ...headers, url]);
    assert.ok(
      code >= 200 && code < 300,
      `FAIL ${method} ${url} => ${code}\ncmd: ${raw}`,
    );
    executed++;
  }
  assert.ok(executed >= 8, `expected >=8 unique success curls, got ${executed}`);
});

test("SYSTEM-GUIDE.md 手册：错误示例 400/404/409 可回放（手册标注的语义一致）", () => {
  const curls = parseCurls().filter((c) => c.includes("-i"));
  assert.ok(curls.length >= 5, `expected >=5 error examples, got ${curls.length}`);
  for (const raw of curls) {
    const { method, url, headers } = buildArgs(fillPlaceholders(raw));
    if (url.includes("<")) continue;
    const code = jsonStatus([...(method === "GET" ? [] : ["-X", method]), ...headers, url]);
    const expects409 = raw.includes("baseSeq") || raw.includes("转两次");
    const expects404 = raw.includes("不存在");
    if (expects409) {
      assert.equal(code, 409, `expected 409 for: ${raw} (got ${code})`);
    } else if (expects404) {
      assert.equal(code, 404, `expected 404 for: ${raw} (got ${code})`);
    } else {
      assert.equal(code, 400, `expected 400 for: ${raw} (got ${code})`);
    }
  }
});

test("SYSTEM-GUIDE.md 手册：409 held 响应体带 roomSeq 与 whatHappened", () => {
  const body = curl([
    "-X", "POST", `${BASE}/api/messages`,
    "-H", "Content-Type: application/json",
    "-d", JSON.stringify({ targetId: channelId, content: "held 探测", baseSeq: 0 }),
  ]);
  const parsed = JSON.parse(body);
  assert.equal(parsed.held, true);
  assert.equal(typeof parsed.roomSeq, "number");
  assert.equal(typeof parsed.whatHappened, "string");
});
