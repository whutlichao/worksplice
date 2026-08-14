import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { getDb } from "../../data/db-singleton.ts";
import { listChannels, joinChannel, isChannelMember } from "./channels.ts";
import { createAgent, agentHomePath } from "./members.ts";
import { findSusanMember, notifySecretaryWelcome, SUSAN_MEMBER_NAME } from "./event-messages.ts";
import type { MemberRow } from "../../data/types.ts";
import { OWNER_MEMBER_ID } from "../../data/schema.ts";
import { MEMORY_FILE_NAME } from "../../data/dirs.ts";

/**
 * 秘书初始化流程（spec-bootstrap-agent.md §6.2，构建 effort ticket 04）：
 * 自动创建与手动入口共用的五步就绪流程，全部是既有服务层能力组合（零机制改动、签名不破坏）——
 * ① 身份与家目录（createAgent 契约）② 手册重写（MEMORY.md 速查 + SYSTEM-GUIDE.md，读自 02/03 内容资产）
 * ③ 频道覆盖（全部现存频道静默加入）④ 办公室频道「秘书办公室」幂等创建 ⑤ Owner 署名欢迎事件 → 秘书唤醒后正常回复。
 * 幂等：全步骤可重跑（手册覆盖写、加入幂等、办公室频道按 name 全等复用）；欢迎事件只在
 * 身份新建/办公室频道新建/办公室频道尚无消息（部分失败补跑窗口）时投递，重复运行不刷欢迎语。
 */

/** 秘书描述（spec §2.3）：展示于成员列表/详情面板。 */
export const SUSAN_DESCRIPTION =
  "worksplice 的秘书：自动加入全部频道，熟悉系统手册，可代办频道/成员创建与查询，越权操作引导 Owner UI";

/** 办公室频道（spec §1.3）：私有频道，成员 = Owner + 秘书；幂等判定键 = name 全等（§6.2-④）。 */
export const OFFICE_CHANNEL_NAME = "秘书办公室";

export const OFFICE_CHANNEL_DESCRIPTION = "秘书的 1:1 沟通场所";

/** SYSTEM-GUIDE.md 手册文件名（MEMORY.md 常量在 lib/data/dirs.ts）。 */
export const SECRETARY_GUIDE_FILE_NAME = "SYSTEM-GUIDE.md";

const SECRETARY_MANUAL_DIR_ENV = "SECRETARY_MANUAL_DIR";

/** 内容资产目录（02/03 交付）：默认 repo 内 `.scratch/bootstrap-agent-build/manual/`，可用 env 覆盖（测试/自定义部署）。 */
export function secretaryManualDir(): string {
  return (
    process.env[SECRETARY_MANUAL_DIR_ENV] ??
    join(process.cwd(), ".scratch", "bootstrap-agent-build", "manual")
  );
}

function readManualAsset(fileName: string): string {
  const filePath = join(secretaryManualDir(), fileName);
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    throw new Error(`Secretary manual asset missing: ${filePath}`);
  }
}

export interface InitSecretaryOptions {
  /** 创建时使用的模型（走 createAgent 契约）；null = 继承全局默认。存活秘书已存在时不生效。 */
  provider?: string | null;
  modelId?: string | null;
  thinkingLevel?: string | null;
}

/**
 * 确保秘书就绪（spec §6.2）：无存活 Susan 时按 createAgent 契约创建（判定 = 名字全等 + 存活，
 * findSusanMember 过滤软删；软删行存在不构成阻塞——重建语义归调用方裁定），随后执行
 * 手册重写 / 频道覆盖 / 办公室频道 / 欢迎事件。返回秘书成员行。
 * 软删语义由调用方前置判定（§6.1/§6.4 两规则相反，不能住在共享流程内）：
 * 自动创建（ticket 05）在调用前做"存活或软删均算已存在 → 不创建"的判定；
 * 启动助手重建（ticket 06）直接调用本流程即得重建行为。
 */
export function initSecretaryFlow(options: InitSecretaryOptions = {}): MemberRow {
  // 手册内容先读后写：资产缺失时在动任何状态前抛错（重跑安全，不半途留下残缺秘书）
  const memoryContent = readManualAsset(MEMORY_FILE_NAME);
  const guideContent = readManualAsset(SECRETARY_GUIDE_FILE_NAME);

  // ① 身份与家目录：createAgent 契约（家目录 + ADR-0001 固定大纲 MEMORY.md 先落地，随后被 ② 有意重写）
  const existing = findSusanMember();
  let susan = existing;
  if (!susan) {
    susan = createAgent({
      name: SUSAN_MEMBER_NAME,
      description: SUSAN_DESCRIPTION,
      provider: options.provider ?? null,
      modelId: options.modelId ?? null,
      thinkingLevel: options.thinkingLevel ?? null,
    });
  }
  const createdSusan = !existing;

  // ② 手册重写：MEMORY.md 整体重写为速查结构（保留"当前工作"节名，与 ADR-0001 固定大纲兼容），
  //    SYSTEM-GUIDE.md 首次落盘——内容 = 02/03 交付的内容资产逐字节
  const homeDir = susan.workspace_path ?? agentHomePath(susan);
  mkdirSync(homeDir, { recursive: true });
  writeFileSync(join(homeDir, MEMORY_FILE_NAME), memoryContent, "utf8");
  writeFileSync(join(homeDir, SECRETARY_GUIDE_FILE_NAME), guideContent, "utf8");

  // ③ 频道覆盖：全部现存频道（公开 + 私有）静默加入——joinChannel 对 Susan 的加入不投事件
  //    （§7 不存在"欢迎自己"）；#all 已由 createAgent 加入，重复加入幂等
  for (const channel of listChannels()) {
    if (!isChannelMember(channel.id, susan.id)) {
      joinChannel(channel.id, susan.id, OWNER_MEMBER_ID);
    }
  }

  // ④ 办公室频道「秘书办公室」：name 全等判定，已存在即复用（幂等），确保 Owner + 秘书成员。
  //    直接走 DB 原语而非 createChannel——createChannel 提交后投"新频道已建立"报到事件（§4.1 节点 2），
  //    与节点 3 的欢迎事件重复（双重唤醒/双重回复）；办公室频道以欢迎事件为唯一事件（§6.2-⑤）。
  let office = listChannels().find((c) => c.name === OFFICE_CHANNEL_NAME);
  const officeCreated = !office;
  if (!office) {
    office = getDb().insertChannel({
      name: OFFICE_CHANNEL_NAME,
      type: "private",
      description: OFFICE_CHANNEL_DESCRIPTION,
    });
  }
  // 成员补齐（幂等）：Owner 恒在；秘书被移出/部分失败残留时静默修复（joinChannel 对 Susan 不投事件）
  getDb().addChannelMember(office.id, OWNER_MEMBER_ID);
  if (!isChannelMember(office.id, susan.id)) {
    joinChannel(office.id, susan.id, OWNER_MEMBER_ID);
  }

  // ⑤ 欢迎事件：Owner 署名 + wake:false + 定向唤醒秘书（§4.1 节点 3 / §4.2 铁律：不以秘书署名触发）。
  //    幂等：身份新建 / 办公室频道新建 / 办公室频道尚无消息（补跑窗口）才投递，重复运行不刷欢迎语
  const welcomeNeeded = createdSusan || officeCreated || getDb().maxSeq(office.id) === 0;
  if (welcomeNeeded) {
    notifySecretaryWelcome(office.id);
  }
  return susan;
}
