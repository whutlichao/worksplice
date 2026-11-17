/**
 * 领域错误的统一约定（票 #277）：每个领域错误实例自带 HTTP `status` 与稳定英文 `code`。
 *
 * 纯模块：零 import、零 IO、零 DB / Next / React 依赖。协作域的错误类从这里继承；
 * 路由层只经 `jsonError` 一次译码——新增错误类不再需要回改 N 个 catch。
 *
 * `jsonError` 是**唯一**的错误 → HTTP 响应译码点：域错误按自身的 `status` / `code`
 * 出线，未知错误落到调用方给的兜底码（默认 500）。这里用 web 标准的 `Response`
 * 而不是 `NextResponse`，让本模块保持零依赖、且 Node 测试可直接调用。
 */

/**
 * HTTP 状态码（只取本仓领域错误与路由兜底实际用到的几档；保持窄面，新增档位按需加）。
 * 502/504 只出现在非领域错误的路由兜底（上游目录 / 探测超时），领域错误自身不用。
 */
export type DomainErrorStatus = 400 | 403 | 404 | 409 | 429 | 500 | 502 | 504;

/** 随错误一起出线的结构化字段（例如任务 claim 的 conflict/blocked 兼容面）。 */
export type DomainErrorDetails = Readonly<Record<string, unknown>>;

/**
 * 领域错误基类：`status` 给 HTTP，`code` 给客户端/日志做稳定判据。
 * 人读文案沿既有 i18n 分层：错误 `message` 是英文产品内容，界面文案由前端按 `code` 选。
 */
export class DomainError extends Error {
  readonly status: DomainErrorStatus;
  readonly code: string;
  readonly details?: DomainErrorDetails;

  constructor(
    status: DomainErrorStatus,
    code: string,
    message: string,
    details?: DomainErrorDetails,
  ) {
    super(message);
    this.name = "DomainError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** 错误正文提取的唯一字面：Error 取 message，非 Error 取 String（与旧口径一致）。 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 领域错误判定：只认本进程内 DomainError 继承链上的实例。 */
export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}

/**
 * 错误 → JSON HTTP 响应的唯一译码点。
 *
 * - `DomainError`：`{ ...details, error, code }`，状态取自身的 `status`；
 * - 未知错误：`{ error }`，状态取 `fallbackStatus`（默认 500）。
 *
 * `fallbackStatus` 只表达「这条路由的其余异常按什么码兜底」，不参与领域错误的判定。
 */
export function jsonError(error: unknown, fallbackStatus: DomainErrorStatus = 500): Response {
  if (error instanceof DomainError) {
    return Response.json(
      { ...error.details, error: error.message, code: error.code },
      { status: error.status },
    );
  }
  return Response.json({ error: errorMessage(error) }, { status: fallbackStatus });
}
