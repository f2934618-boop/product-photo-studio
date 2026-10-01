import { NextResponse } from "next/server";
import {
  CloudflareAIRequestError,
  reshootProductWithCloudflare,
} from "@/lib/cloudflare-ai";
import { clientIp } from "@/lib/ip";
import { rateLimit } from "@/lib/rate-limit";
import { getCloudflareAISettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

function response(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}

export async function GET() {
  const settings = await getCloudflareAISettings();
  return response({ ready: settings.ready });
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data")) {
    return response({ error: "请求格式不正确" }, 400);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return response({ error: "请求格式不正确" }, 400);
  }
  const image = form.get("image");
  if (!(image instanceof File) || image.size === 0) {
    return response({ error: "请先上传商品图片" }, 400);
  }
  if (!image.type.startsWith("image/")) {
    return response({ error: "仅支持图片文件" }, 400);
  }
  if (image.size > MAX_IMAGE_BYTES) {
    return response({ error: "图片过大（请小于 12MB）" }, 400);
  }

  const ip = clientIp(request);
  if (!rateLimit(`ai-product-reshoot:${ip}`, 10, 10 * 60_000)) {
    return response({ error: "高质量生成请求过于频繁，请稍后再试" }, 429);
  }

  const ratio = String(form.get("ratio") || "1:1");
  const prompt = String(form.get("prompt") || "");
  const quality =
    String(form.get("quality") || "standard") === "quality"
      ? "quality"
      : "standard";
  try {
    const settings = await getCloudflareAISettings();
    const result = await reshootProductWithCloudflare({
      bytes: Buffer.from(await image.arrayBuffer()),
      ratio,
      prompt,
      quality,
      settings,
    });
    return response({ ok: true, image: result });
  } catch (error) {
    if (error instanceof CloudflareAIRequestError) {
      return response({ error: error.message }, error.status);
    }
    console.error(
      "[ai-product-reshoot] failed:",
      error instanceof Error ? error.message : error
    );
    return response({ error: "高质量生成失败，请稍后重试" }, 500);
  }
}

