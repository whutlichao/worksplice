"use client";

import { useI18n } from "@/hooks/useI18n";
import { BrutalModal } from "./BrutalModal";
import { PixelAvatar } from "./PixelAvatar";

const INK = "#141111";

const LABEL_STYLE: React.CSSProperties = {
  fontFamily: "var(--font-space-mono)",
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--text-dim)",
  margin: "12px 0 4px",
};

/** 人类成员（Owner）简介弹窗：mention 点击打开。 */
export function MemberProfileModal({
  member,
  onClose,
}: {
  member: { id: string; name: string; description?: string; created_at?: string };
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <BrutalModal title={t("memberProfile.title")} onClose={onClose}>
      <div style={{ padding: "8px 16px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <PixelAvatar seed={member.name} name={member.name} size={48} />
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text)" }}>{member.name}</div>
            <span
              style={{
                display: "inline-block",
                marginTop: 4,
                padding: "2px 8px",
                background: "var(--yellow)",
                border: `2px solid ${INK}`,
                fontFamily: "var(--font-space-mono)",
                fontSize: 10,
                fontWeight: 700,
                color: "var(--text)",
              }}
            >
              {t("role.owner")}
            </span>
          </div>
        </div>

        <div style={LABEL_STYLE}>{t("memberProfile.description")}</div>
        <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--text)" }}>
          {member.description?.trim()
            ? member.description.trim()
            : <span style={{ color: "var(--text-dim)" }}>{t("memberProfile.noDescription")}</span>}
        </div>

        <div style={LABEL_STYLE}>{t("memberProfile.joinedAt")}</div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", fontFamily: "var(--font-space-mono)" }}>
          {member.created_at ? new Date(member.created_at).toLocaleString() : "—"}
        </div>
      </div>
    </BrutalModal>
  );
}
