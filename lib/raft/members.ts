import { getDb } from "./db-singleton.ts";
import type { MemberRow } from "../data/db.ts";

/** 左栏 agent 成员列表（§3.1）：只列 agent 类型成员。 */
export function listAgents(): MemberRow[] {
  return getDb()
    .listMembers()
    .filter((m) => m.type === "agent");
}

export function getMember(id: string): MemberRow | undefined {
  return getDb().getMember(id);
}

export function createAgent(input: {
  name: string;
  description?: string;
  workspacePath?: string | null;
}): MemberRow {
  const name = input.name.trim();
  if (!name) throw new Error("Agent name is required");
  if (name.length > 32) throw new Error("Agent name must be 32 characters or fewer");
  return getDb().insertMember({
    type: "agent",
    name,
    description: (input.description ?? "").trim(),
    role: "member",
    workspacePath: input.workspacePath ?? null,
    status: "offline",
  });
}
