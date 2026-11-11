"use client";

import { X } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";

/**
 * 对话框标题栏的关闭键（票 03，S3）：`.icon-btn` + lucide `X`，与 `BrutalModal`
 * 的 `.modal-head` 完全同形。三个对话框外壳（`BrutalModal` / `ModelsConfig` /
 * `SkillsConfig`）共用这一份，避免「可见关闭入口」的 markup 各抄一遍。
 */
export function DialogCloseButton({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      className="icon-btn"
      aria-label={t("common.close")}
      onClick={onClose}
    >
      <X size={13} />
    </button>
  );
}
