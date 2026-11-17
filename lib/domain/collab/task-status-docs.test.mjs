import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relative) =>
  readFileSync(new URL(`../../../${relative}`, import.meta.url), "utf8");

test("authority docs agree on the #295 task-status model", () => {
  const agents = read("AGENTS.md");
  const glossary = read("GLOSSARY.md");
  const spec = read("docs/spec.md");
  const traps = read("docs/traps.md");
  const memory = read("assets/secretary/MEMORY.md");
  const guide = read("assets/secretary/SYSTEM-GUIDE.md");
  const launchPlan = read("docs/launch-plan.md");
  const designNote = read("docs/design-notes/orchestrating-coding-agents.md");
  const readme = read("README.md");

  assert.match(
    agents,
    /只有人类 Owner 与当前全局首席.*变更任务状态/,
    "AGENTS must state the single task-status authority",
  );
  assert.doesNotMatch(
    agents,
    /approve\/reject 必须由非 owner/,
    "AGENTS must not keep the old cross-review rule",
  );

  assert.match(glossary, /任务状态写权只归人类 Owner 与当前全局首席/);
  assert.match(
    glossary,
    /当前全局首席在任务创建事件或与未认领任务明确关联的人类消息上/,
    "task handoff must be global-chief-only",
  );
  assert.doesNotMatch(glossary, /构建者不验证自己/);

  assert.match(
    spec,
    /agent-loop 协议当前只暴露 claim \/ complete \/ unclaim \/ handoff/,
  );
  assert.match(
    traps,
    /agent-loop 协议只暴露 claim \/ complete \/ unclaim \/ handoff/,
  );
  assert.match(
    memory,
    /approve.*reject.*close.*reopen.*not protocol ops/,
    "the secretary quick reference must not overclaim protocol ops",
  );
  assert.match(guide, /There are three triggers/);
  assert.match(
    launchPlan,
    /任务状态权威：普通 agent \/ 频道首席被拒/,
    "launch evidence must describe the new authority proof",
  );
  assert.match(designNote, /## 4\. Task status has one authority/);
  assert.match(
    readme,
    /only the human Owner or current global chief changes status/,
  );
});
