import { NextResponse } from "next/server";
import OpenAI, { toFile } from "openai";
import {
  CloudflareAIRequestError,
  cloudflareAvailable,
  reshootProductWithCloudflare,
} from "@/lib/cloudflare-ai";
import { clientIp } from "@/lib/ip";
import { rateLimit } from "@/lib/rate-limit";
import { getCloudflareAISettings, getOpenAISettings } from "@/lib/settings";
import { getOpenAIBaseUrl } from "@/lib/openai-base";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

const OPENAI_RESHOOT_PROMPT = `Use the uploaded product photo as the only product reference. Create a premium e-commerce studio packshot on a pure white background.

Keep the same product identity, packaging structure, box stack, red ribbon, printed illustrations, visible Chinese text, logos, colors and material feel. Recompose it as a clean product-only studio image with a balanced front three-quarter view when possible, centered in frame, with crisp edges, commercial lighting and a soft realistic contact shadow. Remove the hand or glove and any street or outdoor background. Do not add unrelated props, do not replace the packaging design, do not invent new branding, no border, no watermark.`;

function sizeFor(ratio: string) {
  if (ratio === "3:4" || ratio === "9:16") return "1024x1536";
  if (ratio === "4:3" || ratio === "16:9") return "1536x1024";
  return "1024x1024";
}

async function normalizeForEdit(buf: Buffer): Promise<Buffer> {
  try {
    const sharp = (await import("sharp")).default;
    return await sharp(buf).rotate().png().toBuffer();
  } catch {
    return buf;
  }
}

async function dataUrlFromOpenAIImage(item: { b64_json?: string; url?: string }) {
  if (item.b64_json) return `data:image/png;base64,${item.b64_json}`;
  if (item.url) {
    const response = await fetch(item.url, { cache: "no-store" });
    if (!response.ok) throw new Error("AI 服务返回的图片下载失败");
    const mime = response.headers.get("content-type")?.split(";")[0] || "image/png";
    const bytes = Buffer.from(await response.arrayBuffer());
    return `data:${mime};base64,${bytes.toString("base64")}`;
  }
  throw new Error("AI 服务未返回图片");
}

async function reshootWithOpenAI(opts: {
  bytes: Buffer;
  ratio: string;
  prompt: string;
  quality: "standard" | "quality";
}) {
  const settings = await getOpenAISettings();
  if (!settings.apiKey.trim()) return null;
  const model = settings.model || "gpt-image-2";
  const client = new OpenAI({
    apiKey: settings.apiKey,
    baseURL: (await getOpenAIBaseUrl()) || undefined,
    timeout: 280_000,
    maxRetries: 0,
  });
  const image = await normalizeForEdit(opts.bytes);
  const prompt = opts.prompt.trim()
    ? `${OPENAI_RESHOOT_PROMPT}\n\nAdditional requirement: ${opts.prompt.trim().slice(0, 600)}`
    : OPENAI_RESHOOT_PROMPT;
  const result = await client.images.edit({
    model,
    image: await toFile(image, "product.png", { type: "image/png" }),
    prompt,
    n: 1,
    size: sizeFor(opts.ratio) as "1024x1024" | "1024x1536" | "1536x1024",
    quality: opts.quality === "quality" ? "high" : "medium",
  });
  const first = result.data?.[0];
  if (!first) throw new Error("AI 服务未返回图片");
  return dataUrlFromOpenAIImage(first);
}

function response(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}

export async function GET() {
  const [openai, cloudflare] = await Promise.all([
    getOpenAISettings(),
    getCloudflareAISettings(),
  ]);
  return response({
    ready: !!openai.apiKey.trim() || (cloudflare.ready && await cloudflareAvailable()),
    openai: !!openai.apiKey.trim(),
    cloudflare: cloudflare.ready && await cloudflareAvailable(),
  });
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
    const bytes = Buffer.from(await image.arrayBuffer());
    const openaiResult = await reshootWithOpenAI({
      bytes,
      ratio,
      prompt,
      quality,
    });
    if (openaiResult) return response({ ok: true, image: openaiResult });

    const settings = await getCloudflareAISettings();
    const result = await reshootProductWithCloudflare({
      bytes,
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

