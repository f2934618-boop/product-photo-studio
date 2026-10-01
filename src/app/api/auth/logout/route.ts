import { NextResponse } from "next/server";
import { USER_COOKIE } from "@/lib/native-auth";
import { shouldUseSecureCookie } from "@/lib/cookie-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 原生多用户:退出登录(清会话 cookie)。
export async function POST(req: Request) {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(USER_COOKIE, "", {
    path: "/",
    maxAge: 0,
    secure: shouldUseSecureCookie(req),
  });
  return res;
}
