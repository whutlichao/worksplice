"use client";

import { useRef, useState } from "react";
import { Check } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { BrutalModal } from "./BrutalModal";
import { Avatar } from "./Avatar";
import {
  chiefFailureText,
  isChiefFailureCode,
} from "@/lib/chief-failure";
import { liveSusanMemberId, precheckSusanForPrivateChannel } from "@/lib/secretary-bootstrap";
import type { MemberRow } from "@/lib/data/types";

/** #252 建频道时的首席候选 = 本次一并加入（已勾选）的未软删 agent 成员：
 *  频道首席必须先是该频道成员，所以不在这里送出「建完再补」的目标。
 *  `deleted` 与 `lib/secretary-bootstrap` 同口径防御一次（成员列表侧其实已过滤）。 */
export function chiefCandidateOptions(
  agents: MemberRow[],
  memberIds: string[],
): Array<{ id: string; name: string }> {
  return agents
    .filter(
      (agent) =>
        agent.type === "agent" &&
        agent.deleted !== 1 &&
        memberIds.includes(agent.id),
    )
    .map((agent) => ({ id: agent.id, name: agent.name }));
}

export function CreateChannelModal({
  agents,
  onClose,
  onCreated,
}: {
  agents: MemberRow[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [type, setType] = useState<"public" | "private">("public");
  const [description, setDescription] = useState("");
  const [memberIds, setMemberIds] = useState<string[]>([]);
  /** #252 建频道时指定的频道首席："" = 不指定（回落全局）。 */
  const [chiefMemberId, setChiefMemberId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // §7 新建私有频道默认预勾选 Susan（可取消）：活存 Susan 的 id；用户手动勾/取消过 Susan 后不再自动补。
  const susanId = liveSusanMemberId(agents);
  const susanTouchedRef = useRef(false);

  const canSubmit = name.trim().length > 0 && !busy;

  /**
   * 成员集合变更的唯一写入口（#252）：首席候选只能是本次加入的 agent，
   * 被移出候选的首席选择复位成「回落全局」——不提交一个服务层必然拒绝的目标。
   */
  const applyMemberIds = (next: string[]) => {
    setMemberIds(next);
    if (chiefMemberId && !next.includes(chiefMemberId)) setChiefMemberId("");
  };

  const selectType = (value: "public" | "private") => {
    setType(value);
    applyMemberIds(
      precheckSusanForPrivateChannel(
        memberIds,
        value,
        susanId,
        susanTouchedRef.current,
      ),
    );
  };

  const toggleMember = (id: string) => {
    if (id === susanId) susanTouchedRef.current = true;
    applyMemberIds(
      memberIds.includes(id)
        ? memberIds.filter((m) => m !== id)
        : [...memberIds, id],
    );
  };

  /** #252 首席候选：只能选本次一并加入的 agent 成员。 */
  const chiefCandidates = chiefCandidateOptions(agents, memberIds);

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          type,
          description: description.trim(),
          memberIds,
          // #252 不指定 ⇒ null（不写频道首席，建出来的频道回落到全局首席）。
          chiefMemberId: chiefMemberId === "" ? null : chiefMemberId,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
      };
      if (!res.ok) {
        // 首席被拒绝时把服务端原因拼进可读文案（原因不吞）；其余失败沿用既有提示。
        // 判据是**完整码表**（与频道设置同一份），不是前缀猜——`not_channel_member`
        // 与 `channel_not_found` 也要本地化。
        if (isChiefFailureCode(body.code)) {
          throw new Error(
            t("chief.selectionRejected", {
              reason: chiefFailureText(t, body.code, body.error ?? t("chief.failed")),
            }),
          );
        }
        throw new Error(body.error ?? t("channel.createFailed"));
      }
      onCreated();
    } catch (e) {
      // 失败只多一条错误文案：表单与选择保留，不装作建好了。
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <BrutalModal title={t("channel.create")} onClose={onClose} width={520}>
      {/* 形态（票 08）：`.field` + `.input` / `.textarea` + `.radio-row` / `.radio-card`
          + `.member-pick` / `.member-opt`；动作收在 `.modal-foot`。逻辑与字段关联不动。 */}
      <div className="modal-body">
        <div className="field">
          <label htmlFor="channel-name">{t("channel.name")}</label>
          <input
            id="channel-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
            placeholder="# general"
            autoFocus
          />
        </div>

        <div className="field" role="group" aria-labelledby="channel-type-label">
          <label id="channel-type-label">{t("channel.type")}</label>
          <div className="radio-row">
            {(["public", "private"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => selectType(value)}
                aria-pressed={type === value}
                className={type === value ? "radio-card is-on" : "radio-card"}
              >
                <b>{value === "public" ? t("channel.public") : t("channel.private")}</b>
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label htmlFor="channel-description">{t("channel.description")}</label>
          <textarea
            id="channel-description"
            className="textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
          />
        </div>

        {agents.length > 0 && (
          <div className="field" role="group" aria-labelledby="channel-members-label">
            <label id="channel-members-label">{t("channel.initialMembers")}</label>
            <div className="member-pick">
              {agents.map((agent) => {
                const selected = memberIds.includes(agent.id);
                return (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => toggleMember(agent.id)}
                    aria-pressed={selected}
                    className={selected ? "member-opt is-on" : "member-opt"}
                  >
                    <Avatar
                      name={agent.name}
                      type={agent.type}
                      size="sm"
                      colorKey={agent.id}
                      agentTint={agent.avatar_tint}
                    />
                    <span
                      style={{
                        maxWidth: 160,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {agent.name}
                    </span>
                    <span
                      style={{
                        fontFamily: "var(--mono)",
                        fontSize: 11,
                        color: selected ? "var(--accent-deep)" : "var(--faint)",
                      }}
                    >
                      {selected ? <Check size={11} style={{ verticalAlign: "-2px" }} /> : "+"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {error && (
          <div style={{ marginTop: 10, color: "var(--error)", fontSize: "var(--fs-sm)" }}>
            {error}
          </div>
        )}

        {/* #252 频道首席：默认「回落全局」；候选只能是本次一并加入的 agent 成员。 */}
        <div className="field">
          <label htmlFor="channel-chief">{t("chief.createLabel")}</label>
          <select
            id="channel-chief"
            data-testid="create-channel-chief"
            className="select"
            value={chiefMemberId}
            onChange={(e) => setChiefMemberId(e.target.value)}
          >
            <option value="">{t("chief.fallbackOption")}</option>
            {chiefCandidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
          <div
            style={{
              marginTop: 4,
              fontFamily: "var(--mono)",
              fontSize: 11,
              color: "var(--muted)",
            }}
          >
            {t("chief.createHint")}
          </div>
        </div>
      </div>

      <div className="modal-foot">
        <span className="sep" />
        <button type="button" className="btn" onClick={onClose}>
          {t("channel.cancel")}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!canSubmit}
          onClick={() => void submit()}
        >
          {t("channel.create")}
        </button>
      </div>
    </BrutalModal>
  );
}
