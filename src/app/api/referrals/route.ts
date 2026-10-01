import { NextResponse } from "next/server";
import { resolveSessionUserEmail } from "@/lib/admin-auth";
import { dbEnabled, getReferralDashboard } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!dbEnabled) {
    return NextResponse.json({ error: "数据库未配置" }, { status: 503 });
  }
  const email = await resolveSessionUserEmail(request);
  if (!email) {
    return NextResponse.json({ error: "请登录后查看邀请记录" }, { status: 401 });
  }
  try {
    const dashboard = await getReferralDashboard(email);
    if (!dashboard) {
      return NextResponse.json({ error: "用户不存在" }, { status: 404 });
    }
    return NextResponse.json(dashboard, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "邀请记录读取失败" },
      { status: 500 }
    );
  }
}
