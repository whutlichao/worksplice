import assert from "node:assert/strict";
import test from "node:test";

const { deriveJourneyState } = await import("./journey-state.ts");

/**
 * 旅程条状态推导（票 16）：所有输入都来自当前频道已有的消息数与任务快照，
 * 不新增后端接口。规则优先级：in_review > in_progress > todo > 全完成。
 */

const tasks = (...statuses) => statuses.map((status, index) => ({
    id: `task-${index + 1}`,
    status,
}));

test("无消息时停在第一步「描述」", () => {
    const state = deriveJourneyState({ messageCount: 0, tasks: [] });
    assert.equal(state.step, 1);
    assert.equal(state.guideKind, "describe");
    assert.equal(state.openTaskCount, 0);
});

test("有消息但还没有任务时停在第二步「交接」", () => {
    const state = deriveJourneyState({ messageCount: 3, tasks: [] });
    assert.equal(state.step, 2);
    assert.equal(state.guideKind, "handoff");
    assert.equal(state.hasTasks, false);
});

test("只有待办任务时仍在第二步，等待交接或认领", () => {
    const state = deriveJourneyState({
        messageCount: 3,
        tasks: tasks("todo"),
    });
    assert.equal(state.step, 2);
    assert.equal(state.guideKind, "handoff");
    assert.equal(state.openTaskCount, 1);
});

test("有进行中任务时推进到第三步「让它跑」", () => {
    const state = deriveJourneyState({
        messageCount: 3,
        tasks: tasks("todo", "in_progress"),
    });
    assert.equal(state.step, 3);
    assert.equal(state.guideKind, "running");
    assert.equal(state.openTaskCount, 2);
});

test("待审核优先于进行中，推进到第四步「复核」", () => {
    const state = deriveJourneyState({
        messageCount: 3,
        tasks: tasks("in_progress", "in_review"),
    });
    assert.equal(state.step, 4);
    assert.equal(state.guideKind, "review");
    assert.equal(state.openTaskCount, 2);
});

test("全部完成或关闭时停在第四步，但不再显示引导卡", () => {
    const state = deriveJourneyState({
        messageCount: 3,
        tasks: tasks("done", "closed"),
    });
    assert.equal(state.step, 4);
    assert.equal(state.guideKind, null);
    assert.equal(state.openTaskCount, 0);
});

test("任务角标只统计未完成与待复核，不含 done/closed", () => {
    const state = deriveJourneyState({
        messageCount: 5,
        tasks: tasks("todo", "in_progress", "in_review", "done", "closed"),
    });
    assert.equal(state.openTaskCount, 3);
});
