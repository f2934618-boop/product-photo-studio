import { NextResponse } from "next/server";
import { getOrCreateUser, dbEnabled } from "@/lib/db";
import { newWorkspaceSession, workspaceEmail, WORKSPACE_COOKIE } from "@/lib/workspace-session";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const session = workspaceEmail(request) ? null : newWorkspaceSession();
  const email = workspaceEmail(request) || session!.email;
  try {
    const user = dbEnabled ? await getOrCreateUser(email, "共享工作台") : {
      name: "共享工作台", email, plan: "free", joinedAt: new Date().toISOString(), renewsAt: null, invoices: [],
    };
    const response = NextResponse.json({ user: { ...user, creditsTotal: 0, creditsUsed: 0 }, persisted: dbEnabled }, { headers: { "Cache-Control": "private, no-store" } });
    if (session) response.cookies.set(WORKSPACE_COOKIE, session.token, { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", maxAge: 365 * 86_400, path: "/" });
    return response;
  } catch {
    return NextResponse.json({ error: "工作台存储暂时不可用；快速抠图仍可使用" }, { status: 503 });
  }
}
