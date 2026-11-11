import assert from "node:assert/strict";
import test from "node:test";

const { deriveJourneyState } = await import("./journey-state.ts");

/**
 * 引导卡状态推导：所有输入都来自当前频道已有的消息数与任务快照，
 * 不新增后端接口。规则优先级：in_review > todo > in_progress / 全完成。
 *
 * 本票删掉旅程条后不再推导 step：只有 in_progress 的频道不出卡（null），
 * 有 todo 时回落 handoff（等待交接或认领）。
 */

const tasks = (...statuses) => statuses.map((status, index) => ({
    id: `task-${index + 1}`,
    status,
}));

test("无消息时给出「描述」引导卡", () => {
    const state = deriveJourneyState({ messageCount: 0, tasks: [] });
    assert.equal(state.guideKind, "describe");
    assert.equal(state.openTaskCount, 0);
});

test("有消息但还没有任务时给出「交接」引导卡", () => {
    const state = deriveJourneyState({ messageCount: 3, tasks: [] });
    assert.equal(state.guideKind, "handoff");
    assert.equal(state.hasTasks, false);
});

test("只有待办任务时给出「交接」引导卡，等待交接或认领", () => {
    const state = deriveJourneyState({
        messageCount: 3,
        tasks: tasks("todo"),
    });
    assert.equal(state.guideKind, "handoff");
    assert.equal(state.openTaskCount, 1);
});

test("只有进行中任务时不再出卡（in_progress 不产出任何引导）", () => {
    const state = deriveJourneyState({
        messageCount: 3,
        tasks: tasks("in_progress"),
    });
    assert.equal(state.guideKind, null);
    assert.equal(state.openTaskCount, 1);
});

test("进行中与待办并存时回落「交接」引导卡", () => {
    const state = deriveJourneyState({
        messageCount: 3,
        tasks: tasks("in_progress", "todo"),
    });
    assert.equal(state.guideKind, "handoff");
    assert.equal(state.openTaskCount, 2);
});

test("待审核优先于进行中，给出「复核」引导卡", () => {
    const state = deriveJourneyState({
        messageCount: 3,
        tasks: tasks("in_progress", "in_review"),
    });
    assert.equal(state.guideKind, "review");
    assert.equal(state.openTaskCount, 2);
});

test("全部完成或关闭时不再显示引导卡", () => {
    const state = deriveJourneyState({
        messageCount: 3,
        tasks: tasks("done", "closed"),
    });
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
