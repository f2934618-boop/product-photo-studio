import { NextResponse } from "next/server";
import { clientIp } from "@/lib/ip";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 30;

type VideoModel = "seedance" | "kling";
type PredictionStatus =
  | "starting"
  | "processing"
  | "succeeded"
  | "failed"
  | "canceled";

type ReplicatePrediction = {
  id?: string;
  status?: PredictionStatus;
  output?: unknown;
  error?: unknown;
  detail?: unknown;
  urls?: { get?: string };
};

type OwnedPrediction = {
  getUrl: string;
  pollToken: string;
  createdAt: number;
};

// This deliberately stays process-local: only predictions created by this API
// can be polled. Multi-instance/serverless deployments need a shared store.
const ownedPredictions = new Map<string, OwnedPrediction>();
const PREDICTION_TTL_MS = 60 * 60 * 1000;

function cleanupPredictions() {
  const cutoff = Date.now() - PREDICTION_TTL_MS;
  for (const [id, prediction] of ownedPredictions) {
    if (prediction.createdAt < cutoff) ownedPredictions.delete(id);
  }
}

function message(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim().slice(0, 500);
  if (value && typeof value === "object" && "message" in value) {
    const nested = (value as { message?: unknown }).message;
    if (typeof nested === "string" && nested.trim()) return nested.trim().slice(0, 500);
  }
  return null;
}

function outputUrl(output: unknown, depth = 0): string | null {
  if (depth > 2) return null;
  if (Array.isArray(output)) {
    for (const item of output) {
      const found = outputUrl(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (output && typeof output === "object") {
    const record = output as Record<string, unknown>;
    for (const key of ["url", "video", "output"]) {
      const found = outputUrl(record[key], depth + 1);
      if (found) return found;
    }
    return null;
  }
  const candidate = output;
  if (typeof candidate !== "string") return null;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function publicPrediction(prediction: ReplicatePrediction) {
  const status = prediction.status ?? "processing";
  return {
    id: prediction.id,
    status,
    url: status === "succeeded" ? outputUrl(prediction.output) : null,
    error:
      status === "failed" || status === "canceled"
        ? message(prediction.error) || "视频生成失败，请调整描述后重试"
        : null,
  };
}

async function parseCreateRequest(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    throw new Error("请求格式不正确");
  }
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength > 14 * 1024 * 1024) throw new Error("图片过大，请上传 12MB 以内图片");

  const form = await request.formData();
  const text = (key: string) => (form.get(key) ?? "").toString().trim();
  const rawModel = text("model");
  if (rawModel === "veo") throw new Error("Veo 3 尚未接入，请选择 Seedance 或 Kling");
  if (rawModel !== "seedance" && rawModel !== "kling") throw new Error("不支持的视频模型");
  const model: VideoModel = rawModel;

  const prompt = text("prompt");
  if (!prompt) throw new Error("请先填写视频脚本");
  if (prompt.length > 4000) throw new Error("视频脚本不能超过 4000 字");

  const aspectRatio = text("aspectRatio");
  if (!["9:16", "1:1", "16:9"].includes(aspectRatio)) throw new Error("画面比例不支持");
  const duration = Number(text("duration"));
  if (!Number.isInteger(duration)) throw new Error("视频时长不正确");
  if (model === "seedance" && (duration < 2 || duration > 12)) {
    throw new Error("Seedance 支持 2–12 秒视频");
  }
  if (model === "kling" && duration !== 5 && duration !== 10) {
    throw new Error("Kling 仅支持 5 秒或 10 秒视频");
  }

  const rawResolution = text("resolution").toLowerCase();
  const resolution = rawResolution === "720p" ? "720p" : "1080p";
  const image = form.get("image");
  let dataUrl: string | undefined;
  if (image instanceof File && image.size > 0) {
    if (!image.type.startsWith("image/")) throw new Error("起始素材必须是图片");
    if (image.size > 12 * 1024 * 1024) throw new Error("图片过大，请上传 12MB 以内图片");
    const bytes = Buffer.from(await image.arrayBuffer());
    dataUrl = `data:${image.type || "image/png"};base64,${bytes.toString("base64")}`;
  }

  const generateAudio = text("generateAudio") === "1";
  return { model, prompt, aspectRatio, duration, resolution, dataUrl, generateAudio };
}

export async function POST(request: Request) {
  const token = process.env.REPLICATE_API_TOKEN?.trim();
  // Check configuration before creating any prediction or charging anything.
  if (!token) {
    return NextResponse.json({ error: "视频生成服务暂未配置 REPLICATE_API_TOKEN" }, { status: 503 });
  }

  const ip = clientIp(request);
  if (!rateLimit(`video:create:${ip}`, 12, 600_000)) {
    return NextResponse.json({ error: "生成过于频繁，请稍后再试" }, { status: 429 });
  }

  let input: Awaited<ReturnType<typeof parseCreateRequest>>;
  try {
    input = await parseCreateRequest(request);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "请求格式不正确" },
      { status: 400 }
    );
  }

  const slug = input.model === "seedance"
    ? "bytedance/seedance-1.5-pro"
    : "kwaivgi/kling-v2.1-master";
  const modelInput = input.model === "seedance"
    ? {
        prompt: input.prompt,
        ...(input.dataUrl ? { image: input.dataUrl } : {}),
        duration: input.duration,
        resolution: input.resolution,
        aspect_ratio: input.aspectRatio,
        generate_audio: input.generateAudio,
      }
    : {
        prompt: input.prompt,
        ...(input.dataUrl ? { start_image: input.dataUrl } : {}),
        duration: input.duration,
        aspect_ratio: input.aspectRatio,
      };

  try {
    const response = await fetch(`https://api.replicate.com/v1/models/${slug}/predictions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Cancel-After": "10m",
      },
      body: JSON.stringify({ input: modelInput }),
      cache: "no-store",
    });
    const prediction = (await response.json().catch(() => ({}))) as ReplicatePrediction;
    if (!response.ok) {
      throw new Error(message(prediction.detail) || message(prediction.error) || `Replicate 请求失败 (${response.status})`);
    }
    if (!prediction.id || !prediction.urls?.get) throw new Error("视频服务未返回任务编号");
    const getUrl = new URL(prediction.urls.get);
    if (getUrl.protocol !== "https:" || getUrl.hostname !== "api.replicate.com") {
      throw new Error("视频服务返回了无效任务地址");
    }

    cleanupPredictions();
    const pollToken = crypto.randomUUID();
    ownedPredictions.set(prediction.id, {
      getUrl: getUrl.toString(),
      pollToken,
      createdAt: Date.now(),
    });
    return NextResponse.json({ ...publicPrediction(prediction), pollToken });
  } catch (error) {
    console.error("[video] create failed:", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "视频生成服务暂时不可用" },
      { status: 502 }
    );
  }
}

export async function GET(request: Request) {
  const token = process.env.REPLICATE_API_TOKEN?.trim();
  if (!token) {
    return NextResponse.json({ error: "视频生成服务暂未配置 REPLICATE_API_TOKEN" }, { status: 503 });
  }

  cleanupPredictions();
  const url = new URL(request.url);
  const id = url.searchParams.get("id")?.trim() ?? "";
  const pollToken = url.searchParams.get("token")?.trim() ?? "";
  const owned = id ? ownedPredictions.get(id) : undefined;
  if (!owned || !pollToken || pollToken !== owned.pollToken) {
    return NextResponse.json({ error: "任务不存在或已过期" }, { status: 404 });
  }
  const ip = clientIp(request);
  if (!rateLimit(`video:poll:${ip}`, 300, 600_000)) {
    return NextResponse.json({ error: "查询过于频繁，请稍后再试" }, { status: 429 });
  }

  try {
    const response = await fetch(owned.getUrl, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const prediction = (await response.json().catch(() => ({}))) as ReplicatePrediction;
    if (!response.ok) {
      throw new Error(message(prediction.detail) || message(prediction.error) || `任务查询失败 (${response.status})`);
    }
    if (prediction.status === "succeeded" || prediction.status === "failed" || prediction.status === "canceled") {
      ownedPredictions.delete(id);
    }
    return NextResponse.json(publicPrediction({ ...prediction, id }));
  } catch (error) {
    console.error("[video] poll failed:", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "任务查询失败" },
      { status: 502 }
    );
  }
}
