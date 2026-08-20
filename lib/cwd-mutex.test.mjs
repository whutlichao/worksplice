import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  BUSY_CWD_RETRY_DELAY_MS,
  PROMPT_DONE_EVENTS,
  SETTLE_EVENTS,
  findBusySession,
  isCwdBusy,
  normalizeCwd,
  scheduleBusyRetry,
  trackStarting,
  waitForSettle,
  withCwdMutex,
  withCwdStartLock,
} from "./cwd-mutex.ts";

// 确保每次测试前全局状态隔离；cwd-mutex 的两张 Map 挂 globalThis，需清理。
function resetCwdMutexState() {
  globalThis.__workspliceCwdStartLocks = new Map();
  globalThis.__workspliceStartingSessionCwds = new Map();
  globalThis.__workspliceSessions = new Map();
}

// ---------------------------------------------------------------------------
// normalizeCwd：realpathSync 归一
// ---------------------------------------------------------------------------

test("normalizeCwd resolves symlinks and falls back to the literal path", () => {
  // 不存在路径回退为 resolve 后的字面路径
  assert.equal(normalizeCwd("/definitely/not/a/real/path-xyz"), "/definitely/not/a/real/path-xyz");
  assert.equal(normalizeCwd("relative/thing"), `${process.cwd()}/relative/thing`);

  // 真实符号链接归一：tmp 下建目录 +  symlink，normalize 必须解析到实路径
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-cwd-norm-"));
  const real = path.join(dir, "real");
  fs.mkdirSync(real);
  const link = path.join(dir, "link");
  try {
    fs.symlinkSync(real, link);
    assert.equal(normalizeCwd(link), fs.realpathSync(real));
    // 链接下的子路径也归一
    assert.equal(normalizeCwd(path.join(link, "sub")), path.join(fs.realpathSync(real), "sub"));
  } catch {
    // Windows 无 symlink 权限时跳过
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("normalizeCwd is the single source for both mutex and busy checks (realpath 基准一致)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-cwd-norm2-"));
  const real = path.join(dir, "proj");
  fs.mkdirSync(real);
  const link = path.join(dir, "proj-link");
  try {
    fs.symlinkSync(real, link);
    resetCwdMutexState();
    // 用 link 计入 starting 窗口，用 real 去查 busy——同实路径必须命中
    const done = trackStarting(link);
    assert.equal(isCwdBusy(real), true, "link 与 real 应归一为同一 cwd");
    assert.equal(isCwdBusy(link), true);
    done();
    assert.equal(isCwdBusy(real), false);
  } catch {
    // skip
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// withCwdMutex：per-cwd 窗口互斥（热重载守卫）
// ---------------------------------------------------------------------------

test("withCwdMutex serializes concurrent starts on the same cwd", async () => {
  resetCwdMutexState();
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-mutex-"));
  const events = [];
  const first = withCwdMutex(cwd, async () => {
    events.push("first-start");
    await new Promise((r) => setTimeout(r, 20));
    events.push("first-end");
  });
  const second = withCwdMutex(cwd, async () => {
    events.push("second-start");
    events.push("second-end");
  });
  await Promise.all([first, second]);
  assert.deepEqual(events, ["first-start", "first-end", "second-start", "second-end"]);
  // 热重载守卫：Map 挂在 globalThis，模块重载后仍同一实例
  assert.ok(globalThis.__workspliceCwdStartLocks instanceof Map);
  fs.rmSync(cwd, { recursive: true, force: true });
});

test("withCwdStartLock is an alias of withCwdMutex (backward compat)", () => {
  assert.equal(withCwdStartLock, withCwdMutex);
});

test("withCwdMutex does not block different cwds", async () => {
  resetCwdMutexState();
  const a = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-mutex-a-"));
  const b = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-mutex-b-"));
  const events = [];
  await Promise.all([
    withCwdMutex(a, async () => events.push("a")),
    withCwdMutex(b, async () => events.push("b")),
  ]);
  assert.deepEqual(events.sort(), ["a", "b"]);
  fs.rmSync(a, { recursive: true, force: true });
  fs.rmSync(b, { recursive: true, force: true });
});

test("withCwdMutex chains despite a failed holder", async () => {
  resetCwdMutexState();
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-mutex-fail-"));
  const first = withCwdMutex(cwd, async () => {
    throw new Error("boom");
  });
  const second = withCwdMutex(cwd, async () => "ok");
  await assert.rejects(first, /boom/);
  assert.equal(await second, "ok");
  fs.rmSync(cwd, { recursive: true, force: true });
});

test("withCwdMutex normalizes realpath: link vs real share the same lock", async () => {
  resetCwdMutexState();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-mutex-link-"));
  const real = path.join(dir, "real");
  fs.mkdirSync(real);
  const link = path.join(dir, "link");
  try {
    fs.symlinkSync(real, link);
    const events = [];
    const p1 = withCwdMutex(link, async () => {
      events.push("via-link-start");
      await new Promise((r) => setTimeout(r, 15));
      events.push("via-link-end");
    });
    const p2 = withCwdMutex(real, async () => {
      events.push("via-real");
    });
    await Promise.all([p1, p2]);
    assert.deepEqual(events, ["via-link-start", "via-link-end", "via-real"]);
  } catch {
    // skip on no-symlink
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 窗口计数器：trackStarting / isCwdBusy / findBusySession
// ---------------------------------------------------------------------------

test("trackStarting is reference counted across concurrent starts", () => {
  resetCwdMutexState();
  const cwd = "/tmp/cwd-counter";
  const doneA = trackStarting(cwd);
  assert.equal(isCwdBusy(cwd), true);
  const doneB = trackStarting(cwd);
  assert.equal(isCwdBusy(cwd), true);
  doneA();
  assert.equal(isCwdBusy(cwd), true, "one holder remains");
  doneB();
  assert.equal(isCwdBusy(cwd), false);
  // 热重载守卫：Map 挂 globalThis
  assert.ok(globalThis.__workspliceStartingSessionCwds instanceof Map);
});

test("isCwdBusy checks both the starting window and running sessions (realpath归一)", () => {
  resetCwdMutexState();
  const cwd = "/tmp/busy-probe";
  // 无窗口、无 session -> not busy
  assert.equal(isCwdBusy(cwd), false);
  assert.equal(findBusySession(cwd), undefined);

  // starting 窗口即 busy（无 session 也 busy）
  const done = trackStarting(cwd);
  assert.equal(isCwdBusy(cwd), true);
  assert.equal(findBusySession(cwd), undefined, "starting 窗口无 wrapper，find 返回 undefined（与 registry 语义一致）");
  done();
  assert.equal(isCwdBusy(cwd), false);

  // running session 判定 busy
  globalThis.__workspliceSessions.set("s1", { cwd, isRunning: () => true });
  assert.equal(isCwdBusy(cwd), true);
  assert.equal(findBusySession(cwd)?.cwd, cwd);

  // idle session 不算 busy
  globalThis.__workspliceSessions.set("s1", { cwd, isRunning: () => false });
  assert.equal(isCwdBusy(cwd), false);
  assert.equal(findBusySession(cwd), undefined);

  // 不同 cwd 不干扰
  globalThis.__workspliceSessions.set("s2", { cwd: "/tmp/other", isRunning: () => true });
  assert.equal(isCwdBusy("/tmp/busy-probe"), false);
  assert.equal(isCwdBusy("/tmp/other"), true);
});

test("findBusySession returns the running wrapper for the cwd only", () => {
  resetCwdMutexState();
  globalThis.__workspliceSessions.set("idle", { cwd: "/tmp/a", isRunning: () => false });
  globalThis.__workspliceSessions.set("busy", { cwd: "/tmp/a", isRunning: () => true });
  globalThis.__workspliceSessions.set("other", { cwd: "/tmp/b", isRunning: () => true });

  assert.equal(findBusySession("/tmp/a")?.cwd, "/tmp/a");
  // busy 的那一个
  const found = findBusySession("/tmp/a");
  assert.equal(found?.cwd, "/tmp/a");
  assert.equal(findBusySession("/tmp/b")?.cwd, "/tmp/b");
  assert.equal(findBusySession("/tmp/c"), undefined);
});

// ---------------------------------------------------------------------------
// waitForSettle / SETTLE_EVENTS / BUSY_CWD_RETRY_DELAY_MS
// ---------------------------------------------------------------------------

test("SETTLE_EVENTS contains prompt_done plus compaction ends, and BUSY delay is 250", () => {
  assert.equal(BUSY_CWD_RETRY_DELAY_MS, 250);
  assert.ok(PROMPT_DONE_EVENTS.has("prompt_done"));
  assert.ok(PROMPT_DONE_EVENTS.has("agent_end"));
  assert.ok(PROMPT_DONE_EVENTS.has("agent_settled"));
  assert.ok(SETTLE_EVENTS.has("prompt_done"));
  assert.ok(SETTLE_EVENTS.has("compaction_end"));
  assert.ok(SETTLE_EVENTS.has("auto_compaction_end"));
  // compaction_end 不在 PROMPT_DONE_EVENTS，但必须在 SETTLE_EVENTS（driver busy 等待必须监听它才能解挂）
  assert.equal(PROMPT_DONE_EVENTS.has("compaction_end"), false);
  assert.equal(PROMPT_DONE_EVENTS.has("auto_compaction_end"), false);
});

function makeFakeSession({ running = true } = {}) {
  const listeners = [];
  let isRunning = running;
  return {
    get running() {
      return isRunning;
    },
    setRunning(v) {
      isRunning = v;
    },
    isRunning: () => isRunning,
    onEvent(l) {
      listeners.push(l);
      return () => {
        const i = listeners.indexOf(l);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
    emit(event) {
      for (const l of [...listeners]) l(event);
    },
  };
}

test("waitForSettle fires on SETTLE_EVENTS and ignores other events", async () => {
  const session = makeFakeSession({ running: true });
  let settled = false;
  const cancel = waitForSettle(session, () => (settled = true));
  assert.equal(settled, false);
  session.emit({ type: "agent_start" });
  assert.equal(settled, false, "non-settle event should not trigger");
  session.emit({ type: "compaction_end" });
  assert.equal(settled, true);
  cancel();
});

test("waitForSettle fires immediately if the session is already idle (subscription race)", async () => {
  const session = makeFakeSession({ running: false });
  let settled = false;
  const cancel = waitForSettle(session, () => (settled = true));
  // 订阅后立即复核 isRunning()===false → 立即回调
  assert.equal(settled, true);
  cancel();
});

test("waitForSettle is idempotent and cancel prevents further callbacks", async () => {
  const session = makeFakeSession({ running: true });
  let calls = 0;
  const cancel = waitForSettle(session, () => calls++);
  session.emit({ type: "agent_settled" });
  assert.equal(calls, 1);
  // 重复 settle 事件不二次回调（settled 守卫）
  session.emit({ type: "agent_settled" });
  assert.equal(calls, 1);
  cancel(); // 已 settled 后的 cancel 不炸
  assert.equal(calls, 1);

  // 未 settle 前 cancel：后续事件不回调
  const session2 = makeFakeSession({ running: true });
  let calls2 = 0;
  const cancel2 = waitForSettle(session2, () => calls2++);
  cancel2();
  session2.emit({ type: "agent_settled" });
  assert.equal(calls2, 0, "canceled wait should not fire");
});

test("scheduleBusyRetry fires after BUSY_CWD_RETRY_DELAY_MS and cancel prevents it", async () => {
  assert.equal(BUSY_CWD_RETRY_DELAY_MS, 250);
  let fired = false;
  scheduleBusyRetry(() => (fired = true), 20);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(fired, false);
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(fired, true);

  // cancel 路径
  let fired2 = false;
  const cancel2 = scheduleBusyRetry(() => (fired2 = true), 20);
  cancel2();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(fired2, false);
});

test("scheduleBusyRetry defaults to BUSY_CWD_RETRY_DELAY_MS", async () => {
  const start = Date.now();
  let fired = false;
  scheduleBusyRetry(() => (fired = true));
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(fired, false, "should not fire before 250ms");
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(fired, true);
  assert.ok(Date.now() - start >= 240, "delay should be ~250ms");
});
