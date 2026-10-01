import { NextResponse } from "next/server";
import OpenAI, { toFile } from "openai";
import {
  dbEnabled,
  reserveCredits,
  refundCredits,
  addArtworks,
  getUser,
  isBanned,
  addLedgerEntry,
  addReservation,
  settleReservation,
  sweepStaleReservations,
} from "@/lib/db";
import { clientIp } from "@/lib/ip";
import { rateLimit } from "@/lib/rate-limit";
import { resolveUserIdentity } from "@/lib/admin-auth";
import { storageEnabled, uploadImage } from "@/lib/storage";
import { getOpenAISettings } from "@/lib/settings";
import { getOpenAIBaseUrl } from "@/lib/openai-base";
import { TOOL_COST } from "@/lib/mock-data";
import { getTryonLibrary } from "@/lib/tryon-store";
import { safeError } from "@/lib/api-error";
import {
  canReadJob,
  createJobAccess,
  createJobId,
  jobPollCookieName,
  type JobAccess,
} from "@/lib/job-access";

// ---------------------------------------------------------------------------
// 服装上身(虚拟试穿)端点。
//
// gpt-image 多图合成:衣服图(必填) + 模特图(库选,可选) + 场景图(库选,可选)
// → 一张真实电商试穿成片。保留服装设计/颜色/版型,保留模特身份,置于场景中。
// 落库 category="tryon"。计费同生图(6)。
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const maxDuration = 240;

const TRYON_COST = TOOL_COST.tryon;

type TryonInput = {
  top: Buffer | null; // 上装(可选)
  bottom: Buffer | null; // 下装(可选)
  garments: Buffer[]; // 服装工作台可上传同一服装的多角度/细节图
  references: Buffer[]; // 用户上传的模特/场景参考图
  mode: "tryon" | "catalog" | "lifestyle";
  studio: boolean;
  modelId: string;
  modelUrl: string; // 自定义人物图 url(「以此图再试穿」用,不在库里时直接给 url)
  sceneId: string;
  prompt: string;
  email: string;
  ratio: string;
  resolution: string;
  expert: boolean;
  customModule: boolean;
  modulePlan: string;
};

async function parseInput(request: Request): Promise<TryonInput | null> {
  const ct = request.headers.get("content-type") ?? "";
  if (!ct.includes("multipart/form-data")) return null;
  const f = await request.formData();
  const s = (k: string) => (f.get(k) ?? "").toString();
  const grab = async (k: string) => {
    const file = f.get(k);
    return file instanceof File && file.size > 0
      ? Buffer.from(await file.arrayBuffer())
      : null;
  };
  const grabAll = async (key: string, max: number) => {
    const out: Buffer[] = [];
    for (const value of f.getAll(key)) {
      if (value instanceof File && value.size > 0) {
        out.push(Buffer.from(await value.arrayBuffer()));
        if (out.length >= max) break;
      }
    }
    return out;
  };
  const rawMode = s("mode").trim();
  const mode: TryonInput["mode"] = rawMode === "catalog" || rawMode === "lifestyle" ? rawMode : "tryon";
  const uploadedGarments = await grabAll("garment", 6);
  // 兼容旧字段 garment(无 mode 时当作上装)。
  const top = (await grab("top")) ?? (!rawMode ? uploadedGarments[0] ?? null : null);
  const bottom = await grab("bottom");
  const garments = rawMode
    ? uploadedGarments.length
      ? uploadedGarments
      : [top, bottom].filter((value): value is Buffer => !!value)
    : [top, bottom].filter((value): value is Buffer => !!value);
  if (!garments.length) return null;
  return {
    top,
    bottom,
    garments,
    references: await grabAll("reference", 2),
    mode,
    studio: !!rawMode,
    modelId: s("modelId").trim(),
    modelUrl: s("modelUrl").trim(),
    sceneId: s("sceneId").trim(),
    prompt: s("prompt").trim(),
    email: s("email").trim(),
    ratio: s("ratio").trim(),
    resolution: s("resolution").trim(),
    expert: s("expert").trim() === "true",
    customModule: s("customModule").trim() === "true",
    modulePlan: s("modulePlan").trim().slice(0, 1200),
  };
}

async function toPng(buf: Buffer): Promise<Buffer> {
  try {
    const sharp = (await import("sharp")).default;
    return await sharp(buf).rotate().png().toBuffer();
  } catch {
    return buf;
  }
}

async function fetchPng(url: string): Promise<Buffer | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const ab = await r.arrayBuffer();
    return await toPng(Buffer.from(ab));
  } catch {
    return null;
  }
}

function outputSize(ratio: string): "1024x1024" | "1024x1536" | "1536x1024" {
  if (ratio === "1:1") return "1024x1024";
  if (ratio === "4:3" || ratio === "16:9") return "1536x1024";
  return "1024x1536";
}

// ---------------------------------------------------------------------------
// 异步任务(单 pm2 fork 内存)。POST 立即返回 jobId,后台跑 ~50s 生成,GET 轮询结果。
// 避免代理/CDN 对长同步请求超时返回空体(客户端报 "Unexpected end of JSON input")。
// 与 /api/generate-image 同款。
// ---------------------------------------------------------------------------
type TryonUser = Awaited<ReturnType<typeof getUser>>;
type Job =
  | { status: "pending"; createdAt: number; access: JobAccess }
  | {
      status: "done";
      createdAt: number;
      access: JobAccess;
      id: string;
      url: string;
      creditsUsed: number;
      user: TryonUser;
    }
  | {
      status: "error";
      createdAt: number;
      access: JobAccess;
      error: string;
    };

const JOBS = new Map<string, Job>();
const JOB_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Authorization, X-API-Key, Cookie",
};

function jobResponse(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: JOB_HEADERS });
}

function missingJobResponse() {
  return jobResponse(
    { status: "error", error: "任务不存在、已过期或无权访问" },
    404
  );
}

function sweepJobs(): void {
  const now = Date.now();
  JOBS.forEach((v, k) => {
    if (now - v.createdAt > 15 * 60_000) JOBS.delete(k);
  });
}

async function runTryonJob(
  jobId: string,
  access: JobAccess,
  input: TryonInput,
  useDb: boolean,
  cost: number,
  apiKey: string,
  genModel: string
): Promise<void> {
  try {
    let out: Buffer;
    // 输入原图存档:优先「人物/模特图」。模特图来自库(已有 R2/托管 URL)→ 直接复用,不重传;
    // 未选模特时退回用户上传的上装(top)作为原图。两者都在内层 try 里赋值,供落库 source 用。
    let modelUrl: string | null = null; // 模特库图现成 URL(可直接当 source)
    let personBytes: Buffer | null = null; // 模特图字节(库图取回时填,作备用)
    try {
      const client = new OpenAI({
        apiKey,
        baseURL: (await getOpenAIBaseUrl()) || undefined,
        timeout: 230_000,
        maxRetries: 0,
      });

      const lib = await getTryonLibrary();
      // 人物/模特图:优先库选(modelId);否则「以此图再试穿」传来的自定义 url(仅允许 http/https)。
      const customPersonUrl =
        input.modelUrl && /^https?:\/\//i.test(input.modelUrl)
          ? input.modelUrl
          : "";
      const model = input.modelId
        ? lib.models.find((x) => x.id === input.modelId)
        : customPersonUrl
          ? { url: customPersonUrl }
          : undefined;
      const scene = input.sceneId
        ? lib.scenes.find((x) => x.id === input.sceneId)
        : undefined;

      // 组装参考图序列:全部服装角度/细节 → 用户参考图 → 库模特 → 库场景。
      const files: Awaited<ReturnType<typeof toFile>>[] = [];
      const roles: string[] = [];
      let idx = 1;
      for (let garmentIndex = 0; garmentIndex < input.garments.length; garmentIndex++) {
        const garment = input.garments[garmentIndex];
        files.push(await toFile(await toPng(garment), `garment-${garmentIndex + 1}.png`, { type: "image/png" }));
        const legacyRole = !input.studio && garmentIndex === 0 && input.top
          ? "the TOP garment"
          : !input.studio && garmentIndex === 1 && input.bottom
            ? "the BOTTOM garment"
            : `reference view ${garmentIndex + 1} of the same garment/product`;
        roles.push(`Image ${idx} is ${legacyRole}. Preserve every visible clothing detail consistently.`);
        idx++;
      }

      for (let referenceIndex = 0; referenceIndex < input.references.length; referenceIndex++) {
        const reference = input.references[referenceIndex];
        files.push(await toFile(await toPng(reference), `reference-${referenceIndex + 1}.png`, { type: "image/png" }));
        roles.push(
          `Image ${idx} is a user-provided model or scene reference. If it contains a person, preserve that person's identity, face, body type and skin tone; if it contains an environment, use its setting, composition and lighting.`
        );
        if (referenceIndex === 0) personBytes = reference;
        idx++;
      }

      if (model) {
        modelUrl = model.url || null; // 库图已托管,落库 source 直接复用
        const mp = await fetchPng(model.url);
        if (mp) {
          personBytes = mp;
          files.push(await toFile(mp, "model.png", { type: "image/png" }));
          roles.push(
            `Image ${idx} is the human model — keep this exact person's face, identity, body type and skin tone.`
          );
          idx++;
        }
      }
      if (scene) {
        const sp = await fetchPng(scene.url);
        if (sp) {
          files.push(await toFile(sp, "scene.png", { type: "image/png" }));
          roles.push(
            `Image ${idx} is the scene / background & styling reference — place the model in this environment, pose and lighting mood.`
          );
          idx++;
        }
      }

      const modeInstruction = input.mode === "catalog"
        ? "Create ONE clean, product-first studio catalog fashion image with a neutral e-commerce background and a clear view of the garment."
        : input.mode === "lifestyle"
          ? "Create ONE photorealistic lifestyle fashion image of a model naturally wearing the garment in a convincing commercial scene."
          : "Create ONE single photorealistic full-body e-commerce fashion photo of a model naturally wearing the provided garment.";
      const prompt =
        `${modeInstruction} ` +
        roles.join(" ") +
        ` All garment images may show different views of the same item. Faithfully preserve its exact design, colour, pattern, prints, text, fabric, cut and construction — it must look identical across views, with realistic drape, wrinkles and shadows. ` +
        (!input.studio && input.top && !input.bottom
          ? `Pair the top with simple, neutral, well-matched bottoms. `
          : !input.studio && !input.top && input.bottom
            ? `Pair the bottom with a simple, neutral, well-matched top. `
            : ``) +
        (model || input.references.length
          ? `Preserve the referenced model identity when a person is supplied. `
          : `Use a suitable good-looking model. `) +
        (scene || input.references.length > 1 || input.mode === "lifestyle"
          ? `Compose the model into the reference scene with matching background and lighting. `
          : `Use a clean, flattering studio or lifestyle background. `) +
        `Natural pose, realistic proportions, high quality, sharp, no text, no watermark, no border.` +
        (input.customModule && input.modulePlan ? ` Required shot/module: ${input.modulePlan}.` : "") +
        (input.expert ? ` Carefully reconcile all reference views before rendering; do not invent garment features that are not visible.` : "") +
        (input.prompt ? ` Extra requirements: ${input.prompt}` : "");

      const r = await client.images.edit({
        model: genModel || "gpt-image-2",
        image: files,
        prompt,
        n: 1,
        size: outputSize(input.ratio),
        quality: "high" as "high",
      });
      const b64 = r.data?.[0]?.b64_json;
      if (!b64) throw new Error("未返回试穿图");
      out = Buffer.from(b64, "base64");
    } catch (e) {
      throw e;
    }

    const id = `try-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
    let url = `data:image/png;base64,${out.toString("base64")}`;
    if (storageEnabled) {
      try {
        url = await uploadImage(new Uint8Array(out), "image/png", `tryons/${id}.png`);
      } catch (e) {
        console.error(
          "[tryon] R2 upload failed, returning inline:",
          e instanceof Error ? e.message : e
        );
      }
    }

    // 输入原图也存一份(供作品记录「原图 / 成品对比」;失败不阻断主流程)。
    // 优先用人物/模特图:库图已有现成 URL → 直接复用;否则退回上传参考或服装图。
    let srcUrl: string | null = modelUrl;
    if (storageEnabled && !srcUrl) {
      const srcBytes = personBytes ?? input.top ?? input.garments[0];
      if (srcBytes) {
        try {
          srcUrl = await uploadImage(
            new Uint8Array(srcBytes),
            "image/png",
            `tryons/src-${id}.png`
          );
        } catch {
          /* 原图存档失败,忽略 */
        }
      }
    }

    let user: TryonUser = null;
    if (useDb) {
      try {
        await addArtworks(
          input.email,
          [
            {
              id,
              title: input.mode === "catalog" ? "服装基础套图" : input.mode === "lifestyle" ? "服装场景穿搭" : "服装上身",
              category: "tryon",
              prompt: input.prompt || "服装上身",
              status: "completed",
              image: url,
              gradient: "from-violet-100 to-slate-100",
              style: null,
              ratio: input.ratio || "2:3",
              resolution: outputSize(input.ratio).replace("x", "×"),
              source: srcUrl,
              parentId: null,
              parentIds: [],
            },
          ],
          `try-${Date.now()}`
        );
      } catch (e) {
        console.error(
          "[tryon] addArtworks failed:",
          e instanceof Error ? e.message : e
        );
      }
      if (cost > 0)
        await addLedgerEntry(input.email, -cost, "服装上身").catch(() => {});
      user = await getUser(input.email).catch(() => null);
    }

    if (useDb) await settleReservation(jobId).catch(() => {});
    JOBS.set(jobId, {
      status: "done",
      createdAt: Date.now(),
      access,
      id,
      url,
      creditsUsed: useDb ? cost : 0,
      user,
    });
  } catch (e) {
    if (useDb) {
      // 退款失败时保留 reservation，交给 stale sweep 重试，避免占位丢失。
      try {
        await refundCredits(input.email, cost);
        await settleReservation(jobId);
      } catch {
        /* stale-reservation sweep will retry */
      }
    }
    JOBS.set(jobId, {
      status: "error",
      createdAt: Date.now(),
      access,
      error: safeError(e, "服装上身服务暂时不可用,请稍后重试"),
    });
  }
}

export async function POST(request: Request) {
  let input: TryonInput | null;
  try {
    input = await parseInput(request);
  } catch {
    return NextResponse.json({ error: "请求格式不正确" }, { status: 400 });
  }
  if (!input) return NextResponse.json({ error: "缺少服装图片" }, { status: 400 });
  if ([...input.garments, ...input.references].some((image) => image.length > 12 * 1024 * 1024)) {
    return NextResponse.json({ error: "图片过大(请 < 12MB)" }, { status: 400 });
  }

  try {
    const { apiKey, model: genModel } = await getOpenAISettings();
    if (!apiKey.trim()) {
      return NextResponse.json(
        { error: "服装生成服务未配置，请先在后台配置 OpenAI API Key" },
        { status: 503 }
      );
    }
    const ip = clientIp(request);
    if (!rateLimit(`tryon:${ip}`, 30, 600_000)) {
      return NextResponse.json({ error: "请求过于频繁,请稍后再试" }, { status: 429 });
    }

    const identity = await resolveUserIdentity(request);
    if (dbEnabled) {
      if (!identity)
        return NextResponse.json({ error: "请先登录后再操作" }, { status: 401 });
      input.email = identity.email;
    } else if (identity) {
      input.email = identity.email;
    }
    const useDb = dbEnabled && input.email.length > 0;
    const cost = TRYON_COST;

    if (dbEnabled && (await isBanned(input.email, ip)))
      return NextResponse.json({ error: "账号或 IP 已被封禁" }, { status: 403 });

    if (useDb && cost > 0) {
      const ok = await reserveCredits(input.email, cost);
      if (!ok)
        return NextResponse.json(
          { error: "积分不足,请充值后重试" },
          { status: 402 }
        );
    }

    sweepJobs();
    const jobId = createJobId("tryjob");
    const { access, pollCookieSecret } = createJobAccess(
      identity?.email ?? null,
      identity?.kind !== "apiKey"
    );
    JOBS.set(jobId, { status: "pending", access, createdAt: Date.now() });
    if (useDb) {
      try {
        await addReservation(jobId, input.email, cost);
      } catch (error) {
        JOBS.delete(jobId);
        await refundCredits(input.email, cost).catch(() => {});
        throw error;
      }
    }
    void sweepStaleReservations().catch(() => {});
    // 后台跑(不 await):POST 立即返回 → 代理不会因长请求被切断。
    void runTryonJob(jobId, access, input, useDb, cost, apiKey, genModel);
    const response = jobResponse({ jobId });
    if (pollCookieSecret) {
      response.cookies.set(jobPollCookieName("tryon", jobId), pollCookieSecret, {
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.NODE_ENV === "production",
        maxAge: 15 * 60,
        path: "/api/tryon",
      });
    }
    return response;
  } catch (e) {
    return NextResponse.json(
      { error: safeError(e, "服装上身服务暂时不可用,请稍后重试") },
      { status: 500 }
    );
  }
}

// 轮询任务结果。
export async function GET(request: Request) {
  const jobId = new URL(request.url).searchParams.get("job");
  if (!jobId) return NextResponse.json({ status: "ok" });
  const job = JOBS.get(jobId);
  if (!job || !(await canReadJob(request, "tryon", jobId, job.access)))
    return missingJobResponse();
  if (job.status === "done")
    return jobResponse({
      status: "done",
      ok: true,
      id: job.id,
      url: job.url,
      creditsUsed: job.creditsUsed,
      user: job.user,
    });
  if (job.status === "error")
    return jobResponse({ status: "error", error: job.error });
  return jobResponse({ status: "pending" });
}
