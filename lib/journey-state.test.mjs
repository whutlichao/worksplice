import assert from "node:assert/strict";
import test from "node:test";

const { deriveJourneyState } = await import("./journey-state.ts");

/**
 * 引导卡状态推导：所有输入都来自当前频道已有的消息数与任务快照，
 * 不新增后端接口。规则优先级：无消息 > in_review > null。
 *
 * 本票删掉旅程条后不再推导 step：有消息无任务时不引导转任务，
 * 待办 / 进行中 / 全部完成或关闭都不出卡（null），只保留空频道的 describe
 * 与待审核的 review。
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

test("有消息但还没有任务时不产出引导卡", () => {
    const state = deriveJourneyState({ messageCount: 3, tasks: [] });
    assert.equal(state.guideKind, null);
});

test("只有待办任务时不再产出引导卡", () => {
    const state = deriveJourneyState({
        messageCount: 3,
        tasks: tasks("todo"),
    });
    assert.equal(state.guideKind, null);
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

test("进行中与待办并存时不再产出引导卡", () => {
    const state = deriveJourneyState({
        messageCount: 3,
        tasks: tasks("in_progress", "todo"),
    });
    assert.equal(state.guideKind, null);
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
