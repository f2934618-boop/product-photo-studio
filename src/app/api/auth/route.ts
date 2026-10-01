import { NextResponse } from "next/server";
import { supabaseEnabled } from "@/lib/auth-mode";
import { adminSupabase } from "@/lib/supabase-admin";
import { dbEnabled, getOrCreateUser } from "@/lib/db";
import { normalizeReferralCode } from "@/lib/referral";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Server-side signup that auto-confirms the email (no email round-trip).
// Sign-in itself is done client-side via supabase-js.
export async function POST(req: Request) {
  if (!supabaseEnabled) {
    return NextResponse.json(
      { error: "未配置 Supabase Auth" },
      { status: 503 }
    );
  }

  let body: {
    email?: string;
    password?: string;
    name?: string;
    referralCode?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体无效" }, { status: 400 });
  }

  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  const name = (body.name ?? "").trim();
  const referralCode = normalizeReferralCode(body.referralCode);

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "邮箱格式不正确" }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json(
      { error: "密码至少 6 位" },
      { status: 400 }
    );
  }

  const { error } = await adminSupabase().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      name: name || email.split("@")[0],
      ...(referralCode ? { referral_code: referralCode } : {}),
    },
  });

  if (error) {
    // Already-registered is fine — the client just signs in afterwards.
    if (/already|registered|exists/i.test(error.message)) {
      return NextResponse.json({ ok: true, existed: true });
    }
    // 原始 GoTrue 报错只 server 端 log,前端回通用文案(不漏后端基础设施细节)
    console.error("[auth] signup failed:", error.message);
    return NextResponse.json(
      { error: "注册失败,请检查邮箱和密码后重试" },
      { status: 400 }
    );
  }
  if (dbEnabled) {
    // Auth 用户和应用用户通常由 SessionBridge 对齐；这里先落一次，确保即使
    // 登录后的客户端请求中断，首次注册携带的邀请码也不会丢。
    await getOrCreateUser(
      email,
      name || email.split("@")[0],
      referralCode
    ).catch((syncError) => {
      console.error(
        "[auth] referral sync failed:",
        syncError instanceof Error ? syncError.message : syncError
      );
    });
  }
  return NextResponse.json({ ok: true });
}
