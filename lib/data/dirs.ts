import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DB_FILE_NAME = "raft.db";
export const ATTACHMENTS_DIR_NAME = "attachments";

export function resolveDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.WORKSPLICE_DATA_DIR;
  return override ? path.resolve(override) : path.join(os.homedir(), ".worksplice");
}

export interface DataPaths {
  dataDir: string;
  dbFile: string;
  attachmentsDir: string;
}

export function dataPaths(dataDir: string): DataPaths {
  return {
    dataDir,
    dbFile: path.join(dataDir, DB_FILE_NAME),
    attachmentsDir: path.join(dataDir, ATTACHMENTS_DIR_NAME),
  };
}

export function ensureDataDir(dataDir: string): DataPaths {
  const paths = dataPaths(dataDir);
  fs.mkdirSync(paths.dataDir, { recursive: true });
  fs.mkdirSync(paths.attachmentsDir, { recursive: true });
  return paths;
}
