import { NextResponse, type NextRequest } from "next/server";
import {
  isApiRequestAllowed,
  isApiRequestHostAllowed,
} from "@/lib/request-security";
import {
  isValidBasicAuthorization,
  isWebPasswordEnabled,
} from "@/lib/web-auth";
import { accessGateClosedMessage, getAccessPosture } from "@/lib/access-gate";

export async function proxy(request: NextRequest) {
  // 人类面准入闸（ADR-0013 决策二）：非 loopback bind + 无凭证 ⇒ 服务不可用（fail-closed）。
  // 放在 Host/来源校验之前：服务整体不可用时，任何请求都拿不到内容（503，不是「请认证」）；
  // 判定在服务进程内做（四条 npm 脚本绕过 bin/worksplice.js），CLI 包装另有第一道报错。
  const posture = await getAccessPosture();
  if (posture === "closed") {
    return new NextResponse(accessGateClosedMessage(), {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const isApiRequest = request.nextUrl.pathname === "/api"
    || request.nextUrl.pathname.startsWith("/api/");
  const isTrustedRequest = isApiRequest
    ? isApiRequestAllowed(request)
    : isApiRequestHostAllowed(request);

  if (!isTrustedRequest) {
    if (!isApiRequest) {
      return new NextResponse("Untrusted request", { status: 403 });
    }
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  const password = process.env.WORKSPLICE_PASSWORD;
  if (
    isWebPasswordEnabled(password)
    && !isValidBasicAuthorization(request.headers.get("authorization"), password)
  ) {
    return new NextResponse("Authentication required", {
      status: 401,
      headers: {
        "Cache-Control": "no-store",
        "WWW-Authenticate": 'Basic realm="worksplice", charset="UTF-8"',
      },
    });
  }

  return NextResponse.next();
}

export const config = { matcher: ["/", "/api/:path*"] };
