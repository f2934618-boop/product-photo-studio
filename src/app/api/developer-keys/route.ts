import { NextResponse } from "next/server";
import {
  createDeveloperApiKey,
  dbEnabled,
  deleteDeveloperApiKey,
  disableDeveloperApiKey,
  getOrCreateUser,
  listDeveloperApiKeys,
} from "@/lib/db";
import { resolveSessionUserEmail } from "@/lib/admin-auth";
import { clientIp } from "@/lib/ip";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" };
const ID_RE = /^dak_[0-9a-f-]{36}$/i;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

async function owner(request: Request): Promise<string | null> {
  return resolveSessionUserEmail(request);
}

function databaseRequired() {
  return json(
    {
      configured: false,
      error: "API Key 需要数据库持久化，请先配置 DATABASE_URL。",
    },
    503
  );
}

export async function GET(request: Request) {
  if (!dbEnabled) return databaseRequired();
  const email = await owner(request);
  if (!email) return json({ error: "请先登录后管理 API Key" }, 401);
  try {
    return json({ configured: true, keys: await listDeveloperApiKeys(email) });
  } catch {
    return json({ error: "API Key 列表加载失败" }, 500);
  }
}

export async function POST(request: Request) {
  if (!dbEnabled) return databaseRequired();
  if (!sameOrigin(request)) return json({ error: "请求来源无效" }, 403);
  const email = await owner(request);
  if (!email) return json({ error: "请先登录后创建 API Key" }, 401);
  if (!rateLimit(`developer-key-create:${email}:${clientIp(request) ?? "-"}`, 12, 600_000)) {
    return json({ error: "创建过于频繁，请稍后再试" }, 429);
  }

  let body: { name?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "请求格式不正确" }, 400);
  }
  const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
  if (!name) return json({ error: "请输入 Key 名称" }, 400);
  if (name.length > 40) return json({ error: "Key 名称不能超过 40 个字符" }, 400);

  try {
    // 有效登录态首次创建时补齐本站用户行，随后 FK 将 Key 固定绑定到该用户。
    await getOrCreateUser(email, "");
    const created = await createDeveloperApiKey(email, name);
    return json({ configured: true, ...created }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/最多创建 10 个/.test(message)) return json({ error: message }, 409);
    return json({ error: "API Key 创建失败" }, 500);
  }
}

export async function PATCH(request: Request) {
  if (!dbEnabled) return databaseRequired();
  if (!sameOrigin(request)) return json({ error: "请求来源无效" }, 403);
  const email = await owner(request);
  if (!email) return json({ error: "请先登录后操作" }, 401);
  let body: { id?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "请求格式不正确" }, 400);
  }
  const id = typeof body.id === "string" ? body.id : "";
  if (!ID_RE.test(id)) return json({ error: "Key 标识无效" }, 400);
  try {
    const key = await disableDeveloperApiKey(email, id);
    return key ? json({ key }) : json({ error: "API Key 不存在" }, 404);
  } catch {
    return json({ error: "API Key 停用失败" }, 500);
  }
}

export async function DELETE(request: Request) {
  if (!dbEnabled) return databaseRequired();
  if (!sameOrigin(request)) return json({ error: "请求来源无效" }, 403);
  const email = await owner(request);
  if (!email) return json({ error: "请先登录后操作" }, 401);
  let body: { id?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "请求格式不正确" }, 400);
  }
  const id = typeof body.id === "string" ? body.id : "";
  if (!ID_RE.test(id)) return json({ error: "Key 标识无效" }, 400);
  try {
    return (await deleteDeveloperApiKey(email, id))
      ? json({ ok: true })
      : json({ error: "API Key 不存在" }, 404);
  } catch {
    return json({ error: "API Key 删除失败" }, 500);
  }
}
