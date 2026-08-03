import { getDb } from "./db-singleton.ts";
import type { ChannelRow } from "../data/db.ts";

export function listChannels(): ChannelRow[] {
  return getDb().listChannels();
}

export function getChannel(id: string): ChannelRow | undefined {
  return getDb().getChannel(id);
}

export function createChannel(input: {
  name: string;
  type?: ChannelRow["type"];
  description?: string;
}): ChannelRow {
  const name = input.name.trim();
  if (!name) throw new Error("Channel name is required");
  if (name.length > 32) throw new Error("Channel name must be 32 characters or fewer");
  return getDb().insertChannel({
    name,
    type: input.type ?? "public",
    description: (input.description ?? "").trim(),
  });
}
