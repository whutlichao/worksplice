import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

/**
 * 首席的配置面（票 #252）：建频道时指定 / 频道设置里改清 / 频道详情显示来源。
 *
 * 断言都落在**真实渲染的 HTML**上（`renderToStaticMarkup`，与 CreateChannelModal /
 * ChannelView 既有测试同档），不是对纯函数的练习：SSR 不跑 effect，交互提交的证据
 * 由「服务端答案驱动的数据源」那组断言 + 服务/路由用例共同守（见票 Answer）。
 */

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { CreateChannelModal, chiefCandidateOptions } = await jiti.import(
  "./CreateChannelModal.tsx",
);
const { ChannelView, ChannelChiefSetting, resolveChiefView, chiefDetailText } =
  await jiti.import("./ChannelView.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

function renderI18n(children) {
  return renderToStaticMarkup(React.createElement(I18nProvider, null, children));
}

function renderModal(agents) {
  return renderI18n([
    React.createElement(CreateChannelModal, {
      key: "modal",
      agents,
      onClose: () => undefined,
      onCreated: () => undefined,
    }),
  ]);
}

const AGENTS = [
  { id: "m1", name: "bob", type: "agent", deleted: 0 },
  { id: "m2", name: "Susan", type: "agent", deleted: 0 },
  { id: "m3", name: "carol", type: "agent", deleted: 1 },
];

function channelRow(overrides) {
  return {
    id: "c1",
    name: "general",
    type: "public",
    description: "chat",
    archived: 0,
    created_at: "2026-08-03T00:00:00.000Z",
    joined: true,
    memberCount: 2,
    unread: 0,
    unreadTaskCount: 0,
    messageCount: 0,
    ...overrides,
  };
}

function renderChannelView(channel, currentMemberId = "owner") {
  return renderI18n([
    React.createElement(ChannelView, {
      key: "center",
      channel,
      tab: "messages",
      onTabChange: () => undefined,
      currentMemberId,
      onChannelChanged: () => undefined,
      focusMessageId: null,
    }),
  ]);
}

// ─── 建频道：默认「回落全局」+ 候选仅来自所选 agent 成员 ─────────────────────

test("建频道弹窗：首席默认「回落全局」，未选成员时没有任何 agent 候选", () => {
  const html = renderModal(AGENTS);

  assert.match(html, /data-testid="create-channel-chief"/);
  assert.match(html, /Group chief \(optional\)/);
  // 默认落在「回落全局首席（不指定）」上（value=""）
  assert.match(html, /<option value="" selected="">Global chief \(not set\)<\/option>/);
  // 未勾选任何成员 ⇒ 首席候选为空：agent 名字不作为 <option> 出现
  const options = html.match(/<option[^>]*>[^<]*<\/option>/g) ?? [];
  assert.equal(options.length, 1, `未选成员时只有一个「回落全局」选项：${options.join(" | ")}`);
  assert.doesNotMatch(html, /<option[^>]*>bob<\/option>/);
  assert.doesNotMatch(html, /<option[^>]*>Susan<\/option>/);
});

test("建频道弹窗：首席候选 = 本次一并加入的 agent 成员（软删身份与未选中成员都不在内）", () => {
  assert.deepEqual(chiefCandidateOptions(AGENTS, []), []);
  assert.deepEqual(
    chiefCandidateOptions(AGENTS, ["m2", "m3"]).map((candidate) => candidate.name),
    ["Susan"],
    "只给未软删且被勾选加入的 agent（m3 已软删）",
  );
  assert.deepEqual(
    chiefCandidateOptions(AGENTS, ["m1", "m2"]).map((candidate) => candidate.name),
    ["bob", "Susan"],
  );
});

// ─── 频道详情：三态来源文字 ─────────────────────────────────────────────────

test("频道详情：显示生效首席与来源——频道指定 / 回落全局 / 无", () => {
  const own = renderChannelView(
    channelRow({ chief: { id: "m1", name: "bob" }, chiefSource: "channel" }),
  );
  assert.match(own, /data-chief-source="channel"/);
  assert.match(own, /Chief: bob \(this group\)/);

  const fallback = renderChannelView(
    channelRow({ chief: { id: "m2", name: "Susan" }, chiefSource: "global" }),
  );
  assert.match(fallback, /data-chief-source="global"/);
  assert.match(fallback, /Chief: Susan \(global fallback\)/);

  const none = renderChannelView(channelRow({ chief: null, chiefSource: "none" }));
  assert.match(none, /data-chief-source="none"/);
  assert.match(none, /Chief: none \(no default recipient\)/);
});

test("频道详情：DM 不出现首席展示，也不出现首席设置", () => {
  const dm = renderChannelView(
    channelRow({
      id: "dm:owner↔bob",
      name: "dm:owner↔bob",
      type: "dm",
      chief: null,
      chiefSource: "none",
    }),
  );
  assert.doesNotMatch(dm, /data-testid="channel-chief"/);
  assert.doesNotMatch(dm, /data-testid="channel-chief-setting"/);
});

// ─── 频道设置：Owner 有入口，非 Owner 没有 ──────────────────────────────────

test("频道设置：Owner 看得到首席选择器，非 Owner 没有入口", () => {
  const channel = channelRow({
    chief: { id: "m1", name: "bob" },
    chiefSource: "channel",
  });

  const ownerView = renderChannelView(channel, "owner");
  assert.match(ownerView, /data-testid="channel-chief-setting"/);
  assert.match(ownerView, /data-testid="channel-chief-select"/);

  const memberView = renderChannelView(channel, "m1");
  assert.doesNotMatch(memberView, /data-testid="channel-chief-setting"/);
  assert.doesNotMatch(memberView, /data-testid="channel-chief-select"/);
  // 非 Owner 仍然能看到此刻生效的首席（详情是只读事实，不是入口）
  assert.match(memberView, /Chief: bob \(this group\)/);
});

// ─── 提交失败：不停留在假成功态 ──────────────────────────────────────────────

test("首席写入失败：渲染真实错误文案，选择器停在服务端的真实绑定上", () => {
  const html = renderI18n([
    React.createElement(ChannelChiefSetting, {
      key: "chief",
      view: { chief: { id: "m1", name: "bob" }, chiefSource: "channel" },
      candidates: [
        { id: "m1", name: "bob" },
        { id: "m2", name: "Susan" },
      ],
      bindingId: "m1",
      busy: false,
      status: {
        ok: false,
        text: "The channel chief must be a member of this channel",
      },
      onChange: () => undefined,
    }),
  ]);

  assert.match(html, /data-chief-status="error"/);
  assert.match(html, /The channel chief must be a member of this channel/);
  // 没有假的成功态：绑定仍是 bob（选中项不变）
  assert.match(html, /<option value="m1" selected="">bob<\/option>/);
  assert.match(html, /<option value="m2">Susan<\/option>/);
  assert.doesNotMatch(html, /data-chief-status="ok"/);
});

// ─── 换人 / 清除后：详情用服务端响应，不吃旧行 ───────────────────────────────

test("换人 / 清除：服务端响应直接驱动详情，行对象刷新后让位给新行", () => {
  const staleRow = channelRow({
    chief: { id: "m1", name: "bob" },
    chiefSource: "channel",
    chief_member_id: "m1",
  });
  const answer = {
    channel: staleRow,
    chief: { id: "m2", name: "Susan" },
    chiefSource: "channel",
    chiefMemberId: "m2",
  };

  const applied = resolveChiefView(staleRow, answer);
  assert.deepEqual(applied, {
    chief: { id: "m2", name: "Susan" },
    chiefSource: "channel",
    bindingId: "m2",
  });

  // 清除：响应说「回落到全局首席」，详情立刻按全局首席与 global 来源渲染
  const cleared = resolveChiefView(staleRow, {
    ...answer,
    chief: { id: "m9", name: "alice" },
    chiefSource: "global",
    chiefMemberId: null,
  });
  assert.equal(
    chiefDetailText((key, params) => `${key}:${params?.name ?? ""}`, cleared),
    "chief.detailGlobal:alice",
  );

  // 频道行换了新引用（服务端刷新后的新行）⇒ 旧响应失效，取新行的现算值
  const freshRow = channelRow({
    chief: null,
    chiefSource: "none",
    chief_member_id: null,
  });
  assert.deepEqual(resolveChiefView(freshRow, answer), {
    chief: null,
    chiefSource: "none",
    bindingId: null,
  });
});

test("详情文案：没有可用首席时明确写「无」，不靠空白含糊过去", () => {
  const text = chiefDetailText(
    (key) => ({ "chief.detailNone": "Chief: none (no default recipient)" })[key] ?? key,
    { chief: null, chiefSource: "none" },
  );
  assert.equal(text, "Chief: none (no default recipient)");
});
