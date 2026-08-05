import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DB_FILE_NAME = "raft.db";
export const ATTACHMENTS_DIR_NAME = "attachments";
export const AGENTS_DIR_NAME = "agents";
export const MEMORY_FILE_NAME = "MEMORY.md";

export function resolveDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.WORKSPLICE_DATA_DIR;
  return override ? path.resolve(override) : path.join(os.homedir(), ".worksplice");
}

export interface DataPaths {
  dataDir: string;
  dbFile: string;
  attachmentsDir: string;
  agentsDir: string;
}

export function dataPaths(dataDir: string): DataPaths {
  return {
    dataDir,
    dbFile: path.join(dataDir, DB_FILE_NAME),
    attachmentsDir: path.join(dataDir, ATTACHMENTS_DIR_NAME),
    agentsDir: path.join(dataDir, AGENTS_DIR_NAME),
  };
}

export function ensureDataDir(dataDir: string): DataPaths {
  const paths = dataPaths(dataDir);
  fs.mkdirSync(paths.dataDir, { recursive: true });
  fs.mkdirSync(paths.attachmentsDir, { recursive: true });
  fs.mkdirSync(paths.agentsDir, { recursive: true });
  return paths;
}

/** 家目录 slug：小写、非 [a-z0-9] 转连字符、折叠、去首尾；空（纯中文名等）回退 "agent"。 */
export function agentSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "agent";
}

/** 确定性家目录（<agentsRoot>/<slug>-<id前8位>）：唯一、稳定（改名也不断链）、文件系统安全。 */
export function agentHomeDir(dataDir: string, id: string, name: string): string {
  return path.join(dataDir, AGENTS_DIR_NAME, `${agentSlug(name)}-${id.slice(0, 8)}`);
}

/** MEMORY.md 固定大纲（ADR-0001）：正文可为空，文件归 agent 所有。 */
export function buildMemoryTemplate(name: string, description: string): string {
  const role = description.trim() ? `## 角色描述\n\n${description.trim()}` : "## 角色描述";
  return `# ${name}\n\n${role}\n\n## 当前工作\n\n## 工作流程\n\n## Skill 使用\n\n## 工具使用\n\n## 其他\n`;
}
