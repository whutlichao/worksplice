import { isIP } from "node:net";

function normalizeHostname(value: string): string {
  const unbracketed = value.startsWith("[") && value.endsWith("]")
    ? value.slice(1, -1)
    : value;
  return unbracketed.toLowerCase().replace(/\.$/, "");
}

function hostnameFromAuthority(value: string): string | null {
  if (!value || /[\s/@\\]/.test(value)) return null;
  try {
    const parsed = new URL(`http://${value}`);
    if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
      return null;
    }
    return normalizeHostname(parsed.hostname);
  } catch {
    return null;
  }
}

function normalizeConfiguredHostname(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return isIP(trimmed) ? normalizeHostname(trimmed) : hostnameFromAuthority(trimmed);
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname.endsWith(".localhost");
}

function configuredHostnamesFromEnvironment(): string[] {
  return [
    process.env.WORKSPLICE_HOSTNAME,
    ...(process.env.WORKSPLICE_ALLOWED_HOSTS?.split(",") ?? []),
  ].filter((value): value is string => Boolean(value?.trim()));
}

function canonicalOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/** 取转发头的第一个逗号分隔值：最外层（浏览器看到的）来源，后续是代理链内跳。 */
function firstForwardedValue(value: string | null): string | null {
  const first = value?.split(",", 1)[0]?.trim();
  return first ? first : null;
}

/** 转发 host 只有在能通过 `hostnameFromAuthority` 校验时才被采信，否则返回 null。 */
function forwardedAuthority(request: Request): string | null {
  const forwarded = firstForwardedValue(request.headers.get("x-forwarded-host"));
  return forwarded && hostnameFromAuthority(forwarded) ? forwarded : null;
}

function forwardedProtocol(request: Request): string | null {
  const forwarded = firstForwardedValue(request.headers.get("x-forwarded-proto"))?.toLowerCase();
  return forwarded === "http" || forwarded === "https" ? `${forwarded}:` : null;
}

/**
 * 重建浏览器看到的请求 origin，用于和 `Origin` 做同源比较。可信反向代理
 * （如 Orca 的 dev 代理）会把 `Host` 改写成上游 bind 地址，把外部 host 放进
 * `X-Forwarded-Host`、外部协议放进 `X-Forwarded-Proto`，所以这里优先取转发
 * 头的第一个值；转发 host 必须能通过 `hostnameFromAuthority` 校验，否则回退
 * 到 `Host`。两者都缺失或非法时返回 null（拒绝）。
 *
 * 信任转发头不放宽跨站防护：浏览器无法在简单请求（表单 / no-cors fetch）上
 * 设置 `X-Forwarded-Host`，带自定义头的 fetch 会先触发 CORS 预检，而本服务
 * 不回应预检；跨站请求在 `isApiRequestOriginAllowed` 的
 * `Sec-Fetch-Site: cross-site` 处已被拒绝。转发头只决定「重建 origin 用哪个
 * host」，不影响 `isApiRequestHostAllowed`——Host 白名单仍只读 `Host`，因此
 * DNS rebinding 防护面不变。能直连端口的非浏览器客户端本就不做来源校验
 * （见 `.github/SECURITY.md`）。
 */
function getRequestOrigin(request: Request): string | null {
  const requestUrl = new URL(request.url);
  const authority = forwardedAuthority(request) ?? request.headers.get("host");
  if (!authority) return null;
  const protocol = forwardedProtocol(request) ?? requestUrl.protocol;
  return canonicalOrigin(`${protocol}//${authority}`);
}

function isUserInitiatedSessionExportNavigation(request: Request): boolean {
  if (
    request.method !== "GET"
    || request.headers.get("sec-fetch-mode") !== "navigate"
    || request.headers.get("sec-fetch-dest") !== "document"
    || request.headers.get("sec-fetch-user") !== "?1"
  ) {
    return false;
  }

  try {
    return /^\/api\/sessions\/[^/]+\/export$/.test(new URL(request.url).pathname);
  } catch {
    return false;
  }
}

/**
 * Only trust local names, IP literals, or the hostname explicitly selected by
 * the operator. IP literals preserve LAN access but cannot be DNS-rebound
 * because the browser keeps the literal address in the Host header.
 */
export function isApiRequestHostAllowed(
  request: Request,
  configuredHostnames = configuredHostnamesFromEnvironment(),
): boolean {
  const host = request.headers.get("host");
  const hostname = host ? hostnameFromAuthority(host) : null;
  if (!hostname) return false;
  if (isLoopbackHostname(hostname) || isIP(hostname)) return true;

  return configuredHostnames.some(
    (configured) => normalizeConfiguredHostname(configured) === hostname,
  );
}

/** Reject browser cross-site API requests while preserving non-browser clients. */
export function isApiRequestOriginAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return false;
  if (!origin) return true;

  const requestOrigin = getRequestOrigin(request);
  return requestOrigin !== null && canonicalOrigin(origin) === requestOrigin;
}

export function shouldCheckApiRequestOrigin(request: Request): boolean {
  return request.headers.has("origin") || request.headers.has("sec-fetch-site");
}

export function isApiRequestAllowed(
  request: Request,
  configuredHostnames = configuredHostnamesFromEnvironment(),
): boolean {
  if (!isApiRequestHostAllowed(request, configuredHostnames)) return false;
  if (isUserInitiatedSessionExportNavigation(request)) return true;
  return !shouldCheckApiRequestOrigin(request) || isApiRequestOriginAllowed(request);
}

export function hasJsonContentType(request: Request): boolean {
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType === "application/json"
    || Boolean(mediaType?.startsWith("application/") && mediaType.endsWith("+json"));
}
