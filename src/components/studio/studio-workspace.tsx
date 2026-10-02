"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Check,
  Download,
  ImageIcon,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
  X,
} from "lucide-react";
import { authHeader } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { FRIENDS_MODE } from "@/lib/friends-mode";
import { downloadImage } from "@/lib/download";
import { cn } from "@/lib/utils";

export type StudioMode =
  | "genesis"
  | "mirror"
  | "sku"
  | "clothing"
  | "buyer"
  | "refinement"
  | "translation"
  | "matting";

type ModeConfig = {
  kicker: string;
  title: string;
  description: string;
  uploadTitle: string;
  uploadDescription: string;
  max: number;
  promptLabel: string;
  promptPlaceholder: string;
  action: string;
  empty: string;
  showSteps?: boolean;
  batch?: boolean;
  reference?: { title: string; description: string; max?: number };
};

const MODE: Record<StudioMode, ModeConfig> = {
  genesis: {
    kicker: "AI 全品类商品图",
    title: "一键生成主图 & 详情图组 & 广告图",
    description: "上传产品图，确认图片规划后生成电商主图、详情图组及营销广告图；请在要求中填写真实商品信息",
    uploadTitle: "产品图",
    uploadDescription: "上传清晰的产品图片",
    max: 6,
    promptLabel: "详情图要求",
    promptPlaceholder: "建议输入：产品名称、卖点、目标人群、目标电商平台、图片风格等",
    action: "规划商品图",
    empty: "上传产品图并填写要求后\n点击“规划商品图”开始",
    showSteps: true,
    batch: true,
  },
  mirror: {
    kicker: "AI 风格复刻",
    title: "上传参考设计，一键复刻同款视觉",
    description: "保留产品主体与包装细节，智能复刻参考图的构图、配色、光影和设计风格",
    uploadTitle: "产品图",
    uploadDescription: "上传需要生成同款视觉的产品图",
    max: 6,
    promptLabel: "复刻要求",
    promptPlaceholder: "补充需要保留或调整的构图、文字、光影等要求",
    action: "开始复刻",
    empty: "上传参考设计图和产品图后\n点击“开始复刻”生成结果",
    batch: true,
    reference: { title: "参考设计图", description: "上传需要复刻风格的图片", max: 1 },
  },
  sku: {
    kicker: "AI SKU 替换",
    title: "保留原场景，批量替换商品 SKU",
    description: "上传参考图与新商品，AI 自动识别替换区域，保持原图构图、背景、文字与光影关系",
    uploadTitle: "替换商品",
    uploadDescription: "每组最多上传 6 张商品角度图",
    max: 50,
    promptLabel: "替换要求",
    promptPlaceholder: "说明需要替换的位置、保留内容和商品展示要求",
    action: "开始替换",
    empty: "上传参考图和替换商品后\n点击“开始替换”创建任务",
    batch: true,
    reference: { title: "参考图", description: "上传需要替换 SKU 的原始场景图", max: 50 },
  },
  clothing: {
    kicker: "AI 服装组图",
    title: "一件服装，自动生成完整上架组图",
    description: "上传服装图，选择模特与场景，AI 自动规划并生成试穿图、白底图、细节图与营销场景图",
    uploadTitle: "服装图",
    uploadDescription: "上传服装正面、背面和细节图",
    max: 6,
    promptLabel: "组图要求",
    promptPlaceholder: "填写服装风格、目标人群、模特气质、拍摄场景等要求",
    action: "生成服装组图",
    empty: "上传服装图并选择模特与场景后\n点击“分析服装”开始",
    showSteps: true,
    batch: true,
    reference: { title: "模特 / 场景图", description: "可上传模特或场景参考，也可留空由 AI 生成", max: 2 },
  },
  buyer: {
    kicker: "AI 买家秀&种草图",
    title: "把商品图变成真实自然的买家秀",
    description: "上传商品图，可选模特与场景参考，批量生成手机感、生活化的买家秀和种草素材",
    uploadTitle: "产品图",
    uploadDescription: "上传 1–6 张商品角度图",
    max: 6,
    promptLabel: "生成要求",
    promptPlaceholder: "填写人群、场景、姿势、氛围和平台风格",
    action: "生成买家秀",
    empty: "上传产品图后\n点击“生成买家秀”开始",
    batch: true,
    reference: { title: "模特 / 场景图（可选）", description: "上传人物或真实场景参考", max: 2 },
  },
  refinement: {
    kicker: "AI 图片精修",
    title: "批量精修商品图，保留原图真实细节",
    description: "可选白底精修、高清放大、服装去皱或去水印，按原图逐张真实处理",
    uploadTitle: "待精修图片",
    uploadDescription: "一次最多上传 50 张商品图",
    max: 50,
    promptLabel: "精修要求",
    promptPlaceholder: "补充需要保留的纹理、文字或需要重点处理的区域",
    action: "开始精修",
    empty: "上传图片并选择精修操作后\n点击“开始精修”",
    batch: true,
  },
  translation: {
    kicker: "AI 图片翻译",
    title: "批量翻译图片文字，保留原有版式",
    description: "自动识别图片中的文字，完成翻译、擦字与重新排版，适配跨境电商多语言发布",
    uploadTitle: "待翻译图片",
    uploadDescription: "一次最多上传 50 张图片",
    max: 50,
    promptLabel: "翻译要求",
    promptPlaceholder: "填写品牌词、专有名词、语气和需要保留的原文",
    action: "开始翻译",
    empty: "上传图片并选择目标语言后\n点击“开始翻译”",
    batch: true,
  },
  matting: {
    kicker: "AI 批量抠图",
    title: "批量自动抠图，快速输出透明底或白底图",
    description: "自动识别商品主体并去除背景，支持透明底、白底、统一比例与批量下载",
    uploadTitle: "待抠图片",
    uploadDescription: "支持 JPG、PNG、WebP，一次最多 50 张",
    max: 50,
    promptLabel: "边缘处理",
    promptPlaceholder: "默认保留发丝、透明材质和商品边缘细节",
    action: "开始抠图",
    empty: "上传图片并选择输出背景后\n点击“开始抠图”",
    batch: true,
  },
};

const STEPS = ["输入", "分析中", "确认规划", "生成中", "完成"];
const LANGUAGES = ["简体中文", "繁體中文", "English", "日本語", "한국어", "Español", "Français", "Deutsch", "Italiano", "Português", "Русский", "العربية", "ไทย", "Tiếng Việt", "Bahasa Indonesia", "Bahasa Melayu", "Türkçe", "Polski", "Nederlands", "हिन्दी", "עברית"];
const RATIO_OPTIONS = [
  { value: "1:1", label: "1:1 方形" },
  { value: "3:4", label: "3:4 竖版" },
  { value: "4:3", label: "4:3 横版" },
  { value: "9:16", label: "9:16 竖屏" },
  { value: "16:9", label: "16:9 横屏" },
];
const RESOLUTION_OPTIONS = [
  { value: "1K", label: "1K 标准" },
  { value: "2K", label: "2K 高清" },
  { value: "4K", label: "4K 超清" },
];

type ResultImage = { id: string; url: string; prompt?: string; status?: string };
type RefinementOperation = "white-background" | "upscale" | "dewrinkle" | "dewatermark";
type RefinementResponse = {
  id?: string;
  url?: string;
  error?: string;
  user?: unknown;
};
type SuitePlanShot = {
  role: "main" | "sub" | "detail";
  label: string;
  ratio: string;
  prompt: string;
  text?: string;
};

const CLOTHING_SUBMODES = ["tryon", "catalog", "lifestyle"] as const;
const REFINEMENT_OPERATIONS: { value: RefinementOperation; label: string; endpoint: string }[] = [
  { value: "white-background", label: "白底精修", endpoint: "/api/cutout" },
  { value: "upscale", label: "高清放大", endpoint: "/api/upscale" },
  { value: "dewrinkle", label: "服装去皱", endpoint: "/api/dewrinkle" },
  { value: "dewatermark", label: "去水印", endpoint: "/api/dewatermark" },
];
const FRIENDS_REFINEMENT_OPERATIONS = REFINEMENT_OPERATIONS.filter(
  (item) => item.value === "white-background"
);

class StudioRequestError extends Error {
  constructor(message: string, readonly status: number | null) {
    super(message);
    this.name = "StudioRequestError";
  }
}

async function readRefinementResponse(response: Response): Promise<RefinementResponse> {
  try {
    return (await response.json()) as RefinementResponse;
  } catch {
    return {};
  }
}

let localCutoutWorker: Worker | null = null;
let localCutoutRequest = 0;

function cutoutLocally(
  file: File,
  whiteBackground: boolean,
  ratio: string,
  onProgress?: (value: number, message: string) => void
) {
  if (!localCutoutWorker) {
    localCutoutWorker = new Worker(
      new URL("../../workers/local-cutout.worker.ts", import.meta.url),
      { type: "module" }
    );
  }
  const worker = localCutoutWorker;
  const id = ++localCutoutRequest;
  return new Promise<string>(async (resolve, reject) => {
    const listener = (event: MessageEvent) => {
      const data = event.data as {
        id: number;
        kind: "progress" | "done" | "error";
        value?: number;
        message?: string;
        bytes?: ArrayBuffer;
        error?: string;
      };
      if (data.id !== id) return;
      if (data.kind === "progress") {
        onProgress?.(data.value ?? 0, data.message ?? "正在本地处理…");
        return;
      }
      worker.removeEventListener("message", listener);
      if (data.kind === "error" || !data.bytes) {
        reject(new Error(data.error || "本地抠图失败"));
        return;
      }
      resolve(URL.createObjectURL(new Blob([data.bytes], { type: "image/png" })));
    };
    worker.addEventListener("message", listener);
    try {
      const bytes = await file.arrayBuffer();
      worker.postMessage({ id, bytes, type: file.type || "image/png", whiteBackground, ratio }, [bytes]);
    } catch (error) {
      worker.removeEventListener("message", listener);
      reject(error);
    }
  });
}

function promptFor(mode: StudioMode, prompt: string, language: string, output: string) {
  const extra = prompt.trim() ? ` 用户补充要求：${prompt.trim()}。` : "";
  const map: Record<StudioMode, string> = {
    genesis: `根据上传的商品图生成专业电商${output}。必须保持商品外观、包装、品牌、文字、结构和颜色一致，使用干净的商业摄影光线与适合电商平台的构图。目标语言：${language}。`,
    mirror: "第一张参考图仅用于复刻构图、配色、光影、质感和排版风格；其余图片是必须保持一致的商品。用商品替换参考图主体，不能改变商品包装、品牌文字、图案、颜色和结构。",
    sku: "第一批图片是需要保留的原场景，后续图片是新 SKU。只替换原图中的商品，严格保留背景、构图、人物、文字、道具、光影和镜头角度，并保持新商品细节准确。",
    clothing: "根据服装图生成完整电商服装组图。严格保留版型、颜色、面料、印花、文字和细节；生成自然真实的模特试穿与商业场景摄影。",
    buyer: "把商品生成真实自然的手机买家秀和种草图片。保留商品所有细节，画面应像普通消费者拍摄，光线自然，避免过度棚拍和虚假结构。",
    refinement: "精修上传的商品图：去除杂乱背景、手套、支架、污渍与干扰物，保持商品包装文字、图案、颜色、结构和拍摄角度完全不变，输出干净的专业白底商品图和自然接触阴影。",
    translation: `识别并把图片里的文字翻译成${language}，擦除原文后在原位置重新排版。严格保留商品、背景、图形、字体风格、字号层级、颜色、对齐和整体版式，不要改动非文字内容。`,
    matting: "精确识别商品主体并移除背景，保留发丝、半透明材质、镂空、细小配件和真实边缘，输出干净透明底图片。",
  };
  return map[mode] + extra;
}

export function StudioWorkspace({ mode }: { mode: StudioMode }) {
  const cfg = MODE[mode];
  const { user, applyServerUser } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const refInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [refs, setRefs] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [refPreviews, setRefPreviews] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");
  const [output, setOutput] = useState("详情图");
  const [platform, setPlatform] = useState("智能匹配");
  const [language, setLanguage] = useState(mode === "translation" ? "English" : "无文字（纯视觉）");
  const [ratio, setRatio] = useState("3:4");
  const [resolution, setResolution] = useState("2K");
  const [count, setCount] = useState(mode === "genesis" ? 4 : 1);
  const [speed, setSpeed] = useState("标准模式");
  const [expert, setExpert] = useState(false);
  const [customModule, setCustomModule] = useState(false);
  const [submode, setSubmode] = useState(0);
  const [step, setStep] = useState(0);
  const [plan, setPlan] = useState("");
  const [suitePlan, setSuitePlan] = useState<SuitePlanShot[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<ResultImage[]>([]);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [whiteBackground, setWhiteBackground] = useState(true);
  const [refinementOperation, setRefinementOperation] = useState<RefinementOperation>("white-background");
  const [refinementScale, setRefinementScale] = useState("2");
  const refinementOperations = FRIENDS_MODE ? FRIENDS_REFINEMENT_OPERATIONS : REFINEMENT_OPERATIONS;

  const modeTabs = useMemo(() => {
    if (mode === "mirror") return ["单图复刻", "批量复刻", "包装复刻"];
    if (mode === "sku") return ["SKU替换", "多场景替换"];
    if (mode === "clothing") return ["模特试穿", "基础套图", "场景穿搭"];
    if (mode === "buyer") return ["买家秀", "种草图"];
    return [];
  }, [mode]);

  function addFiles(list: FileList | null, reference = false) {
    if (!list) return;
    const old = reference ? refs : files;
    const max = reference ? cfg.reference?.max ?? 1 : cfg.max;
    const accepted = Array.from(list).filter((f) => f.type.startsWith("image/") && f.size <= 12 * 1024 * 1024).slice(0, Math.max(0, max - old.length));
    if (!accepted.length) return;
    const urls = accepted.map((f) => URL.createObjectURL(f));
    if (reference) {
      setRefs((v) => [...v, ...accepted]);
      setRefPreviews((v) => [...v, ...urls]);
    } else {
      setFiles((v) => [...v, ...accepted]);
      setPreviews((v) => [...v, ...urls]);
    }
    setError("");
    setResults([]);
    setSuitePlan([]);
    setStep(0);
  }

  function removeAt(index: number, reference = false) {
    const urls = reference ? refPreviews : previews;
    URL.revokeObjectURL(urls[index]);
    if (reference) {
      setRefs((v) => v.filter((_, i) => i !== index));
      setRefPreviews((v) => v.filter((_, i) => i !== index));
    } else {
      setFiles((v) => v.filter((_, i) => i !== index));
      setPreviews((v) => v.filter((_, i) => i !== index));
    }
    setSuitePlan([]);
    setStep(0);
  }

  function invalidateSuiteAnalysis() {
    if (mode !== "genesis" || step < 2) return;
    setSuitePlan([]);
    setPlan("");
    setStep(0);
  }

  function appendSuiteOptions(fd: FormData) {
    fd.append("platform", platform);
    fd.append("expert", String(expert));
    fd.append("outputType", output);
    fd.append("customModule", String(customModule));
    fd.append("modulePlan", plan);
    fd.append("count", String(count));
    fd.append("ratio", ratio);
    fd.append("resolution", resolution);
  }

  async function makePlan() {
    if (!files.length || (cfg.reference && !refs.length && (mode === "mirror" || mode === "sku"))) {
      setError(cfg.reference && !refs.length ? `请先上传${cfg.reference.title}` : `请先上传${cfg.uploadTitle}`);
      return;
    }
    setError("");
    setBusy(true);
    setStep(1);
    setProgress(12);
    try {
      const fd = new FormData();
      files.slice(0, 6).forEach((file) => fd.append("image", file));
      fd.append("action", "plan");
      fd.append("text", prompt.trim());
      appendSuiteOptions(fd);
      if (user?.email) fd.append("email", user.email);
      const res = await fetch("/api/suite", {
        method: "POST",
        headers: await authHeader(),
        body: fd,
      });
      const data = await res.json();
      if (!res.ok || !Array.isArray(data.shots) || !data.shots.length) {
        throw new Error(data.error || "产品分析失败");
      }
      const shots = data.shots as SuitePlanShot[];
      setSuitePlan(shots);
      setPlan(shots.map((shot) => shot.label).join("\n"));
      setProgress(100);
      setStep(2);
    } catch (e) {
      setError(e instanceof Error ? e.message : "产品分析失败");
      setProgress(0);
      setStep(0);
    } finally {
      setBusy(false);
    }
  }

  function writePrompt() {
    const suggestions: Record<StudioMode, string> = {
      genesis: "突出商品核心卖点，保持包装文字、图案、颜色和结构不变；画面干净高级，适合电商详情页。",
      mirror: "严格复刻参考图的构图、配色、光影和排版，只替换商品主体并保留商品全部细节。",
      sku: "只替换指定商品，保留原图背景、人物、道具、文字、构图、镜头角度和光影。",
      clothing: "保持服装版型、颜色、面料、印花和工艺细节一致，生成自然真实的模特试穿套图。",
      buyer: "生成真实手机拍摄感的生活化买家秀，人物动作自然，保留商品细节，避免过度棚拍。",
      refinement: refinementOperation === "dewrinkle"
        ? "只去除服装褶皱，保留面料纹理、版型、颜色、图案、文字和原有光影。"
        : "只去除覆盖在画面上的水印或标记，保留商品文字、图案、颜色、构图和背景细节。",
      translation: `翻译为${language}，保留原字体风格、层级、颜色、对齐和版式，不改动商品与非文字内容。`,
      matting: "保留发丝、半透明材质、镂空、细小配件和真实边缘，主体外内容全部移除。",
    };
    setPrompt(suggestions[mode]);
    invalidateSuiteAnalysis();
  }

  async function runGenesis() {
    setBusy(true);
    setError("");
    setResults([]);
    setSelected(new Set());
    setStep(3);
    setProgress(4);
    try {
      const fd = new FormData();
      files.slice(0, 6).forEach((file) => fd.append("image", file));
      fd.append("action", "generate");
      fd.append("text", prompt.trim());
      appendSuiteOptions(fd);
      if (suitePlan.length) fd.append("planData", JSON.stringify(suitePlan));
      if (user?.email) fd.append("email", user.email);

      const res = await fetch("/api/suite", {
        method: "POST",
        headers: await authHeader(),
        body: fd,
      });
      const start = await res.json();
      if (!res.ok || !start.jobId) throw new Error(start.error || "创建套图任务失败");

      const jobId = start.jobId as string;
      const deadline = Date.now() + 12 * 60 * 1000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, 1800));
        const poll = await fetch(`/api/suite?job=${encodeURIComponent(jobId)}`, { cache: "no-store" });
        const data = await poll.json();
        if (!poll.ok || data.status === "error") throw new Error(data.error || "套图生成失败");
        const total = Math.max(1, Number(data.total) || Number(start.total) || count);
        const done = Math.max(0, Number(data.done) || 0);
        setProgress(Math.min(96, Math.max(4, Math.round((done / total) * 100))));
        const images = Array.isArray(data.shots)
          ? data.shots
              .filter((shot: { status?: string; url?: string }) => shot.status === "done" && shot.url)
              .map((shot: { id?: string; url: string; prompt?: string }, index: number) => ({
                id: shot.id || `${jobId}-${index}`,
                url: shot.url,
                prompt: shot.prompt,
                status: "done",
              }))
          : [];
        if (images.length) setResults(images);
        if (data.status === "done") {
          if (!images.length) throw new Error("套图任务未生成可用图片");
          if (data.user) applyServerUser(data.user);
          setProgress(100);
          setStep(4);
          return;
        }
      }
      throw new Error("套图任务超时，请稍后重试");
    } catch (e) {
      setError(e instanceof Error ? e.message : "套图生成失败");
      setProgress(0);
      setStep(2);
    } finally {
      setBusy(false);
    }
  }

  async function runClothing() {
    setBusy(true);
    setError("");
    setResults([]);
    setSelected(new Set());
    setStep(3);
    setProgress(3);
    const completed: ResultImage[] = [];
    try {
      const headers = await authHeader();
      const total = Math.max(1, count);
      for (let index = 0; index < total; index++) {
        const fd = new FormData();
        files.slice(0, 6).forEach((file) => fd.append("garment", file));
        refs.slice(0, 2).forEach((file) => fd.append("reference", file));
        fd.append("mode", CLOTHING_SUBMODES[submode] || CLOTHING_SUBMODES[0]);
        fd.append("prompt", promptFor(mode, [prompt, plan].filter(Boolean).join("。"), language, output));
        fd.append("ratio", ratio);
        fd.append("resolution", resolution);
        fd.append("expert", String(expert));
        fd.append("customModule", String(customModule));
        fd.append("modulePlan", plan);
        if (user?.email) fd.append("email", user.email);

        const startRes = await fetch("/api/tryon", {
          method: "POST",
          headers,
          body: fd,
        });
        const start = await startRes.json();
        if (!startRes.ok || !start.jobId) throw new Error(start.error || "创建服装任务失败");
        const jobId = start.jobId as string;
        const deadline = Date.now() + 6 * 60 * 1000;
        let finished = false;
        while (!finished && Date.now() < deadline) {
          await new Promise((resolve) => window.setTimeout(resolve, 1800));
          setProgress(Math.min(96, Math.max(3, Math.round(((index + 0.35) / total) * 100))));
          const poll = await fetch(`/api/tryon?job=${encodeURIComponent(jobId)}`, { cache: "no-store" });
          const data = await poll.json();
          if (!poll.ok || data.status === "error") throw new Error(data.error || "服装图片生成失败");
          if (data.status === "done") {
            if (!data.url) throw new Error("服装任务未返回图片");
            completed.push({ id: data.id || `${jobId}-${index}`, url: data.url, status: "done" });
            setResults([...completed]);
            if (data.user) applyServerUser(data.user);
            setProgress(Math.round(((index + 1) / total) * 100));
            finished = true;
          }
        }
        if (!finished) throw new Error("服装任务超时，请稍后重试");
      }
      setProgress(100);
      setStep(4);
    } catch (e) {
      setError(e instanceof Error ? e.message : "服装图片生成失败");
      setStep(completed.length ? 4 : 0);
      if (!completed.length) setProgress(0);
    } finally {
      setBusy(false);
    }
  }

  async function startGenerate() {
    if (!files.length) {
      setError(`请先上传${cfg.uploadTitle}`);
      return;
    }
    if (mode === "matting") return runMatting();
    if (mode === "refinement") return runRefinement();
    if (mode === "genesis") return runGenesis();
    if (mode === "clothing") return runClothing();
    setBusy(true);
    setError("");
    setResults([]);
    setSelected(new Set());
    setStep(cfg.showSteps ? 3 : 1);
    setProgress(8);
    try {
      const fd = new FormData();
      [...refs, ...files].slice(0, 6).forEach((f) => fd.append("image", f));
      const buyerMode = mode === "buyer"
        ? submode === 1
          ? "生成适合小红书、抖音发布的生活化种草图，画面要有真实分享感、清晰使用场景和自然卖点表达。"
          : "生成普通消费者手机拍摄感的真实买家秀，避免棚拍感和夸张广告构图。"
        : "";
      const fullPrompt = promptFor(mode, [buyerMode, prompt, plan].filter(Boolean).join("。"), language, output);
      fd.append("prompt", fullPrompt);
      fd.append("userPrompt", prompt);
      fd.append("category", mode === "buyer" ? "xiaohongshu" : output === "广告图" ? "banner" : output === "详情图" ? "detail" : "main");
      fd.append("ratio", ratio);
      fd.append("resolution", resolution);
      fd.append("quality", speed === "极速模式" ? "low" : speed === "快速模式" ? "medium" : "high");
      fd.append("count", String(count));
      fd.append("style", mode === "buyer" ? "手机真实感" : "默认");
      if (user?.email) fd.append("email", user.email);
      const res = await fetch("/api/generate-image", { method: "POST", headers: await authHeader(), body: fd });
      const start = await res.json();
      if (!res.ok || !start.jobId) throw new Error(start.error || "创建任务失败");
      const jobId = start.jobId as string;
      const deadline = Date.now() + 6 * 60 * 1000;
      let tick = 8;
      while (Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, 1400));
        tick = Math.min(92, tick + 7);
        setProgress(tick);
        const poll = await fetch(`/api/generate-image?job=${encodeURIComponent(jobId)}`, { cache: "no-store" });
        const data = await poll.json();
        if (data.status === "error") throw new Error(data.error || "生成失败");
        if (data.status === "done") {
          const images = (data.images || []) as ResultImage[];
          setResults(images.map((im, i) => ({ ...im, id: im.id || `${jobId}-${i}`, status: "done" })));
          if (data.user) applyServerUser(data.user);
          setProgress(100);
          setStep(cfg.showSteps ? 4 : 2);
          setBusy(false);
          return;
        }
      }
      throw new Error("任务超时，请稍后重试");
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成失败");
      setBusy(false);
      setProgress(0);
      setStep(cfg.showSteps ? 2 : 0);
    }
  }

  async function runRefinement() {
    const operation = REFINEMENT_OPERATIONS.find((item) => item.value === refinementOperation)!;
    setBusy(true);
    setError("");
    setResults([]);
    setSelected(new Set());
    setStep(1);
    setProgress(0);

    const completed: ResultImage[] = [];
    const fileErrors: string[] = [];
    const runLocalWhiteBackground = async (
      file: File,
      index: number
    ): Promise<ResultImage> => {
      const url = await cutoutLocally(file, true, ratio, (value) => {
        setProgress(
          Math.round(((index + value / 100) / files.length) * 100)
        );
      });
      return {
        id: `local-white-background-${index}`,
        url,
        status: "done",
      };
    };
    try {
      const headers = await authHeader();
      for (let index = 0; index < files.length; index++) {
        const file = files[index];
        try {
          // 白底抠图对访客开放，直接在浏览器执行，原图无需上传。
          if (refinementOperation === "white-background" && (FRIENDS_MODE || !user?.email)) {
            completed.push(await runLocalWhiteBackground(file, index));
            setResults([...completed]);
            setProgress(Math.round(((index + 1) / files.length) * 100));
            continue;
          }
          const fd = new FormData();
          fd.append("image", file);
          if (user?.email) fd.append("email", user.email);

          if (refinementOperation === "white-background") {
            fd.append("quality", "fine");
            fd.append("preserveSource", "1");
            fd.append("category", "cutout");
            fd.append("title", `${file.name} · 白底精修`);
            fd.append("background", "white");
            fd.append("ratio", ratio);
            fd.append("resolution", resolution);
          } else if (refinementOperation === "upscale") {
            fd.append("title", `${file.name} · 高清放大`);
            fd.append("scale", refinementScale);
            fd.append("faceEnhance", "0");
          } else {
            fd.append("ratio", ratio);
            if (prompt.trim()) fd.append("prompt", prompt.trim());
          }

          let response: Response;
          try {
            response = await fetch(operation.endpoint, { method: "POST", headers, body: fd });
          } catch {
            throw new StudioRequestError(`${operation.label}服务暂时不可用，请检查网络后重试`, null);
          }

          const data = await readRefinementResponse(response);
          if (!response.ok) {
            const fallback = response.status >= 500
              ? `${operation.label}服务暂时不可用，请稍后重试`
              : `${operation.label}失败（${response.status}）`;
            throw new StudioRequestError(data.error || fallback, response.status);
          }
          if (!data.url) {
            throw new StudioRequestError(`${operation.label}服务未返回结果`, response.status);
          }

          completed.push({
            id: data.id || `${refinementOperation}-${Date.now()}-${index}`,
            url: data.url,
            status: "done",
          });
          setResults([...completed]);
          if (data.user) {
            applyServerUser(data.user as Parameters<typeof applyServerUser>[0]);
          }
        } catch (cause) {
          const requestError = cause instanceof StudioRequestError
            ? cause
            : new StudioRequestError(cause instanceof Error ? cause.message : `${operation.label}失败`, null);
          const canUseLocalWhiteBackground =
            refinementOperation === "white-background" &&
            (requestError.status === null ||
              requestError.status === 401 ||
              (requestError.status >= 500 && requestError.status <= 599));
          if (canUseLocalWhiteBackground) {
            try {
              completed.push(await runLocalWhiteBackground(file, index));
              setResults([...completed]);
              setProgress(Math.round(((index + 1) / files.length) * 100));
              continue;
            } catch (localCause) {
              setError(
                localCause instanceof Error
                  ? localCause.message
                  : "浏览器本地白底抠图失败"
              );
              break;
            }
          }
          const mustStop =
            requestError.status === null ||
            requestError.status === 401 ||
            requestError.status === 402 ||
            requestError.status === 403 ||
            requestError.status === 429 ||
            (requestError.status !== null && requestError.status >= 500);
          if (mustStop) {
            setError(requestError.message);
            break;
          }
          fileErrors.push(`${file.name}：${requestError.message}`);
          setError(fileErrors.join("；"));
        }
        setProgress(Math.round(((index + 1) / files.length) * 100));
      }
      setStep(completed.length ? 2 : 0);
    } catch (cause) {
      const requestError = cause instanceof StudioRequestError
        ? cause
        : new StudioRequestError(cause instanceof Error ? cause.message : `${operation.label}失败`, null);
      setError(requestError.message);
      setStep(completed.length ? 2 : 0);
    } finally {
      setBusy(false);
    }
  }

  async function runMatting() {
    setBusy(true);
    setError("");
    setResults([]);
    const next: ResultImage[] = [];
    for (let i = 0; i < files.length; i++) {
      try {
        const fd = new FormData();
        fd.append("image", files[i]);
        fd.append("quality", "fine");
        fd.append("category", "cutout");
        fd.append("title", files[i].name);
        fd.append("background", whiteBackground ? "white" : "transparent");
        fd.append("ratio", ratio);
        fd.append("resolution", resolution);
        if (user?.email) fd.append("email", user.email);
        const res = await fetch("/api/cutout", { method: "POST", headers: await authHeader(), body: fd });
        const data = await res.json();
        if (!res.ok || !data.url) throw new Error(data.error || "抠图失败");
        next.push({ id: data.id || `cut-${i}`, url: data.url, status: "done" });
        if (data.user) applyServerUser(data.user);
      } catch {
        try {
          const localUrl = await cutoutLocally(files[i], whiteBackground, ratio, (value) => {
            const completed = i / files.length;
            setProgress(Math.round((completed + value / 100 / files.length) * 100));
          });
          next.push({ id: `local-cut-${i}`, url: localUrl, status: "done" });
        } catch {
          next.push({ id: `cut-${i}`, url: previews[i], status: "error" });
        }
      }
      setResults([...next]);
      setProgress(Math.round(((i + 1) / files.length) * 100));
    }
    setBusy(false);
    if (next.some((r) => r.status === "error")) setError("部分图片处理失败，可单独重试");
  }

  function primaryAction() {
    if (mode === "genesis" && step < 2) return makePlan();
    return startGenerate();
  }

  function downloadAll() {
    const list = results.filter((r) => !selected.size || selected.has(r.id));
    list.forEach((r, i) => window.setTimeout(() => downloadImage(r.url, `${mode}-${i + 1}`), i * 280));
  }

  return (
    <div className="studio-page">
      <section className="studio-hero">
        <span className="studio-kicker"><Sparkles />{cfg.kicker}</span>
        <h1>{cfg.title}</h1>
        <p>{cfg.description}</p>
      </section>

      <section className="studio-workspace">
        <div className={cn("studio-flow-row", !cfg.showSteps && "without-steps")}>
          {cfg.batch && (
            <Link className="studio-batch" href="/studio-genesis/batch" target="_blank" rel="noopener noreferrer">
              <Plus />创建批量任务<em>NEW</em>
            </Link>
          )}
          {cfg.showSteps && (
            <div className="studio-steps" aria-label="生成进度">
              {STEPS.map((label, index) => (
                <div key={label} className="studio-step-wrap">
                  <div className={cn("studio-step", index === step && "is-active", index < step && "is-complete")}>
                    <span>{index < step ? <Check /> : index + 1}</span>
                    <b>{label}</b>
                  </div>
                  {index < STEPS.length - 1 && <i aria-hidden="true" />}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={cn("studio-grid", !cfg.showSteps && "without-steps")}>
          <div className="studio-left">
            {modeTabs.length > 0 && (
              <div className={cn("studio-card studio-mode-tabs", modeTabs.length === 2 && "two")}>
                {modeTabs.map((label, index) => (
                  <button key={label} className={cn(index === submode && "is-active")} onClick={() => setSubmode(index)}>
                    {label}
                  </button>
                ))}
              </div>
            )}

            {cfg.reference && (
              <UploadCard
                title={cfg.reference.title}
                description={cfg.reference.description}
                max={cfg.reference.max ?? 1}
                files={refs}
                previews={refPreviews}
                inputRef={refInputRef}
                onAdd={(list) => addFiles(list, true)}
                onRemove={(i) => removeAt(i, true)}
              />
            )}

            <UploadCard
              title={cfg.uploadTitle}
              description={cfg.uploadDescription}
              max={cfg.max}
              files={files}
              previews={previews}
              inputRef={inputRef}
              onAdd={(list) => addFiles(list)}
              onRemove={(i) => removeAt(i)}
              footer={mode === "genesis" ? <Link href="/refinement-studio">没有白底图？ 去精修获得白底图</Link> : undefined}
            />

            <section className="studio-card studio-form-card">
              {mode === "genesis" && (
                <div className="studio-segmented three">
                  {["主图", "详情图", "广告图"].map((item) => <button key={item} className={cn(output === item && "is-active")} onClick={() => { setOutput(item); invalidateSuiteAnalysis(); }}>{item}{item === "广告图" && <em>NEW</em>}</button>)}
                </div>
              )}

              {mode === "sku" && (
                <div className="studio-field">
                  <label>替换模式</label>
                  <div className="studio-segmented"><button className="is-active">智能替换</button><button>局部替换</button></div>
                </div>
              )}

              {mode === "refinement" && (
                <SelectField
                  label="精修操作"
                  value={refinementOperation}
                  onChange={(value) => {
                    setRefinementOperation(value as RefinementOperation);
                    setError("");
                    setResults([]);
                    setSelected(new Set());
                    setStep(0);
                    setProgress(0);
                  }}
                  options={refinementOperations}
                />
              )}

              {mode === "genesis" && <SelectField label="目标平台" value={platform} onChange={(value) => { setPlatform(value); invalidateSuiteAnalysis(); }} options={["智能匹配", "淘宝 / 天猫", "抖音 / 小红书", "TikTok Shop", "Amazon", "Shopify", "Etsy"]} />}

              {(mode !== "refinement" || refinementOperation === "dewrinkle" || refinementOperation === "dewatermark") && (
                <div className="studio-field studio-prompt-field">
                  <div className="studio-label-row"><label>{mode === "refinement" ? "补充要求（可选）" : cfg.promptLabel}</label></div>
                  <textarea
                    value={prompt}
                    onChange={(e) => { setPrompt(e.target.value); invalidateSuiteAnalysis(); }}
                    rows={4}
                    placeholder={mode === "refinement" && refinementOperation === "dewrinkle"
                      ? "例如：只处理衣身褶皱，保留针织纹理、印花与原有光影"
                      : mode === "refinement"
                        ? "例如：去除右下角半透明水印，保留包装上的品牌文字"
                        : cfg.promptPlaceholder}
                  />
                  <button className="studio-ai-write" type="button" onClick={writePrompt}><Wand2 />AI帮写</button>
                </div>
              )}

              {mode === "translation" ? (
                <SelectField label="目标语言" value={language} onChange={setLanguage} options={LANGUAGES} />
              ) : mode !== "matting" && mode !== "refinement" && (
                <div className="studio-two-fields">
                  <SelectField label="目标语言" value={language} onChange={setLanguage} options={["无文字（纯视觉）", "简体中文", "English", "日本語", "Español"]} />
                  <SelectField label="模型" value="商品图模型" onChange={() => {}} options={["商品图模型"]} />
                </div>
              )}

              {mode === "refinement" ? (
                refinementOperation === "upscale" ? (
                  <SelectField label="放大倍数" value={refinementScale} onChange={setRefinementScale} options={[{ value: "2", label: "2x 高清" }, { value: "4", label: "4x 超清" }]} />
                ) : refinementOperation === "white-background" ? (
                  <div className="studio-two-fields">
                    <SelectField label="尺寸比例" value={ratio} onChange={setRatio} options={RATIO_OPTIONS} />
                    <SelectField label="清晰度" value={resolution} onChange={setResolution} options={RESOLUTION_OPTIONS} />
                  </div>
                ) : (
                  <SelectField label="输出比例" value={ratio} onChange={setRatio} options={RATIO_OPTIONS} />
                )
              ) : (
                <div className="studio-two-fields">
                  <SelectField label="尺寸比例" value={ratio} onChange={(value) => { setRatio(value); invalidateSuiteAnalysis(); }} options={RATIO_OPTIONS} />
                  <SelectField label={mode === "matting" ? "输出背景" : "清晰度"} value={mode === "matting" ? (whiteBackground ? "白色背景" : "透明背景") : resolution} onChange={(value) => mode === "matting" ? setWhiteBackground(value === "白色背景") : setResolution(value)} options={mode === "matting" ? ["透明背景", "白色背景"] : RESOLUTION_OPTIONS} />
                </div>
              )}

              {mode !== "matting" && mode !== "refinement" && <SelectField label="生成数量" value={`${count} 张`} onChange={(v) => { setCount(Number(v.split(" ")[0])); invalidateSuiteAnalysis(); }} options={[1, 2, 3, 4, 6, 8].map((n) => `${n} 张`)} />}
              {!cfg.showSteps && mode !== "matting" && mode !== "refinement" && <SelectField label="生成速度" value={speed} onChange={setSpeed} options={["标准模式", "快速模式", "极速模式"]} />}

              {cfg.showSteps && (
                <>
                  <div className="studio-module-choice"><strong>{mode === "clothing" ? "组图模块" : "详情图模块"}</strong><div className="studio-segmented"><button type="button" className={!customModule ? "is-active" : ""} onClick={() => { setCustomModule(false); invalidateSuiteAnalysis(); }}>智能模块</button><button type="button" className={customModule ? "is-active" : ""} onClick={() => { setCustomModule(true); invalidateSuiteAnalysis(); }}>自定义模块 <em>NEW</em></button></div></div>
                  <label className="studio-switch"><small>开启后分析更深入，规划质量更高</small><span><input type="checkbox" checked={expert} onChange={(e) => { setExpert(e.target.checked); invalidateSuiteAnalysis(); }} /><i aria-hidden="true" /><strong>专家模式</strong></span></label>
                  {(step >= 2 || customModule) && <div className="studio-field"><label>套图分镜（每行一张，可编辑）</label><textarea rows={5} value={plan} onChange={(e) => { setPlan(e.target.value); if (mode === "genesis") setSuitePlan([]); }} placeholder={customModule ? "每行填写一个需要生成的画面" : undefined} /></div>}
                </>
              )}

              {error && <div className="studio-error">{error}</div>}
              <button className="studio-primary" type="button" disabled={busy} onClick={primaryAction}>
                {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
                {busy ? (step === 1 ? "正在分析…" : `处理中 ${progress}%`) : cfg.showSteps && step === 2 ? "按分镜生成图片" : cfg.action}
              </button>
            </section>
          </div>

          <section className="studio-card studio-results-card">
            <header>
              <div className="studio-card-heading"><span><Sparkles /></span><div><h2>生成结果</h2><p>{busy ? `任务处理中 · ${progress}%` : results.length ? `已完成 ${results.length} 张` : cfg.empty.split("\n")[0]}</p></div></div>
              {results.length > 0 && <button className="studio-download-all" onClick={downloadAll}><Download />{selected.size ? `下载已选 ${selected.size}` : "全部下载"}</button>}
            </header>
            {busy && <div className="studio-progress"><span style={{ width: `${progress}%` }} /></div>}
            {results.length ? (
              <div className="studio-result-grid">
                {results.map((result, index) => {
                  const checked = selected.has(result.id);
                  return (
                    <article key={result.id} className={cn("studio-result", checked && "is-selected", result.status === "error" && "is-error")}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={result.url} alt={`生成结果 ${index + 1}`} />
                      <button className="studio-result-check" onClick={() => setSelected((old) => { const next = new Set(old); checked ? next.delete(result.id) : next.add(result.id); return next; })}>{checked && <Check />}</button>
                      <div className="studio-result-actions"><button onClick={() => downloadImage(result.url, `${mode}-${index + 1}`)}><Download />下载</button><button onClick={() => { setResults([]); setStep(0); }}><RefreshCw />再生成</button></div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="studio-empty"><span><Sparkles /></span><p>{cfg.empty.split("\n").map((line) => <span key={line}>{line}<br /></span>)}</p></div>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}

function UploadCard({ title, description, max, files, previews, inputRef, onAdd, onRemove, footer }: {
  title: string;
  description: string;
  max: number;
  files: File[];
  previews: string[];
  inputRef: React.RefObject<HTMLInputElement>;
  onAdd: (files: FileList | null) => void;
  onRemove: (index: number) => void;
  footer?: React.ReactNode;
}) {
  const [dragging, setDragging] = useState(false);
  return (
    <section className="studio-card studio-upload-card">
      <header><div className="studio-card-heading"><span><ImageIcon /></span><div><h2>{title}</h2><p>{description}</p></div></div><span>{files.length}/{max}</span></header>
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple={max > 1} hidden onChange={(e) => onAdd(e.target.files)} />
      {!files.length ? (
        <button
          className={cn("studio-upload-zone", dragging && "is-dragging")}
          onClick={() => inputRef.current?.click()}
          onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={(event) => { event.preventDefault(); setDragging(false); }}
          onDrop={(event) => { event.preventDefault(); setDragging(false); onAdd(event.dataTransfer.files); }}
          type="button"
        ><Upload /><span>多图上传时建议仅上传必要的视角或sku图，干净的白底产品图最佳</span></button>
      ) : (
        <div className="studio-thumbs">
          {previews.map((src, i) => <div key={src}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={src} alt="" /><button onClick={() => onRemove(i)}><X /></button></div>)}
          {files.length < max && <button className="studio-add-thumb" onClick={() => inputRef.current?.click()}><Plus /></button>}
        </div>
      )}
      <footer>{footer || <span>支持 JPG / PNG / WebP，单张最大 12MB</span>}{files.length > 1 && <button onClick={() => Array.from({ length: files.length }, (_, i) => files.length - i - 1).forEach(onRemove)}><Trash2 />清空</button>}</footer>
    </section>
  );
}

type SelectOption = string | { value: string; label: string };

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: SelectOption[] }) {
  return <div className="studio-field"><label>{label}</label><select value={value} onChange={(e) => onChange(e.target.value)}>{options.map((option) => { const item = typeof option === "string" ? { value: option, label: option } : option; return <option key={item.value} value={item.value}>{item.label}</option>; })}</select></div>;
}
