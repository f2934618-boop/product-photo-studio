import "server-only";
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

async function asDataUrl(response: Response): Promise<string> {
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
  // 下载文件统一使用 .png；这里也统一编码，避免 WebP/JPEG 内容被保存成
  // PNG 扩展名后在部分图片工具中打不开。
  const png = await sharp(output).png({ compressionLevel: 7 }).toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

export async function reshootProductWithCloudflare(opts: {
  bytes: Buffer;
  ratio: string;
  prompt?: string;
  quality?: "standard" | "quality";
  settings: CloudflareAISettings;
}): Promise<string> {
  const { settings } = opts;
  if (!settings.ready) {
    throw new CloudflareAIRequestError(
      "高质量商品重拍服务尚未配置，请联系管理员",
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

  const reference = await prepareReference(opts.bytes);
  const referenceBytes = Uint8Array.from(reference).buffer;
  const size = outputSize(opts.ratio);
  const form = new FormData();
  form.append("prompt", buildPrompt(opts.prompt || ""));
  form.append(
    "input_image_0",
    new Blob([referenceBytes], { type: "image/png" }),
    "product-reference.png"
  );
  form.append("width", String(size.width));
  form.append("height", String(size.height));

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
      throw new CloudflareAIRequestError(
        "高质量生成额度暂时已用完，请稍后再试",
        429
      );
    }
    throw new CloudflareAIRequestError("高质量生成失败，请稍后重试", 502);
  }

  try {
    return await asDataUrl(response);
  } catch (error) {
    console.error(
      "[cloudflare-ai] invalid output:",
      error instanceof Error ? error.message : error
    );
    throw new CloudflareAIRequestError("高质量生成结果无效，请稍后重试", 502);
  }
}

