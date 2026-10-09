import { getChannel, isChannelMember } from "./channels.ts";
import { getMember, listAgents } from "./members.ts";
import { sendMessage } from "./messages.ts";
import { emitWake } from "./wake.ts";
import { BUILTIN_CHANNEL_ID, OWNER_MEMBER_ID } from "../../data/schema.ts";
import { previewLine } from "../../preview.ts";
import type { ChannelRow, MemberRow } from "../../data/types.ts";

/**
 * 事件系统消息（spec-bootstrap-agent.md §4.2/§7，构建 effort ticket 01）：
 * 关键节点提交后、以 Owner 署名投递的短消息（如 `@Susan New member @X joined the channel`），
 * 内容只含关注对象、不含欢迎正文；wake:false 关闭 channel 级 wake（不惊动其他 agent），
 * 仅定向唤醒秘书（@mention 穿透语义，mute 也拦不住个人 mention，§4.5）。
 * 欢迎语 = 秘书被唤醒后的正常 loop 回复（铁律：不以秘书署名触发）。
 */

/** 秘书默认名字（spec §1.3/§2.3）：@mention 用 @Susan；身份判定按名字全等（§6.1/§6.4）。 */
export const SUSAN_MEMBER_NAME = "Susan";

/** 存活秘书（未软删的 agent、名字全等）；不存在时事件消息整体跳过（无人可唤醒）。 */
export function findSusanMember(): MemberRow | undefined {
  return listAgents().find((m) => m.name === SUSAN_MEMBER_NAME);
}

/** 可被 mention 解析器识别的 @token（lib/mention.ts：`@名字` / `@"带空格名字"`）。 */
function mentionText(name: string): string {
  return /^[^\s@,;:!?。，；：！？]+$/.test(name) ? `@${name}` : `@"${name}"`;
}

/**
 * 事件消息投递（§4.2 方案 A）：Owner 署名 + wake:false + 定向唤醒秘书。
 * 尽力而为——无秘书、Owner 不在目标 channel、channel 已归档等场景静默跳过，
 * 投递失败只记日志，绝不向上抛（主操作已提交，事件消息不得反向破坏调用方）。
 */
function deliverEventMessage(channelId: string, content: string): void {
  const susan = findSusanMember();
  if (!susan) return;
  const channel = getChannel(channelId);
  if (!channel || channel.archived === 1) return;
  if (!isChannelMember(channelId, OWNER_MEMBER_ID)) return;
  try {
    const sent = sendMessage({
      targetId: channelId,
      authorId: OWNER_MEMBER_ID,
      content,
      wake: false,
    });
    if (!sent.held) {
      emitWake({
        agentId: susan.id,
        targetId: sent.message.target_id,
        seq: sent.message.seq,
        reason: "message",
      });
    }
  } catch (error) {
    console.error("[event-messages] event message delivery failed:", error);
  }
}

/**
 * 节点 1：新 agent 加入频道（提交后）→ 事件消息 + @Susan 定向唤醒（§4.2/§7）。
 * 排除规则：加入者 = Owner（人类）不投；加入者 = Susan 不投（不存在"欢迎自己"）；
 * 软删身份不可加入，不投。秘书不在该频道（如被移出，§7）时投 `#all` 穿透送达。
 */
export function notifyAgentJoinedChannel(channelId: string, joinerId: string): void {
  const joiner = getMember(joinerId);
  if (!joiner || joiner.deleted === 1) return;
  if (joiner.id === OWNER_MEMBER_ID || joiner.type !== "agent") return;
  if (joiner.name === SUSAN_MEMBER_NAME) return;
  const susan = findSusanMember();
  if (!susan) return;
  const targetId = isChannelMember(channelId, susan.id) ? channelId : BUILTIN_CHANNEL_ID;
  deliverEventMessage(
    targetId,
    `${mentionText(susan.name)} New member ${mentionText(joiner.name)} joined the channel`,
  );
}

/**
 * 节点 2：新频道建立（提交后）→ 事件消息投新频道（§4.2/§7）；
 * 秘书未加入（如私有频道初始成员取消勾选）时投 `#all` 经 @mention 穿透送达。
 */
export function notifyChannelCreated(channel: ChannelRow): void {
  const susan = findSusanMember();
  if (!susan) return;
  const targetId = isChannelMember(channel.id, susan.id) ? channel.id : BUILTIN_CHANNEL_ID;
  deliverEventMessage(targetId, `${mentionText(susan.name)} New channel #${channel.name} created`);
}

/**
 * 任务创建事件消息（§3.7 可认领信号，构建本 effort 的 Convert-to-Task 票）：
 * 以 Owner 署名投到任务所属 channel，`wake: true` 走既有 `notifyMessageWakes` 扇出
 * 该 channel 的全部 agent 成员。
 *
 * 为什么必须有：agent 认领任务的链路是 wake → drain 到新消息 → `buildReplyPrompt`
 * 的 Related open tasks → agent 回 `{"task":{"number":N,"op":"claim"}}`。而
 * Convert to Task 途径只调 `createTask` 落库、不发消息，于是 `runAgentRound` 在
 * `drained.messages.length === 0` 处早退，agent 根本不起轮，任务永远躺在 todo。
 * 板上 Create Task 途径碰巧是好的，只因为它先 `sendMessage` 才有消息可 drain。
 *
 * 与 `deliverEventMessage` 的差别只有 wake 策略：那里是 `wake: false` + 定向唤醒秘书
 * （欢迎路径专用语义）；这里是全 channel 扇出，抢占认领失败让路是既有语义（§3.7）。
 * 故另起一个函数，不改也不复用 `deliverEventMessage` 的行为。
 *
 * 尽力而为：频道已归档 / Owner 不在频道 / 投递抛错 → 静默跳过或只记日志，绝不反向
 * 破坏调用方（任务已落库，事件消息不得让 `createTask` 失败）。
 */
export function notifyTaskCreated(channelId: string, taskNumber: number, anchorContent?: string): void {
  const channel = getChannel(channelId);
  if (!channel || channel.archived === 1) return;
  if (!isChannelMember(channelId, OWNER_MEMBER_ID)) return;
  const preview = anchorContent ? previewLine(anchorContent, 80) : "";
  const content = preview ? `Task #${taskNumber} created — ${preview}` : `Task #${taskNumber} created`;
  try {
    sendMessage({ targetId: channelId, authorId: OWNER_MEMBER_ID, content, wake: true });
  } catch (error) {
    console.error("[event-messages] task created message delivery failed:", error);
  }
}

/** 节点 3 欢迎事件正文（spec §4.1/§6.2-⑤，构建 effort ticket 04）：只含关注对象，欢迎语由秘书回复。 */
export const SECRETARY_WELCOME_CONTENT = `${mentionText(SUSAN_MEMBER_NAME)} Welcome aboard — this is your office channel`;

/**
 * 节点 3：办公室频道欢迎语（spec §4.1/§6.2-⑤，构建 effort ticket 04）——秘书初始化流程
 * 以 Owner 署名向办公室频道投事件消息 → @mention 穿透唤醒秘书 → 其正常回复欢迎语（≤2 句）。
 * 铁律：不以秘书署名触发（loop 对"drain 到的全是自己的消息"直接 noop）。
 */
export function notifySecretaryWelcome(channelId: string): void {
  deliverEventMessage(channelId, SECRETARY_WELCOME_CONTENT);
}
