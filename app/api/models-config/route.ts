import { NextResponse } from "next/server";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "@/lib/atomic-file";
import { invalidateModelsCache } from "@/lib/models-cache";

export const dynamic = "force-dynamic";

function getModelsPath(): string {
  return join(getAgentDir(), "models.json");
}

function readModelsJson(): Record<string, unknown> {
  const path = getModelsPath();
  if (!existsSync(path)) return { providers: {} };
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return { providers: {} };
  }
}

function writeModelsJson(data: Record<string, unknown>): void {
  const path = getModelsPath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writePrivateFileAtomicSync(path, JSON.stringify(data, null, 2));
}

function sanitizeModelsJson(data: Record<string, unknown>): Record<string, unknown> {
  const result = { ...data };
  const providers = data.providers;
  if (!providers || typeof providers !== "object" || Array.isArray(providers)) {
    return result;
  }
  const cleaned: Record<string, unknown> = {};
  for (const [name, provider] of Object.entries(providers as Record<string, unknown>)) {
    if (!provider || typeof provider !== "object" || Array.isArray(provider)) continue;
    const entry = { ...(provider as Record<string, unknown>) };
    const models = entry.models;
    if (Array.isArray(models)) {
      // 空模型条目（{"id":""}）会让 SDK 拒绝加载整个 models.json——过滤后再落盘
      entry.models = models.filter(
        (m) => m && typeof m === "object" && typeof (m as { id?: unknown }).id === "string"
          && (m as { id: string }).id.trim() !== "",
      );
    }
    cleaned[name] = entry;
  }
  return { ...result, providers: cleaned };
}

export async function GET() {
  return NextResponse.json(readModelsJson());
}

export async function PUT(req: Request) {
  try {
    const body = await req.json() as Record<string, unknown>;
    writeModelsJson(sanitizeModelsJson(body));
    invalidateModelsCache();
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
