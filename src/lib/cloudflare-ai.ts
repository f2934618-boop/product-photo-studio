import "server-only";
import { createHash } from "crypto";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import { MEDIA_DIR } from "@/lib/storage";
import sharp from "sharp";
import {
  CLOUDFLARE_AI_MODELS,
  type CloudflareAISettings,
} from "@/lib/settings";

const CLOUDFLARE_API_ROOT = "https://api.cloudflare.com/client/v4/accounts";
const MAX_REFERENCE_EDGE = 511;

const OUTPUT_SIZES: Record<string, { width: number; height: number }> = {
  "1:1": { width: 1024, height: 1024 },
  "3:4": { width: 768, height: 1024 },
  "4:3": { width: 1024, height: 768 },
  "9:16": { width: 576, height: 1024 },
  "16:9": { width: 1024, height: 576 },
};

const PRODUCT_RESHOOT_PROMPT = `Use input image 0 as the sole product reference. Create a premium e-commerce studio product photo.

Preserve the product identity, camera viewpoint, geometry, proportions, number and arrangement of boxes, packaging colors, ribbon shape and placement, and every visible packaging detail. Keep all visible Chinese text, logos, illustrations and printed patterns as faithful to the reference as possible. Remove only the hand or glove and the outdoor or street background. If the hand hides a small part of the package, reconstruct only the natural continuation of that package surface.

Place the complete product centered on a seamless pure white (#FFFFFF) studio background. Add a subtle, realistic contact shadow directly beneath the product, with balanced commercial lighting, crisp edges and realistic materials. Do not add, remove, redesign, translate or replace packaging elements. No props, no extra objects, no border, no watermark.`;

export class CloudflareAIRequestError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "CloudflareAIRequestError";
  }
}

function outputSize(ratio: string) {
  return OUTPUT_SIZES[ratio] || OUTPUT_SIZES["1:1"];
}

function buildPrompt(extra: string) {
  const preference = extra.trim().slice(0, 500);
  return preference
    ? `${PRODUCT_RESHOOT_PROMPT}\n\nAdditional styling preference, while all preservation rules above remain mandatory: ${preference}`
    : PRODUCT_RESHOOT_PROMPT;
}

function reproducibleSeed(opts: {
  bytes: Buffer;
  ratio: string;
  prompt: string;
  model: string;
}) {
  // The same source image + settings should lead to the same model seed. This
  // keeps retries and duplicate uploads stable while still separating changes
  // to the prompt, ratio, or model.
  const digest = createHash("sha256")
    .update(opts.bytes)
    .update("\0")
    .update(opts.ratio)
    .update("\0")
    .update(opts.prompt)
    .update("\0")
    .update(opts.model)
    .digest();
  return digest.readUInt32BE(0) % 2_000_000_000;
}

async function prepareReference(bytes: Buffer) {
  // Cloudflare's FLUX.2 reference contract requires every input image to be
  // smaller than 512×512. Rotate from EXIF first and preserve as much small
  // packaging text as possible with a lossless PNG reference.
  return sharp(bytes)
    .rotate()
    .resize({
      width: MAX_REFERENCE_EDGE,
      height: MAX_REFERENCE_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .png({ compressionLevel: 6 })
    .toBuffer();
}

function base64FromEnvelope(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as {
    image?: unknown;
    result?: unknown;
  };
  if (typeof root.image === "string") return root.image;
  if (typeof root.result === "string") return root.result;
  if (root.result && typeof root.result === "object") {
    const image = (root.result as { image?: unknown }).image;
    if (typeof image === "string") return image;
  }
  return null;
}

async function asDataUrl(response: Response, whiteBackground: boolean): Promise<string> {
  const contentType = response.headers.get("content-type") || "";
  let output: Buffer;
  let declaredMime = "";

  if (contentType.startsWith("image/")) {
    output = Buffer.from(await response.arrayBuffer());
    declaredMime = contentType.split(";")[0];
  } else {
    const payload = (await response.json()) as unknown;
    const encoded = base64FromEnvelope(payload);
    if (!encoded) throw new Error("高质量生成服务未返回图片");
    const match = encoded.match(
      /^data:(image\/[\w.+-]+);base64,([\s\S]+)$/
    );
    declaredMime = match?.[1] || "";
    output = Buffer.from(match?.[2] || encoded, "base64");
  }

  if (!output.length) throw new Error("高质量生成服务返回了空图片");
  const metadata = await sharp(output).metadata();
  const detectedMime =
    metadata.format === "png"
      ? "image/png"
      : metadata.format === "webp"
        ? "image/webp"
        : metadata.format === "jpeg"
          ? "image/jpeg"
          : "";
  const mime = detectedMime || declaredMime;
  if (!mime.startsWith("image/")) {
    throw new Error("高质量生成服务返回了无效图片");
  }
  // 生成模型偶尔会把白底输出成 251–254 的近白色。将几乎无色的高亮背景
  // 归一为纯白，保留商品颜色、纹理与阴影，同时满足电商白底图要求。
  const { data, info } = await sharp(output)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let index = 0; index < data.length; index += info.channels) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const alpha = data[index + 3];
    const highest = Math.max(red, green, blue);
    const lowest = Math.min(red, green, blue);
    if (whiteBackground && alpha >= 250 && lowest >= 245 && highest - lowest <= 12) {
      data[index] = 255;
      data[index + 1] = 255;
      data[index + 2] = 255;
    }
  }

  // 下载文件统一使用 .png；这里也统一编码，避免 WebP/JPEG 内容被保存成
  // PNG 扩展名后在部分图片工具中打不开。
  const png = await sharp(data, {
    raw: { width: info.width, height: info.height, channels: info.channels },
  })
    .png({ compressionLevel: 7 })
    .toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

export async function reshootProductWithCloudflare(opts: {
  bytes: Buffer;
  ratio: string;
  prompt?: string;
  quality?: "standard" | "quality";
  settings: CloudflareAISettings;
}): Promise<string> {
  return generateWithCloudflare({
    images: [opts.bytes],
    ratio: opts.ratio,
    prompt: buildPrompt(opts.prompt || ""),
    quality: opts.quality,
    settings: opts.settings,
    whiteBackground: true,
  });
}

const CACHE_DIR = path.join(MEDIA_DIR, ".ai-cache");
const inflight = new Map<string, Promise<string>>();
let active = false;
const waiting: Array<() => void> = [];

async function acquire() {
  if (!active) { active = true; return; }
  await new Promise<void>((resolve) => waiting.push(resolve));
}
function release() {
  const next = waiting.shift();
  if (next) next(); else active = false;
}

const UNAVAILABLE = "AI 服务暂时不可用，请稍后重试；快速抠图仍可使用。";

export async function cloudflareAvailable() {
  const blocked = Number(await readFile(path.join(CACHE_DIR, "unavailable-until"), "utf8").catch(() => "0"));
  return blocked <= Date.now();
}

// Saved under the mounted volume, so deploys and duplicate requests do not
// discard successful results or spend another model call for the same inputs.
export async function generateWithCloudflare(opts: {
  images: Buffer[];
  ratio: string;
  prompt: string;
  quality?: "standard" | "quality";
  settings: CloudflareAISettings;
  whiteBackground?: boolean;
  variant?: number;
}): Promise<string> {
  const { settings } = opts;
  if (!settings.ready) {
    throw new CloudflareAIRequestError(
      "AI 服务暂时不可用，请联系网站维护者",
      503
    );
  }
  if (!/^[a-fA-F0-9]{32}$/.test(settings.accountId)) {
    throw new CloudflareAIRequestError(
      "高质量商品重拍服务配置无效，请联系管理员",
      503
    );
  }
  const model =
    opts.quality === "quality"
      ? "@cf/black-forest-labs/flux-2-klein-9b"
      : settings.model;
  if (!(CLOUDFLARE_AI_MODELS as readonly string[]).includes(model)) {
    throw new CloudflareAIRequestError(
      "高质量商品重拍模型配置无效，请联系管理员",
      503
    );
  }

  if (opts.images.length > 4) {
    throw new CloudflareAIRequestError("一次最多使用 4 张产品与参考图片", 400);
  }
  const hash = createHash("sha256")
    .update("image-v2\0" + settings.accountId + "\0" + model + "\0" + opts.ratio)
    .update("\0" + opts.prompt + "\0" + String(opts.variant || 0) + "\0" + String(!!opts.whiteBackground));
  for (const bytes of opts.images) hash.update("\0" + bytes.length + "\0").update(bytes);
  const key = hash.digest("hex");
  const filename = path.join(CACHE_DIR, `${key}.png`);
  try {
    const saved = await readFile(filename);
    return `data:image/png;base64,${saved.toString("base64")}`;
  } catch { /* cache miss */ }
  const existing = inflight.get(key);
  if (existing) return existing;
  const task = (async () => {
    await acquire();
    try {
      const blocked = Number(await readFile(path.join(CACHE_DIR, "unavailable-until"), "utf8").catch(() => "0"));
      if (blocked > Date.now()) throw new CloudflareAIRequestError(UNAVAILABLE, 503);
      const image = await requestCloudflareImage(opts, model, key);
      const png = Buffer.from(image.split(",")[1], "base64");
      await mkdir(CACHE_DIR, { recursive: true });
      const temporary = `${filename}.tmp`;
      await writeFile(temporary, png);
      await rename(temporary, filename);
      return image;
    } finally { release(); }
  })();
  inflight.set(key, task);
  try { return await task; } finally { inflight.delete(key); }
}

async function requestCloudflareImage(
  opts: Parameters<typeof generateWithCloudflare>[0],
  model: string,
  key: string
) {
  const { settings } = opts;
  const size = outputSize(opts.ratio);
  const form = new FormData();
  form.append("prompt", opts.prompt);
  for (let index = 0; index < opts.images.length; index++) {
    const reference = await prepareReference(opts.images[index]);
    form.append(`input_image_${index}`, new Blob([Uint8Array.from(reference).buffer], { type: "image/png" }), `reference-${index}.png`);
  }
  form.append("width", String(size.width));
  form.append("height", String(size.height));
  form.append("seed", String(parseInt(key.slice(0, 8), 16) % 2_000_000_000));

  const endpoint = `${CLOUDFLARE_API_ROOT}/${encodeURIComponent(
    settings.accountId
  )}/ai/run/${model}`;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${settings.apiToken}` },
      // Do not set Content-Type manually: fetch must include FormData's boundary.
      body: form,
      cache: "no-store",
      signal: AbortSignal.timeout(110_000),
    });
  } catch (error) {
    console.error(
      "[cloudflare-ai] request failed:",
      error instanceof Error ? error.message : error
    );
    throw new CloudflareAIRequestError("高质量生成服务连接失败，请稍后重试", 502);
  }

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 800);
    console.error(`[cloudflare-ai] upstream ${response.status}: ${detail}`);
    if (response.status === 401 || response.status === 403) {
      throw new CloudflareAIRequestError(
        "高质量商品重拍服务配置无效，请联系管理员",
        503
      );
    }
    if (response.status === 429) {
      // Daily allocation exhaustion is different from a transient rate limit.
      // Stop queued calls until the provider's next UTC reset, without retrying
      // every image in a batch. Transient throttling has only a short cooldown.
      const dailyLimit = /4006|daily free allocation|10,000 neurons/i.test(detail);
      const until = dailyLimit
        ? Math.floor(Date.now() / 86_400_000) * 86_400_000 + 86_400_000
        : Date.now() + 60_000;
      await mkdir(CACHE_DIR, { recursive: true });
      await writeFile(path.join(CACHE_DIR, "unavailable-until"), String(until));
      throw new CloudflareAIRequestError(UNAVAILABLE, 503);
    }
    throw new CloudflareAIRequestError("高质量生成失败，请稍后重试", 502);
  }

  try {
    return await asDataUrl(response, !!opts.whiteBackground);
  } catch (error) {
    console.error(
      "[cloudflare-ai] invalid output:",
      error instanceof Error ? error.message : error
    );
    throw new CloudflareAIRequestError("高质量生成结果无效，请稍后重试", 502);
  }
}

