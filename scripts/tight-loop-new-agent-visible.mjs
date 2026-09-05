// tight loop（秒级、确定性、agent-runnable）：用户精确症状 —— 创建 agent 后三处可见性含新成员。
// 直调 raft 服务层（createAgent/listChannelMembers）+ 视图派生纯函数
// （channelAgents / mentionable joined / composerMentionCandidates，与 ChannelView 同语义）。
// 旧快照（创建前拉取、不重拉）恒 stale = 红基线；重拉后新鲜快照三处全含 = 绿。
// 用法：node scripts/tight-loop-new-agent-visible.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDataDb } from "../lib/data/sqlite.ts";
import { BUILTIN_CHANNEL_ID } from "../lib/data/schema.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-tight-"));
globalThis.__workspliceDb = openDataDb(root);
const { createAgent } = await import("../lib/domain/raft/members.ts");
const { listChannelMembers } = await import("../lib/domain/raft/channels.ts");
const { composerMentionCandidates } = await import("../lib/mention.ts");

// 旧快照：创建前拉一次 #all 成员（模拟不切频道时的 stale 快照）
const staleIds = new Set(listChannelMembers(BUILTIN_CHANNEL_ID).map((m) => m.id));
// 创建新 agent（服务端自动加入 #all）
const agent = createAgent({ name: "tight-loop-probe" });
// 新鲜快照：重拉后
const freshIds = new Set(listChannelMembers(BUILTIN_CHANNEL_ID).map((m) => m.id));
const agents = [{ id: agent.id, name: agent.name, status: agent.status }];

// 三处可见性派生（与 ChannelView 同语义：channelAgents / mentionable joined / composer 候选）
const channelAgents = agents.filter((a) => freshIds.has(a.id));
const mentionableJoined = agents
  .map((a) => ({ ...a, joined: freshIds.has(a.id) }))
  .filter((a) => a.joined);
const composer = composerMentionCandidates(agents, freshIds);

console.log(`stale has new: ${staleIds.has(agent.id)} | fresh has new: ${freshIds.has(agent.id)}`);
console.log(`channelAgents has new: ${channelAgents.some((a) => a.id === agent.id)}`);
console.log(`mentionable joined has new: ${mentionableJoined.some((a) => a.id === agent.id)}`);
console.log(`composer candidates has new: ${composer.some((a) => a.id === agent.id)}`);

assert.equal(staleIds.has(agent.id), false, "旧快照不应含新成员（stale 基线）");
assert.equal(freshIds.has(agent.id), true, "重拉后 #all 成员必须含新成员");
assert.equal(channelAgents.some((a) => a.id === agent.id), true, "成员面板可见性必须含新成员");
assert.equal(mentionableJoined.some((a) => a.id === agent.id), true, "提及 joined 必须含新成员");
assert.equal(composer.some((a) => a.id === agent.id), true, "补全候选必须含新成员");
console.log("TIGHT-LOOP GREEN: 创建 agent 后三处可见性均含新成员");
globalThis.__workspliceDb?.close();
fs.rmSync(root, { recursive: true, force: true });
