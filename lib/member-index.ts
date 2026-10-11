import type { MemberRow } from "@/lib/data/types";

/** 协作消息视图共用的当前身份索引。 */
export function indexCurrentMembersById(
  agents: readonly MemberRow[] | undefined,
  owner: MemberRow | null | undefined,
): ReadonlyMap<string, MemberRow> {
  return new Map(
    [...(agents ?? []), ...(owner ? [owner] : [])].map(
      (member) => [member.id, member] as const,
    ),
  );
}
