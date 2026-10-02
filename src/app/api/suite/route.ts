import { NextResponse } from "next/server";
import { toVisionDataUrl } from "@/lib/vision-image";
import OpenAI, { toFile } from "openai";
import { POINTS_PER_IMAGE } from "@/lib/mock-data";
import { safeError } from "@/lib/api-error";
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
import { getOpenAISettings, getCloudflareAISettings } from "@/lib/settings";
import { generateWithCloudflare } from "@/lib/cloudflare-ai";
import { FRIENDS_MODE } from "@/lib/friends-mode";
import { getOpenAIBaseUrl } from "@/lib/openai-base";
import { getSuiteSystem, getSuitePlatformHint } from "@/lib/prompt-config";
import {
  canReadJob,
  createJobAccess,
  createJobId,
  jobPollCookieName,
  type JobAccess,
} from "@/lib/job-access";

// ---------------------------------------------------------------------------
// 一键电商套图：上传产品图(+可选文字) → 自动出 1 主图 + 4 副图 + 8 详情页图。
//
// 两层 pipeline：
//   第0层：视觉 LLM(gpt-4o-mini) 读产品图+文字 → 输出 13 张图的定制中文提示词 JSON。
//          旧版直接生成调用在规划失败时回退到蓝图；工作台显式分析会返回真实错误。
//   第1-13层：gpt-image 图生图,每张 = 产品图(参考,保一致) + 该张的定制提示词。
//          并发限流逐张生成,完成一张即落 R2 并更新进度。
// 异步 job + 逐张进度,复用生图的 jobId+轮询模式(CF 免费版 ~100s 硬超时,套图更长)。
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const maxDuration = 300;

type ShotRole = "main" | "sub" | "detail";
type ShotSpec = {
  role: ShotRole;
  label: string;
  ratio: string; // "1:1" | "3:4"
  prompt: string; // 含中文营销文案的完整出图提示词(模型直出整图)
  text?: string; // 该张主标题(展示/归档用)
};
type ShotResult = ShotSpec & {
  id: string;
  status: "pending" | "done" | "error";
  url?: string;
  gradient: string;
};

type SuiteOutputType = "all" | "main" | "detail" | "banner";
type SuiteOptions = {
  outputType: SuiteOutputType;
  expert: boolean;
  customModule: boolean;
  modules: string[];
  count: number;
  ratio: string;
  resolution: string;
};

const CONCURRENCY = 2; // 降并发避免 gpt-image 频率限制导致整片失败
const PER_SHOT_TIMEOUT = 240_000;
const SHOT_RETRIES = 3; // 每张失败后最多再重试 3 次(指数退避,扛住尾部限频)

const GRADIENTS = [
  "from-rose-100 to-slate-100",
  "from-lime-100 to-emerald-100",
  "from-amber-100 to-orange-100",
  "from-sky-100 to-teal-100",
  "from-emerald-100 to-teal-100",
  "from-stone-100 to-amber-100",
];

function normalizeOutputType(value: string): SuiteOutputType {
  const key = value.trim().toLowerCase();
  if (key === "main" || value.includes("主图")) return "main";
  if (key === "detail" || value.includes("详情")) return "detail";
  if (key === "banner" || value.includes("广告")) return "banner";
  return "all";
}

function platformHintKey(platform: string): string {
  const key = platform.trim().toLowerCase();
  if (key.includes("amazon") || platform.includes("亚马逊")) return "amazon";
  if (key.includes("tiktok") || key.includes("shopify") || key.includes("etsy")) return "global";
  if (key.includes("douyin") || platform.includes("抖音")) return "douyin";
  if (key.includes("xiaohongshu") || key.includes("xhs") || platform.includes("小红书")) return "xhs";
  if (key.includes("pdd") || platform.includes("拼多多")) return "pdd";
  return key === "智能匹配" ? "" : key;
}

function roleForOutput(outputType: SuiteOutputType, fallback: ShotRole): ShotRole {
  if (outputType === "main") return "main";
  if (outputType === "detail") return "detail";
  if (outputType === "banner") return "sub";
  return fallback;
}

function planningDirective(options: SuiteOptions, platform: string): string {
  const outputLabel = options.outputType === "main"
    ? "电商主图"
    : options.outputType === "detail"
      ? "详情图"
      : options.outputType === "banner"
        ? "营销广告图"
        : "完整电商套图";
  const moduleText = options.modules.length
    ? `必须覆盖这些用户自定义分镜：${options.modules.join("；")}。`
    : "请根据产品真实特征智能规划分镜。";
  return (
    `【本次工作台参数，优先级最高】目标平台：${platform || "智能匹配"}；输出类型：${outputLabel}；` +
    `输出正好 ${options.count} 张，每张比例 ${options.ratio || "按内容选择"}。${moduleText}` +
    (options.expert
      ? "已开启专家模式：先深入识别品类、真实卖点、材质结构、目标人群与合规边界，再做差异化分镜，避免空泛模板。"
      : "") +
    `JSON 的 shots 必须正好 ${options.count} 个；role 按本次输出类型设置。`
  );
}

// 写死蓝图(LLM 失败时回退)。13 张:1 主图 + 4 副图 + 8 详情。
// 模型直出整图:每张 prompt 直接要求渲染中文营销文案(字体多样精美),不再做代码叠字。
function fallbackBlueprint(extra: string): ShotSpec[] {
  const base = extra ? `产品/品牌补充信息：${extra}。` : "";
  const lead =
    "在完整保留上传产品(包装、品牌、文字、外观)不变的前提下，把它合成进一张专业、可直接上架的中国电商营销视觉，整图(含文字)由你直接渲染：";
  const tail =
    "硬性要求：①画面带中文营销大标题与卖点短语，文字排版精美、富有设计感，字体多样有层次——主标题用有质感的艺术字/书法体/衬线体，卖点/说明用清晰黑体；②搭配与该产品品类相关的道具/配件/场景元素与图标点缀，高级氛围背景，层次分明、留白得当，超清商业细节；③文案要贴合产品本身、不要套用与产品无关的维度；④所有中文必须清晰、准确、无错别字、无乱码。风格参考天猫/京东精品详情页。" +
    base;
  const mk = (
    role: ShotRole,
    label: string,
    ratio: string,
    desc: string,
    title: string,
    points: string
  ): ShotSpec => ({
    role,
    label,
    ratio,
    text: title,
    prompt: `${lead}${desc}。主标题文案『${title}』，配套卖点文案『${points}』。${tail}`,
  });
  // 通用兜底(品类无关)。仅在 AI 规划失败时启用;角度与文案保持中性,适配任意产品。
  return [
    mk("main", "营销主图", "1:1", "产品作为画面主体居中，四周搭配与该品类相关的道具/配件点缀，高级渐变氛围背景，顶部放主标题、四周放卖点", "匠心之选", "品质保障·值得信赖"),
    mk("sub", "核心卖点", "1:1", "产品居中，突出该产品最核心的卖点/功能优势，商业海报式背景，配卖点排版", "核心卖点", "实力优势·品质之选"),
    mk("sub", "细节做工", "1:1", "产品关键细节/做工/质感特写，干净高级背景，配细节标注", "细节品质", "做工精良·细节用心"),
    mk("sub", "场景使用", "1:1", "产品放进真实使用场景，自然生活氛围，体现使用方式", "真实场景", "贴合日常·好用"),
    mk("sub", "信任背书", "1:1", "产品 + 资质/规格/售后等信任元素的视觉表达，专业可信背景", "品质保障", "正品·安心"),
    mk("detail", "品牌主视觉", "3:4", "竖版详情首屏，产品大图 + 品牌氛围背景，顶部主标题大字", "品质之作", "用心之选·品质生活"),
    mk("detail", "核心卖点", "3:4", "竖版详情图，聚焦该产品最核心的卖点，大标题与说明排版", "核心优势", "实力·品质"),
    mk("detail", "细节特写", "3:4", "竖版详情图，关键细节/做工/质感的高清特写，配细节说明", "细节之处", "精工·讲究"),
    mk("detail", "材质工艺", "3:4", "竖版详情图，体现产品材质/工艺/品质把控的高级质感画面，配说明", "品质工艺", "用料·考究"),
    mk("detail", "功能演示", "3:4", "竖版详情图，展示该产品的功能/使用/安装方式的图示画面，配步骤文字", "使用方式", "简单·上手"),
    mk("detail", "适用人群", "3:4", "竖版详情图，适用人群/使用场景的生活化画面，配场景文案", "适用人群", "广泛·贴心"),
    mk("detail", "规格包装", "3:4", "竖版详情图，规格参数与包装的简洁展示画面，配参数标注", "规格参数", "标准·规范"),
    mk("detail", "信任售后", "3:4", "竖版详情图，品牌信任/资质/售后的视觉，配背书文案", "正品保障", "认证·售后"),
  ];
}

function normalizeSpec(spec: ShotSpec, options: SuiteOptions, index: number): ShotSpec {
  return {
    role: roleForOutput(options.outputType, spec.role),
    label: (spec.label || `画面 ${index + 1}`).slice(0, 80),
    ratio: options.ratio || spec.ratio || "1:1",
    prompt: spec.prompt.slice(0, 6000),
    text: spec.text?.slice(0, 200),
  };
}

function specsFromModules(
  modules: string[],
  extra: string,
  platform: string,
  options: SuiteOptions
): ShotSpec[] {
  const labels = modules.length
    ? modules.slice(0, options.count)
    : Array.from({ length: options.count }, (_, index) => `商品视觉 ${index + 1}`);
  while (labels.length < options.count) labels.push(`商品视觉 ${labels.length + 1}`);
  return labels.map((label, index) => {
    const role = roleForOutput(options.outputType, options.outputType === "all" ? (index === 0 ? "main" : "detail") : "sub");
    const textRule = options.outputType === "main" && platformHintKey(platform) === "amazon"
      ? "纯白背景，商品居中，不添加文字、水印或道具。"
      : "根据目标平台规范设计清晰、克制且可直接上架的营销画面与文案。";
    return {
      role,
      label,
      ratio: options.ratio || (role === "detail" ? "3:4" : "1:1"),
      text: label,
      prompt:
        `在完整保留上传产品的外观、包装、品牌、文字、结构、材质与颜色不变的前提下，生成「${label}」。` +
        `目标平台：${platform || "智能匹配"}。${textRule}` +
        (extra ? ` 用户补充要求：${extra}。` : "") +
        (options.expert ? " 专家模式：画面必须基于产品真实特征与使用场景，细节准确，避免通用模板与虚构卖点。" : ""),
    };
  });
}

function fallbackForOptions(extra: string, platform: string, options: SuiteOptions): ShotSpec[] {
  if (options.modules.length) return specsFromModules(options.modules, extra, platform, options);
  const all = fallbackBlueprint(extra);
  const matching = options.outputType === "main"
    ? all.filter((shot) => shot.role === "main")
    : options.outputType === "detail"
      ? all.filter((shot) => shot.role === "detail")
      : options.outputType === "banner"
        ? all.filter((shot) => shot.role === "sub")
        : all;
  const source = matching.length ? matching : all;
  return Array.from({ length: options.count }, (_, index) => {
    const base = source[index % source.length];
    const suffix = index >= source.length ? ` ${index + 1}` : "";
    return normalizeSpec({ ...base, label: `${base.label}${suffix}` }, options, index);
  });
}

// 第0层:视觉 LLM 读产品图 → 输出 13 张定制提示词。失败回退蓝图。
async function planShots(
  client: OpenAI,
  firstImage: { buf: Buffer; type: string },
  extra: string,
  platform: string,
  options: SuiteOptions,
  allowFallback = true
): Promise<ShotSpec[]> {
  try {
    const dataUrl = await toVisionDataUrl(firstImage.buf, firstImage.type);
    const base = await getSuiteSystem(); // 后台可编辑的套图规划 system 指令
    const platHint = await getSuitePlatformHint(platformHintKey(platform)); // 平台风格覆盖段(后台可编辑)
    const sys = [base, platHint, planningDirective(options, platform)].filter(Boolean).join("\n\n");
    const user =
      `目标平台：${platform || "智能匹配"}\n` +
      (extra ? `补充信息：${extra}\n` : "") +
      "请先认真分析图片中的真实产品，再按本次工作台参数规划套图。";
    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: sys },
        {
          role: "user",
          content: [
            { type: "text", text: user },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      response_format: { type: "json_object" },
      max_tokens: 3000,
    });
    const raw = resp.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as { shots?: ShotSpec[] };
    const shots = (parsed.shots ?? []).filter(
      (s) => s && s.prompt && s.role && s.ratio
    );
    if (shots.length >= options.count) {
      return shots.slice(0, options.count).map((shot, index) => normalizeSpec(shot, options, index));
    }
    throw new Error(`规划结果数量不足（需要 ${options.count} 张）`);
  } catch (error) {
    if (allowFallback) return fallbackForOptions(extra, platform, options);
    throw error instanceof Error ? error : new Error("产品分析失败");
  }
}

function sizeFor(ratio: string): "1024x1024" | "1024x1536" | "1536x1024" {
  if (ratio === "3:4" || ratio === "9:16") return "1024x1536";
  if (ratio === "4:3" || ratio === "16:9") return "1536x1024";
  return "1024x1024";
}

// 生成一张,返回 PNG buffer。模型直接出整图(含中文文案)。
async function genOneShot(
  client: OpenAI,
  model: string,
  spec: ShotSpec,
  productFiles: Awaited<ReturnType<typeof toFile>>[],
  expert: boolean
): Promise<Buffer> {
  if (client.apiKey === "unused" && FRIENDS_MODE) {
    const images = await Promise.all(productFiles.map(async (file) => Buffer.from(await file.arrayBuffer())));
    const url = await generateWithCloudflare({ images, prompt: spec.prompt, ratio: spec.ratio, settings: await getCloudflareAISettings() });
    return Buffer.from(url.split(",")[1], "base64");
  }
  const r = await client.images.edit({
    model,
    image: productFiles,
    prompt: spec.prompt,
    n: 1,
    size: sizeFor(spec.ratio),
    // 出图质量档(默认 medium):套图 13 张,质量档对总耗时影响很大。env OPENAI_IMAGE_QUALITY 可调。
    quality: (expert ? "high" : process.env.OPENAI_IMAGE_QUALITY || "medium") as
      | "low"
      | "medium"
      | "high"
      | "auto",
  });
  const d = r.data?.[0];
  if (!d) throw new Error("空返回");
  if (d.b64_json) return Buffer.from(d.b64_json, "base64");
  if (d.url) {
    const res = await fetch(d.url);
    return Buffer.from(await res.arrayBuffer());
  }
  throw new Error("空返回");
}

async function persistOne(buf: Buffer, id: string): Promise<string> {
  if (!storageEnabled) {
    // 无存储时退化成 data url(本地 mock)
    return `data:image/png;base64,${buf.toString("base64")}`;
  }
  try {
    return await uploadImage(new Uint8Array(buf), "image/png", `suite/${id}.png`);
  } catch {
    return `data:image/png;base64,${buf.toString("base64")}`;
  }
}

// --- Async job store (与生图同款,内存,单 pm2 fork) -------------------------
type Job = {
  status: "pending" | "done" | "error";
  access: JobAccess;
  shots: ShotResult[];
  done: number;
  total: number;
  user?: Awaited<ReturnType<typeof getUser>>;
  creditsUsed?: number;
  mock?: boolean;
  error?: string;
  createdAt: number;
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

function gcJobs() {
  const now = Date.now();
  JOBS.forEach((v, k) => {
    if (now - v.createdAt > 30 * 60 * 1000) JOBS.delete(k);
  });
}

async function runSuite(
  jobId: string,
  productImages: { buf: Buffer; type: string }[],
  extra: string,
  platform: string,
  email: string,
  apiKey: string,
  model: string,
  useDb: boolean,
  cost: number,
  options: SuiteOptions,
  plannedShots?: ShotSpec[]
) {
  const set = (patch: Partial<Job>) => {
    const cur = JOBS.get(jobId);
    if (cur) JOBS.set(jobId, { ...cur, ...patch });
  };
  try {
    const client = new OpenAI({
      apiKey: apiKey || "unused",
      baseURL: (await getOpenAIBaseUrl()) || undefined,
      timeout: PER_SHOT_TIMEOUT,
      maxRetries: 0,
    });

    // 第0层:工作台已真实分析时复用确认后的规划;旧版调用则在这里规划。
    const specs = plannedShots?.length
      ? plannedShots.map((shot, index) => normalizeSpec(shot, options, index))
      : !apiKey && FRIENDS_MODE
        ? fallbackForOptions(extra, platform, options)
        : await planShots(client, productImages[0], extra, platform, options);
    const shots: ShotResult[] = specs.map((s, i) => ({
      ...s,
      id: `suite-${Date.now()}-${i}`,
      status: "pending",
      gradient: GRADIENTS[i % GRADIENTS.length],
    }));
    set({ shots, total: shots.length });

    const productFiles = await Promise.all(
      productImages.map((im, i) =>
        toFile(im.buf, `product-${i}.png`, { type: im.type || "image/png" })
      )
    );

    // 第1-13层:并发限流逐张生成,完成一张更新一张
    let cursor = 0;
    let doneCount = 0;
    const worker = async (): Promise<void> => {
      while (cursor < shots.length) {
        const idx = cursor++;
        const shot = shots[idx];
        let ok = false;
        for (let attempt = 0; attempt <= SHOT_RETRIES && !ok; attempt++) {
          try {
            const buf = await genOneShot(client, model, shot, productFiles, options.expert);
            const url = await persistOne(buf, shot.id);
            shots[idx] = { ...shot, status: "done", url };
            ok = true;
          } catch (error) {
            if (!apiKey && FRIENDS_MODE) {
              shots[idx] = { ...shot, status: "error" };
              set({ shots: [...shots], done: doneCount });
              throw error;
            }
            // 频率限制/超时等:指数退避 + 抖动后重试,熬过限频窗口(2.5s→5s→10s,封顶18s)
            if (attempt < SHOT_RETRIES) {
              const wait =
                Math.min(18000, 2500 * 2 ** attempt) +
                Math.floor(Math.random() * 1500);
              await new Promise((r) => setTimeout(r, wait));
            }
          }
        }
        if (!ok) shots[idx] = { ...shot, status: "error" };
        doneCount++;
        set({ shots: [...shots], done: doneCount });
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(apiKey ? CONCURRENCY : 1, shots.length) }, worker)
    );

    const okShots = shots.filter((s) => s.status === "done" && s.url);
    if (okShots.length === 0) throw new Error("所有套图均生成失败，请检查图像模型配置后重试");

    // 归档作品库(一个套图 = 一个 batch)
    let user: Awaited<ReturnType<typeof getUser>> = null;
    if (useDb && okShots.length > 0) {
      const batchId = `suite-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
      try {
        await addArtworks(
          email,
          okShots.map((s) => ({
            id: s.id,
            title: `套图·${s.label}`,
            category: s.role === "detail" ? "detail" : "main",
            prompt: "",
            status: "completed",
            image: s.url!,
            gradient: s.gradient,
            style: null,
            ratio: s.ratio,
            resolution: options.resolution || "1K",
            // 把 role(main/sub/detail)存进 source(原本为 null;非 URL 不会被
            // regenHref 当作源图带走),作品页据此排序/标注主图/副图/详情。
            source: s.role,
          })),
          batchId
        );
      } catch {
        /* non-fatal */
      }
      // 失败的张数按比例退积分
      const failed = shots.length - okShots.length;
      if (failed > 0) {
        const refund = Math.round((cost / shots.length) * failed);
        await refundCredits(email, refund).catch(() => {});
      }
      await addLedgerEntry(
        email,
        -(cost - Math.round((cost / shots.length) * (shots.length - okShots.length))),
        `一键套图 ${okShots.length} 张`
      ).catch(() => {});
      user = await getUser(email).catch(() => null);
    }

    if (useDb) await settleReservation(jobId).catch(() => {});
    set({
      status: "done",
      shots: [...shots],
      done: shots.length,
      user,
      creditsUsed: cost,
      mock: !apiKey,
    });
  } catch (e) {
    if (useDb) {
      await refundCredits(email, cost).catch(() => {});
      await settleReservation(jobId).catch(() => {});
    }
    console.error("[suite] job failed:", e instanceof Error ? e.message : e);
    set({ status: "error", error: safeError(e, "套图生成失败,请稍后重试") });
  }
}

async function parseInput(request: Request) {
  const ct = request.headers.get("content-type") ?? "";
  if (!ct.includes("multipart/form-data")) return null;
  const f = await request.formData();
  const images: { buf: Buffer; type: string }[] = [];
  for (const file of f.getAll("image")) {
    if (file instanceof File && file.size > 0) {
      images.push({
        buf: Buffer.from(await file.arrayBuffer()),
        type: file.type || "image/png",
      });
    }
    if (images.length >= 6) break;
  }
  const s = (key: string) => (f.get(key) ?? "").toString().trim();
  const rawCount = Number(s("count"));
  const modules = s("modulePlan")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 13);
  let planData: ShotSpec[] = [];
  const rawPlan = s("planData");
  if (rawPlan) {
    try {
      const parsed = JSON.parse(rawPlan) as unknown;
      if (Array.isArray(parsed)) {
        planData = parsed
          .filter((shot): shot is ShotSpec => {
            if (!shot || typeof shot !== "object") return false;
            const value = shot as Partial<ShotSpec>;
            return typeof value.prompt === "string" && typeof value.label === "string";
          })
          .slice(0, 13)
          .map((shot) => ({
            role: shot.role === "main" || shot.role === "detail" ? shot.role : "sub",
            label: shot.label.slice(0, 80),
            ratio: String(shot.ratio || "1:1").slice(0, 10),
            prompt: shot.prompt.slice(0, 6000),
            text: shot.text?.slice(0, 200),
          }));
      }
    } catch {
      planData = [];
    }
  }
  return {
    images,
    action: s("action") === "plan" ? "plan" as const : "generate" as const,
    extra: s("text").slice(0, 1200),
    platform: (s("platform") || "taobao").slice(0, 40),
    email: s("email"),
    planData,
    options: {
      outputType: normalizeOutputType(s("outputType")),
      expert: s("expert") === "true",
      customModule: s("customModule") === "true",
      modules,
      count: Number.isFinite(rawCount) && rawCount > 0
        ? Math.max(1, Math.min(13, Math.floor(rawCount)))
        : 13,
      ratio: ["1:1", "3:4", "4:3", "9:16", "16:9"].includes(s("ratio")) ? s("ratio") : "",
      resolution: ["1K", "2K", "4K"].includes(s("resolution")) ? s("resolution") : "1K",
    } satisfies SuiteOptions,
  };
}

export async function POST(request: Request) {
  const input = await parseInput(request).catch(() => null);
  if (!input || input.images.length === 0) {
    return NextResponse.json({ error: "请上传至少一张产品图" }, { status: 400 });
  }
  if (input.images.some((im) => im.buf.length > 12 * 1024 * 1024)) {
    return NextResponse.json(
      { error: "单张上传图片过大（请 < 12MB）" },
      { status: 400 }
    );
  }

  const { apiKey, model } = await getOpenAISettings();
  if (!apiKey.trim() && FRIENDS_MODE && input.action === "plan") {
    const shots = specsFromModules(input.options.modules, input.extra, input.platform, input.options);
    return NextResponse.json({ status: "planned", planningMode: "template", total: shots.length, plan: shots.map((shot) => shot.label).join("\n"), shots });
  }
  if (!apiKey.trim() && !(FRIENDS_MODE && (await getCloudflareAISettings()).ready)) {
    return NextResponse.json(
      { error: "套图生成服务未配置，请先在后台配置 OpenAI API Key" },
      { status: 503 }
    );
  }
  const ip = clientIp(request);

  // 规划比整套出图轻；分别限流，避免规划点击占掉生成额度。
  const rateKey = input.action === "plan" ? "suite-plan" : "suite";
  const rateMax = input.action === "plan" ? 20 : 8;
  if (!rateLimit(`${rateKey}:${ip}`, rateMax, 600_000)) {
    return NextResponse.json(
      { error: "请求过于频繁，请稍后再试" },
      { status: 429 }
    );
  }

  const identity = await resolveUserIdentity(request);
  // 生产环境必须凭有效登录态:用 token / API Key 绑定的 email 作准,不信任请求体 email。
  if (dbEnabled && !FRIENDS_MODE) {
    if (!identity) {
      return NextResponse.json(
        { error: "请先登录后再生成" },
        { status: 401 }
      );
    }
    input.email = identity.email;
  } else if (FRIENDS_MODE) {
    input.email = identity?.email || "";
  } else if (identity) {
    input.email = identity.email;
  }
  const useDb = dbEnabled && input.email.length > 0;
  if (input.images.length > 6) input.images = input.images.slice(0, 6);

  if (!FRIENDS_MODE && dbEnabled && (await isBanned(input.email, ip))) {
    return NextResponse.json(
      { error: "账号或 IP 已被封禁，请联系管理员" },
      { status: 403 }
    );
  }

  if (input.action === "plan") {
    try {
      const client = new OpenAI({
        apiKey,
        baseURL: (await getOpenAIBaseUrl()) || undefined,
        timeout: 120_000,
        maxRetries: 0,
      });
      const shots = await planShots(
        client,
        input.images[0],
        input.extra,
        input.platform,
        input.options,
        false
      );
      return NextResponse.json({
        status: "planned",
        total: shots.length,
        plan: shots.map((shot) => shot.label).join("\n"),
        shots,
      });
    } catch (error) {
      return NextResponse.json(
        { error: safeError(error, "产品分析失败，请检查接口与模型配置后重试") },
        { status: 502 }
      );
    }
  }

  let plannedShots: ShotSpec[] | undefined;
  if (input.options.customModule && input.options.modules.length) {
    plannedShots = specsFromModules(input.options.modules, input.extra, input.platform, input.options);
  } else if (input.planData.length) {
    plannedShots = input.planData.slice(0, input.options.count);
  } else if (input.options.modules.length) {
    plannedShots = specsFromModules(input.options.modules, input.extra, input.platform, input.options);
  }
  const SHOT_COUNT = plannedShots?.length || input.options.count;
  const runOptions: SuiteOptions = { ...input.options, count: SHOT_COUNT };
  const cost = FRIENDS_MODE ? 0 : SHOT_COUNT * POINTS_PER_IMAGE;
  if (useDb && cost > 0) {
    const ok = await reserveCredits(input.email, cost);
    if (!ok) {
      return NextResponse.json(
        { error: "积分不足，请充值后重试" },
        { status: 402 }
      );
    }
  }

  gcJobs();
  const jobId = createJobId("suite");
  const { access, pollCookieSecret } = createJobAccess(
    identity?.email ?? null,
    identity?.kind !== "apiKey"
  );
  JOBS.set(jobId, {
    status: "pending",
    access,
    shots: [],
    done: 0,
    total: SHOT_COUNT,
    createdAt: Date.now(),
  });
  if (useDb && cost > 0) await addReservation(jobId, input.email, cost);
  void sweepStaleReservations().catch(() => {});
  void runSuite(
    jobId,
    input.images,
    input.extra,
    input.platform,
    input.email,
    apiKey,
    model,
    useDb,
    cost,
    runOptions,
    plannedShots
  );

  const response = jobResponse({ jobId, total: SHOT_COUNT, ...(FRIENDS_MODE ? {} : { cost }) });
  if (pollCookieSecret) {
    response.cookies.set(jobPollCookieName("suite", jobId), pollCookieSecret, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      maxAge: 30 * 60,
      path: "/api/suite",
    });
  }
  return response;
}

export async function GET(request: Request) {
  const jobId = new URL(request.url).searchParams.get("job");
  if (!jobId) {
    // 健康检查:绝不暴露模型名/上游供应商(铁律:绝不泄露所用模型)。
    const { apiKey } = await getOpenAISettings();
    return NextResponse.json({
      status: "ok",
      ready: !!apiKey.trim(),
      db: dbEnabled,
      storage: storageEnabled,
    });
  }
  const job = JOBS.get(jobId);
  if (!job || !(await canReadJob(request, "suite", jobId, job.access)))
    return missingJobResponse();
  // 公开字段:不回 prompt 全文(太长),只给前端要的展示数据
  const shots = job.shots.map((s) => ({
    id: s.id,
    role: s.role,
    label: s.label,
    ratio: s.ratio,
    status: s.status,
    url: s.url ?? null,
    gradient: s.gradient,
  }));
  return jobResponse({
    status: job.status,
    done: job.done,
    total: job.total,
    shots,
    user: job.status === "done" ? job.user : undefined,
    creditsUsed: job.status === "done" ? job.creditsUsed : undefined,
    mock: job.mock,
    error: job.error,
  });
}
