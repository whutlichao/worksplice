import assert from "node:assert/strict";
import test from "node:test";

/**
 * UI 文案分层守卫（i18n 内容层 ticket）：本次从组件里迁进 i18n 包的键必须在
 * en / zh-CN 两套语言包同时存在——防止"只加了一套"或退回硬编码。
 * （不校验两包整体键集对等：存量包本就不等长，本次不动既有文案。）
 */

const { enLocale } = await import("./messages/en.ts");
const { zhCNLocale } = await import("./messages/zh-CN.ts");

test("skills project-directory label exists in both packages", () => {
  assert.equal(
    enLocale.messages["i18n.projectDirectoryPath"],
    ".pi/skills/ (project directory)",
  );
  assert.equal(
    zhCNLocale.messages["i18n.projectDirectoryPath"],
    ".pi/skills/（项目目录）",
  );
});

/**
 * agent 生命周期按钮回归守卫：中文界面下的重启 / 会话重置 / 完整重置及其直接
 * 提示文案必须是中文，不得回退成 en 包里的英文值。
 */
test("agent lifecycle labels are localized in zh-CN", () => {
  const expected = {
    "agent.restart": "重启",
    "agent.sessionReset": "会话重置",
    "agent.fullReset": "完整重置",
    "agent.fullResetSharedHint":
      "当前绑定共享项目目录，完整重置不可用（请用会话重置）",
    "agent.stoppedHint": "离线 = 已停止响应，身份仍在；可随时重启激活",
  };
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(zhCNLocale.messages[key], value, `${key} 应为中文文案`);
    assert.doesNotMatch(
      zhCNLocale.messages[key],
      /Restart|Session reset|Full reset/,
      `${key} 不应含英文原文`,
    );
  }
});

/**
 * 界面评审的文案契约（D1 / D3 / D4 / D5 / D6 / D7 / F）：
 * 两套语言包同步 + 中文界面不得回退英文术语。
 */
test("界面评审 D1：提醒行的占位符是单层花括号（双花括号会在界面漏出 `#{{`）", () => {
  for (const messages of [zhCNLocale.messages, enLocale.messages]) {
    for (const key of ["reminders.targetIn", "reminders.targetInMsg", "reminders.scheduledCount"]) {
      assert.doesNotMatch(messages[key], /\{\{/, `${key} 仍有双花括号`);
      assert.match(messages[key], /\{(channel|seq|count)\}/, `${key} 缺单层占位符`);
    }
  }
});

test("界面评审 D3 / D5：任务关闭与「提交待审」的文案在两包中同步且语义明确", () => {
  assert.equal(zhCNLocale.messages["tasks.close"], "关闭任务");
  assert.equal(enLocale.messages["tasks.close"], "Close task");
  assert.equal(zhCNLocale.messages["tasks.complete"], "提交待审");
  assert.equal(enLocale.messages["tasks.complete"], "Submit for review");
  // 表单里的「取消」保持原样（它与「关闭任务」是两个动作）
  assert.equal(zhCNLocale.messages["tasks.cancel"], "取消");
  assert.equal(enLocale.messages["tasks.cancel"], "Cancel");
  // 关闭确认的解释句（关闭后需重开才能继续）
  for (const messages of [zhCNLocale.messages, enLocale.messages]) {
    assert.match(messages["tasks.closeConfirm"], /\{number\}/);
  }
});

test("界面评审 D4：危险确认按钮各自复述对象，删除确认补「不可撤销」", () => {
  const pairs = {
    "agent.confirmDeleteAction": ["删除身份", "Delete identity"],
    "agent.confirmSessionResetAction": ["清空会话", "Reset session"],
    "agent.confirmFullResetAction": ["完整重置", "Full reset"],
  };
  for (const [key, [zh, en]] of Object.entries(pairs)) {
    assert.equal(zhCNLocale.messages[key], zh);
    assert.equal(enLocale.messages[key], en);
  }
  assert.match(zhCNLocale.messages["agent.confirmDelete"], /不可撤销/);
  assert.match(enLocale.messages["agent.confirmDelete"], /cannot be undone/);
});

test("界面评审 D6 / F：空态提示与建频道兜底文案两包同步", () => {
  assert.match(zhCNLocale.messages["messages.selectChannelHint"], /左侧选择一个频道/);
  assert.match(zhCNLocale.messages["messages.emptyDMHint"], /下方输入框/);
  assert.match(enLocale.messages["messages.selectChannelHint"], /Pick a channel/);
  assert.match(enLocale.messages["messages.emptyDMHint"], /box below/);
  // 无消费者的旧键已删除
  assert.equal(zhCNLocale.messages["messages.emptyHint"], undefined);
  assert.equal(enLocale.messages["messages.emptyHint"], undefined);
  assert.equal(zhCNLocale.messages["channel.createFailed"], "无法创建频道，请检查名称后重试");
  assert.match(enLocale.messages["channel.createFailed"], /Could not create the channel/);
});

test("界面评审 D7 / A6：中文包不再混用 channel / thread，presence 四键成对存在", () => {
  // 先剥掉插值占位符（`{channel}` / `{seq}` 是键名而不是可见文案）
  const offenders = Object.entries(zhCNLocale.messages).filter(
    ([, value]) => /\b(channel|thread)\b/i.test(value.replace(/\{\w+\}/g, "")),
  );
  assert.deepEqual(offenders, [], `中文文案仍混用英文术语：${JSON.stringify(offenders)}`);
  for (const key of ["presence.online", "presence.working", "presence.error", "presence.offline"]) {
    assert.ok(zhCNLocale.messages[key], `zh-CN 缺 ${key}`);
    assert.ok(enLocale.messages[key], `en 缺 ${key}`);
  }
  assert.equal(zhCNLocale.messages["tasks.asTask"], zhCNLocale.messages["tasks.convert"]);
  assert.equal(enLocale.messages["tasks.asTask"], enLocale.messages["tasks.convert"]);
});

/**
 * 界面评审残留 R2：消息行的可访问名（键盘焦点落在行根时读屏要读出「谁的第几条」）。
 * 两包同步存在；中文不得混用 channel / thread 这类英文术语（D7 守卫同样适用于新键）。
 */
test("界面评审残留 R2：消息行名称在两包中同步，中文不混用英文术语", () => {
  for (const messages of [zhCNLocale.messages, enLocale.messages]) {
    assert.ok(messages["message.rowLabel"], "缺 message.rowLabel");
    assert.match(messages["message.rowLabel"], /\{author\}/);
    assert.match(messages["message.rowLabel"], /\{seq\}/);
  }
  assert.doesNotMatch(
    zhCNLocale.messages["message.rowLabel"].replace(/\{\w+\}/g, ""),
    /\b(channel|thread)\b/i,
  );
});

/**
 * 票 #251 的文案契约：首席提示与成员视角在中文界面必须是中文正文，
 * 英文包给等义对照；两包占位符一致（漏占位符会在界面漏出 `{name}`）。
 */
test("chief hint and member chief view are localized in zh-CN", () => {
  const expected = {
    "message.chiefHint.channel": "没点名任何 agent：这条消息由频道首席 {name} 接",
    "message.chiefHint.global": "没点名任何 agent：本频道未指定首席，回落全局首席 {name}",
    "message.chiefHint.none": "没有默认收件人：不点名 agent 时不会有人接这条消息",
    "message.chiefHint.named": "按点名送达：这条消息只叫被点名的 agent，首席不再额外接手",
    "agent.chiefSection": "首席",
    "agent.chiefGlobal": "全局首席",
    "agent.chiefYes": "是",
    "agent.chiefNo": "否",
    "agent.chiefChannels": "当首席的频道",
    "agent.chiefNoChannels": "未在任何频道当首席",
    "agent.setGlobalChief": "设为全局首席",
    "agent.clearGlobalChief": "清除全局首席",
    "agent.chiefSaveFailed": "保存失败：{reason}",
  };
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(zhCNLocale.messages[key], value, `${key} 应为中文文案`);
    assert.ok(enLocale.messages[key], `${key} 缺英文对照`);
  }
  // 占位符两包一致
  for (const key of ["message.chiefHint.channel", "message.chiefHint.global"]) {
    assert.match(enLocale.messages[key], /\{name\}/, `${key} 英文缺占位符`);
  }
  assert.match(enLocale.messages["agent.chiefSaveFailed"], /\{reason\}/);
});
