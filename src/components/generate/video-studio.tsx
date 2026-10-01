"use client";

import Link from "next/link";
import {
  AtSign, Check, Clock3, FileAudio, FileImage, FileVideo, Film,
  Download, Image as ImageIcon, LoaderCircle, Mic2, Music2, Plus, Save, Settings2, Sparkles,
  Trash2, Video, Volume2, VolumeX, WandSparkles, X,
} from "lucide-react";
import {
  useEffect, useMemo, useRef, useState,
  type DragEvent, type ReactNode,
} from "react";
import { cn } from "@/lib/utils";
import { BRAND } from "@/lib/brand";

type StudioMode = "assist" | "direct" | "remix";
type AssetKind = "image" | "video" | "audio";
type MaterialAsset = {
  id: string; kind: AssetKind; name: string; mention: string; url: string; size: number; file: File;
};
type GenerateStatus = "idle" | "starting" | "processing" | "succeeded" | "failed";
type Draft = {
  id: string; createdAt: number; mode: StudioMode; title: string; script: string;
  duration: string; ratio: string; resolution: string; materialCount: number;
};

const MODES: Array<{
  value: StudioMode; label: string; description: string; icon: typeof Sparkles;
}> = [
  { value: "assist", label: "脚本帮写", description: "根据商品信息起草分镜", icon: WandSparkles },
  { value: "direct", label: "脚本直出", description: "按你的完整脚本制作", icon: FileVideo },
  { value: "remix", label: "爆款复刻", description: "参考视频节奏重新编排", icon: Sparkles },
];
const MODELS = [
  { value: "seedance", label: "Seedance 1.5 Pro" },
  { value: "kling", label: "Kling 2.1" },
  { value: "veo", label: "Veo 3（暂不支持）" },
];
const ACCEPT: Record<AssetKind, string> = {
  image: "image/png,image/jpeg,image/webp",
  video: "video/mp4,video/webm,video/quicktime",
  audio: "audio/mpeg,audio/mp4,audio/wav,audio/x-wav,audio/webm",
};
const MAX_SIZE: Record<AssetKind, number> = {
  image: 12 * 1024 * 1024, video: 120 * 1024 * 1024, audio: 30 * 1024 * 1024,
};
const DRAFT_KEY = "novaryns-video-studio-drafts-v1";

function fileSize(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
function modeLabel(mode: StudioMode) {
  return MODES.find((item) => item.value === mode)?.label ?? "视频创作";
}
function draftTime(timestamp: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(timestamp);
}

export function VideoStudio() {
  const imageInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);
  const objectUrls = useRef<string[]>([]);
  const polling = useRef<AbortController | null>(null);
  const [mode, setMode] = useState<StudioMode>("assist");
  const [brief, setBrief] = useState("");
  const [script, setScript] = useState("");
  const [assets, setAssets] = useState<MaterialAsset[]>([]);
  const [duration, setDuration] = useState("15");
  const [ratio, setRatio] = useState("9:16");
  const [resolution, setResolution] = useState("1080P");
  const [sound, setSound] = useState(true);
  const [narration, setNarration] = useState(true);
  const [language, setLanguage] = useState("普通话");
  const [voice, setVoice] = useState("自然女声");
  const [model, setModel] = useState("seedance");
  const [mentionOpen, setMentionOpen] = useState(false);
  const [dragKind, setDragKind] = useState<AssetKind | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [generateStatus, setGenerateStatus] = useState<GenerateStatus>("idle");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY);
      if (raw) setDrafts(JSON.parse(raw) as Draft[]);
    } catch {}
    return () => {
      polling.current?.abort();
      objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  const counts = useMemo(() => ({
    image: assets.filter((item) => item.kind === "image").length,
    video: assets.filter((item) => item.kind === "video").length,
    audio: assets.filter((item) => item.kind === "audio").length,
  }), [assets]);

  function addFiles(kind: AssetKind, list: FileList | null) {
    if (!list?.length) return;
    setError(null);
    const files = Array.from(list);
    const oversized = files.find((file) => file.size > MAX_SIZE[kind]);
    if (oversized) {
      const limit = kind === "image" ? "12MB" : kind === "video" ? "120MB" : "30MB";
      setError(`${oversized.name} 超过 ${limit} 限制`);
      return;
    }
    setAssets((current) => {
      const room = Math.max(0, 8 - current.length);
      const base = current.filter((item) => item.kind === kind).length;
      const label = kind === "image" ? "图片" : kind === "video" ? "视频" : "音频";
      const added = files.slice(0, room).map((file, index) => {
        const url = URL.createObjectURL(file);
        objectUrls.current.push(url);
        return {
          id: `${Date.now()}-${kind}-${index}`,
          kind, name: file.name, mention: `@${label}${base + index + 1}`, url, size: file.size, file,
        };
      });
      if (added.length < files.length) setError("单个任务最多添加 8 份素材");
      return [...current, ...added];
    });
  }
  function removeAsset(id: string) {
    setAssets((current) => {
      const removed = current.find((item) => item.id === id);
      if (removed) {
        URL.revokeObjectURL(removed.url);
        objectUrls.current = objectUrls.current.filter((url) => url !== removed.url);
      }
      return current.filter((item) => item.id !== id);
    });
  }
  function insertMention(mention: string) {
    setScript((current) => `${current}${current && !current.endsWith(" ") ? " " : ""}${mention} `);
    setMentionOpen(false);
  }
  function buildScript() {
    setError(null);
    if (!brief.trim()) {
      setError("先填写商品、核心卖点和目标人群");
      return;
    }
    const product = assets.find((item) => item.kind === "image")?.mention ?? "@商品主图";
    setScript([
      `【0-2秒｜开场钩子】${product} 快速入画，字幕直接抛出用户痛点。`,
      `【2-6秒｜商品亮相】镜头贴近商品，口播：${brief.trim()}。`,
      "【6-11秒｜卖点演示】用三个短镜头依次展示外观、使用方式和核心优势。",
      `【11-${duration}秒｜行动引导】回到商品全景，口播收束并引导了解详情。`,
    ].join("\n"));
    setNotice("已生成可编辑的本地脚本草稿，未调用模型或扣除积分");
  }
  function persist(next: Draft[]) {
    setDrafts(next);
    try { window.localStorage.setItem(DRAFT_KEY, JSON.stringify(next)); }
    catch { setError("浏览器未允许本地保存，请复制脚本后再离开页面"); }
  }
  function saveDraft() {
    setError(null);
    if (!script.trim()) {
      setError(mode === "assist" ? "请先生成或填写脚本" : "请先填写视频脚本");
      return;
    }
    if (mode === "remix" && counts.video === 0) {
      setError("爆款复刻需要先上传一段参考视频");
      return;
    }
    const now = Date.now();
    const draft: Draft = {
      id: `${now}`, createdAt: now, mode,
      title: script.trim().split("\n")[0].slice(0, 34) || modeLabel(mode),
      script, duration, ratio, resolution, materialCount: assets.length,
    };
    persist([draft, ...drafts].slice(0, 12));
    setNotice("草稿已保存到当前浏览器，尚未发起生成");
  }
  function loadDraft(draft: Draft) {
    setMode(draft.mode); setScript(draft.script); setDuration(draft.duration);
    setRatio(draft.ratio); setResolution(draft.resolution);
    setNotice("已载入草稿，可继续编辑");
    window.scrollTo({ top: 220, behavior: "smooth" });
  }

  async function startGeneration() {
    setError(null);
    setNotice(null);
    setVideoUrl(null);
    if (!script.trim()) {
      setError(mode === "assist" ? "请先生成或填写视频脚本" : "请先填写视频脚本");
      return;
    }
    if (model === "veo") {
      setError("Veo 3 尚未接入，请选择 Seedance 或 Kling");
      return;
    }
    if (mode === "remix" && counts.video === 0) {
      setError("爆款复刻需要先上传一段参考视频");
      return;
    }

    polling.current?.abort();
    const controller = new AbortController();
    polling.current = controller;
    setGenerateStatus("starting");

    const audioInstruction = model === "kling"
      ? "输出无声视频。"
      : !sound && !narration
        ? "不要生成环境声或口播。"
        : narration
          ? `生成${language === "不指定" ? "自然" : language}口播，音色偏${voice}；${sound ? "保留与画面一致的环境声。" : "不要额外环境声。"}`
          : "只生成与画面一致的自然环境声，不要口播。";
    const prompt = [
      "制作一条真实、干净的电商商品短视频。",
      "如果提供了起始商品图，必须保持商品外观、包装结构、颜色、商标和文字一致，不得添加无关配件。",
      `创作模式：${modeLabel(mode)}。`,
      script.trim(),
      audioInstruction,
    ].join("\n");
    const form = new FormData();
    form.set("model", model);
    form.set("prompt", prompt);
    form.set("duration", duration);
    form.set("aspectRatio", ratio);
    form.set("resolution", resolution);
    form.set("generateAudio", sound || narration ? "1" : "0");
    const image = assets.find((asset) => asset.kind === "image");
    if (image) form.set("image", image.file, image.name);

    type VideoResponse = {
      id?: string;
      pollToken?: string;
      status?: string;
      url?: string | null;
      error?: string | null;
    };
    const readResponse = async (response: Response): Promise<VideoResponse> => {
      const body = (await response.json().catch(() => ({}))) as VideoResponse;
      if (!response.ok) throw new Error(body.error || `视频服务请求失败 (${response.status})`);
      return body;
    };
    const complete = (url: string) => {
      setVideoUrl(url);
      setGenerateStatus("succeeded");
      setNotice("视频已生成，可直接预览和下载");
    };

    try {
      let task = await readResponse(await fetch("/api/video", {
        method: "POST",
        body: form,
        signal: controller.signal,
      }));
      if (task.status === "succeeded" && task.url) {
        complete(task.url);
        return;
      }
      if (!task.id || !task.pollToken) throw new Error("视频服务未返回任务编号");
      const taskId = task.id;
      const taskPollToken = task.pollToken;
      setGenerateStatus("processing");
      setNotice("云端正在生成视频，通常需要 1–5 分钟，请保持页面打开");

      for (let attempt = 0; attempt < 200; attempt += 1) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 3000));
        if (controller.signal.aborted) return;
        const params = new URLSearchParams({ id: taskId, token: taskPollToken });
        task = await readResponse(await fetch(`/api/video?${params}`, {
          signal: controller.signal,
          cache: "no-store",
        }));
        if (task.status === "succeeded") {
          if (!task.url) throw new Error("视频任务完成，但未返回视频地址");
          complete(task.url);
          return;
        }
        if (task.status === "failed" || task.status === "canceled") {
          throw new Error(task.error || "视频生成失败，请调整脚本后重试");
        }
      }
      throw new Error("视频生成超时，请稍后重新发起任务");
    } catch (generateError) {
      if (controller.signal.aborted) return;
      setGenerateStatus("failed");
      setNotice(null);
      setError(generateError instanceof Error ? generateError.message : "视频生成失败，请稍后重试");
    } finally {
      if (polling.current === controller) polling.current = null;
    }
  }

  async function downloadVideo() {
    if (!videoUrl) return;
    setError(null);
    try {
      const response = await fetch(videoUrl);
      if (!response.ok) throw new Error("下载失败");
      const blobUrl = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = blobUrl;
      anchor.download = `${BRAND}-视频-${Date.now()}.mp4`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } catch {
      window.open(videoUrl, "_blank", "noopener,noreferrer");
      setNotice("浏览器已打开视频原文件，可在播放器菜单中保存");
    }
  }

  const durationOptions = model === "kling" ? ["5", "10"] : ["5", "8", "10", "12"];
  const generating = generateStatus === "starting" || generateStatus === "processing";

  return (
    <div className="min-h-[100dvh] bg-[#f4f4f5] px-4 pb-16 sm:px-6">
      <section className="mx-auto flex min-h-[258px] max-w-[980px] flex-col items-center justify-center pb-8 pt-16 text-center sm:pt-12">
        <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3.5 py-2 text-[12px] font-semibold text-zinc-700 shadow-[0_1px_2px_rgba(0,0,0,.03)]">
          <Video className="h-4 w-4" /> AI 电商视频工作台
        </div>
        <h1 className="mt-5 max-w-[760px] text-[32px] font-bold tracking-[-1.35px] text-zinc-950 sm:text-[38px] sm:leading-[1.14]">
          把商品素材，组织成一条可执行的视频脚本
        </h1>
        <p className="mt-3 max-w-[660px] text-[14px] leading-6 text-zinc-500 sm:text-[16px]">
          写脚本、引用商品素材、设置画幅与声音，直接生成可预览下载的电商视频。
        </p>
      </section>

      <section className="mx-auto w-full max-w-[980px]">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[12px] text-zinc-500">
            <span className="h-2 w-2 rounded-full bg-emerald-500" /> Seedance 与 Kling 真实接口已接入
          </div>
          <Link href="/admin" className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-zinc-200 bg-white px-3.5 text-[12px] font-semibold text-zinc-700 transition hover:bg-zinc-50">
            <Settings2 className="h-3.5 w-3.5" /> 模型设置
          </Link>
        </div>

        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,656px)_308px]">
          <div className="min-w-0 overflow-hidden rounded-[22px] bg-white shadow-[0_1px_3px_rgba(0,0,0,.045)]">
            <div className="border-b border-zinc-100 p-2.5">
              <div className="grid grid-cols-3 gap-1.5 rounded-[15px] bg-zinc-100 p-1.5">
                {MODES.map((item) => {
                  const Icon = item.icon;
                  const active = mode === item.value;
                  return (
                    <button key={item.value} type="button" onClick={() => { setMode(item.value); setError(null); setNotice(null); }}
                      className={cn("flex min-h-[54px] min-w-0 items-center justify-center gap-2 rounded-[11px] px-2 text-left transition", active ? "bg-white text-zinc-950 shadow-[0_1px_3px_rgba(0,0,0,.08)]" : "text-zinc-500 hover:text-zinc-800")}
                    >
                      <Icon className="h-4 w-4 flex-none" />
                      <span className="min-w-0">
                        <strong className="block truncate text-[12.5px] font-semibold">{item.label}</strong>
                        <small className="hidden truncate text-[10px] font-normal text-zinc-400 sm:block">{item.description}</small>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-7 p-5 sm:p-6">
              <div>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div><h2 className="text-[15px] font-semibold text-zinc-900">创作素材</h2><p className="mt-1 text-[11px] text-zinc-400">最多 8 份，上传后可在脚本中用 @ 引用</p></div>
                  <span className="text-[11px] tabular-nums text-zinc-400">{assets.length}/8</span>
                </div>
                <input ref={imageInput} type="file" multiple accept={ACCEPT.image} className="hidden" onChange={(event) => addFiles("image", event.target.files)} />
                <input ref={videoInput} type="file" multiple accept={ACCEPT.video} className="hidden" onChange={(event) => addFiles("video", event.target.files)} />
                <input ref={audioInput} type="file" multiple accept={ACCEPT.audio} className="hidden" onChange={(event) => addFiles("audio", event.target.files)} />
                <div className="grid grid-cols-3 gap-2.5">
                  <UploadTile title="图片素材" detail="JPG / PNG / WebP" count={counts.image} dragging={dragKind === "image"} icon={<ImageIcon className="h-5 w-5" />} onClick={() => imageInput.current?.click()} onDrag={(active) => setDragKind(active ? "image" : null)} onDrop={(files) => addFiles("image", files)} />
                  <UploadTile title={mode === "remix" ? "爆款参考" : "视频素材"} detail="MP4 / WebM / MOV" count={counts.video} dragging={dragKind === "video"} icon={<Film className="h-5 w-5" />} onClick={() => videoInput.current?.click()} onDrag={(active) => setDragKind(active ? "video" : null)} onDrop={(files) => addFiles("video", files)} />
                  <UploadTile title="音频素材" detail="MP3 / WAV / M4A" count={counts.audio} dragging={dragKind === "audio"} icon={<Music2 className="h-5 w-5" />} onClick={() => audioInput.current?.click()} onDrag={(active) => setDragKind(active ? "audio" : null)} onDrop={(files) => addFiles("audio", files)} />
                </div>
                {assets.length > 0 && (
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {assets.map((asset) => <MaterialRow key={asset.id} asset={asset} onMention={() => insertMention(asset.mention)} onRemove={() => removeAsset(asset.id)} />)}
                  </div>
                )}
              </div>

              <div>
                <div className="mb-2 flex items-end justify-between gap-3">
                  <div>
                    <h2 className="text-[15px] font-semibold text-zinc-900">{mode === "assist" ? "商品信息" : mode === "direct" ? "视频脚本" : "复刻要求"}</h2>
                    <p className="mt-1 text-[11px] text-zinc-400">
                      {mode === "assist" ? "写清商品、卖点和人群，先生成一版可编辑草稿" : mode === "direct" ? "按镜头或时间段描述画面，输入 @ 可引用素材" : "上传参考视频后，说明需要保留的节奏、镜头或口播结构"}
                    </p>
                  </div>
                  {mode === "assist" && <button type="button" onClick={buildScript} className="inline-flex h-8 flex-none items-center gap-1.5 rounded-[9px] bg-zinc-900 px-3 text-[11px] font-semibold text-white hover:bg-zinc-800"><WandSparkles className="h-3.5 w-3.5" /> 生成脚本草稿</button>}
                </div>
                {mode === "assist" && <textarea value={brief} onChange={(event) => setBrief(event.target.value)} placeholder="例如：便携榨汁杯，卖点是轻便、充电快、易清洗，面向通勤和健身人群" className="min-h-[92px] w-full resize-y rounded-[13px] border border-zinc-200 bg-zinc-50 px-3.5 py-3 text-[13px] leading-6 text-zinc-800 outline-none transition placeholder:text-zinc-400 focus:border-zinc-400 focus:bg-white focus:ring-4 focus:ring-zinc-100" />}
                {(mode !== "assist" || script) && (
                  <div className={cn("relative", mode === "assist" && "mt-3")}>
                    <textarea value={script} maxLength={2000} onChange={(event) => { setScript(event.target.value); setMentionOpen(event.target.value.endsWith("@")); }} onKeyDown={(event) => { if (event.key === "Escape") setMentionOpen(false); }}
                      placeholder={mode === "remix" ? "例如：复刻 @视频1 的前三秒钩子，用 @图片1 替换原商品，保留快节奏切镜…" : "例如：【0-3秒】@图片1 从画面下方推进，字幕突出核心卖点…"}
                      className="min-h-[170px] w-full resize-y rounded-[13px] border border-zinc-200 bg-zinc-50 px-3.5 py-3 pr-12 text-[13px] leading-6 text-zinc-800 outline-none transition placeholder:text-zinc-400 focus:border-zinc-400 focus:bg-white focus:ring-4 focus:ring-zinc-100" />
                    <button type="button" onClick={() => setMentionOpen((open) => !open)} className="absolute right-2.5 top-2.5 grid h-8 w-8 place-items-center rounded-[9px] border border-zinc-200 bg-white text-zinc-500 hover:text-zinc-900" aria-label="引用素材" title="引用素材"><AtSign className="h-4 w-4" /></button>
                    {mentionOpen && (
                      <div className="absolute right-2.5 top-12 z-20 w-52 rounded-[12px] border border-zinc-200 bg-white p-1.5 shadow-[0_14px_38px_rgba(24,24,27,.14)]">
                        <p className="px-2 py-1.5 text-[10px] font-semibold text-zinc-400">选择要引用的素材</p>
                        {assets.length ? assets.map((asset) => (
                          <button key={asset.id} type="button" onClick={() => insertMention(asset.mention)} className="flex w-full items-center gap-2 rounded-[8px] px-2 py-2 text-left text-[12px] text-zinc-700 hover:bg-zinc-100">
                            <AssetIcon kind={asset.kind} className="h-3.5 w-3.5 text-zinc-400" /><span className="min-w-0 flex-1 truncate">{asset.mention}</span><span className="max-w-[78px] truncate text-[10px] text-zinc-400">{asset.name}</span>
                          </button>
                        )) : <p className="px-2 py-3 text-[11px] leading-5 text-zinc-400">先在上方添加图片、视频或音频素材</p>}
                      </div>
                    )}
                    <span className="absolute bottom-2.5 right-3 text-[10px] tabular-nums text-zinc-400">{script.length}/2000</span>
                  </div>
                )}
              </div>

              <div className="border-t border-zinc-100 pt-6">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div><h2 className="text-[15px] font-semibold text-zinc-900">生成参数</h2><p className="mt-1 text-[11px] text-zinc-400">参数会随草稿一起保存</p></div>
                  <span className="rounded-md bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700">真实生成</span>
                </div>
                <div className="grid gap-5 sm:grid-cols-2">
                  <Control label="时长"><Segmented value={duration} onChange={setDuration} options={durationOptions} suffix="秒" /></Control>
                  <Control label="画面比例"><Segmented value={ratio} onChange={setRatio} options={["9:16", "1:1", "16:9"]} /></Control>
                  <Control label="分辨率">{model === "kling" ? <div className="flex h-10 items-center rounded-[10px] border border-zinc-200 bg-zinc-50 px-3 text-[11px] font-semibold text-zinc-600">1080P（模型固定）</div> : <Segmented value={resolution} onChange={setResolution} options={["720P", "1080P"]} />}</Control>
                  <Control label="环境声音"><ToggleChoice value={sound} onChange={setSound} onLabel="保留声音" offLabel="静音画面" onIcon={<Volume2 className="h-3.5 w-3.5" />} offIcon={<VolumeX className="h-3.5 w-3.5" />} /></Control>
                  <Control label="智能口播"><ToggleChoice value={narration} onChange={setNarration} onLabel="开启口播" offLabel="关闭口播" onIcon={<Mic2 className="h-3.5 w-3.5" />} offIcon={<X className="h-3.5 w-3.5" />} /></Control>
                  <Control label="口播语言"><Select value={language} onChange={setLanguage} disabled={!narration} options={["普通话", "英语", "粤语", "不指定"]} /></Control>
                  <Control label="口播音色"><Select value={voice} onChange={setVoice} disabled={!narration} options={["自然女声", "活力女声", "沉稳男声", "清朗男声"]} /></Control>
                  <Control label="视频模型">
                    <div className="relative"><select value={model} onChange={(event) => { const next = event.target.value; setModel(next); if (next === "kling") { setDuration((current) => current === "5" || current === "10" ? current : "5"); setResolution("1080P"); } }} className="h-10 w-full appearance-none rounded-[10px] border border-emerald-200 bg-emerald-50 px-3 pr-24 text-[12px] font-medium text-zinc-700 outline-none">{MODELS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select><span className={cn("pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded bg-white px-1.5 py-0.5 text-[9px] font-semibold", model === "veo" ? "text-amber-700" : "text-emerald-700")}>{model === "veo" ? "未支持" : "已接入"}</span></div>
                  </Control>
                </div>
                {model === "kling" && <p className="mt-3 text-[10.5px] leading-5 text-zinc-400">Kling 当前输出无声视频；需要声音时请选择 Seedance。</p>}
                {assets.some((asset) => asset.kind !== "image") && <p className="mt-1 text-[10.5px] leading-5 text-zinc-400">当前模型会读取首张图片作为起始帧；视频和音频素材只用于整理脚本引用。</p>}
              </div>

              {error && <p className="rounded-[11px] border border-red-200 bg-red-50 px-3 py-2.5 text-[12px] leading-5 text-red-700">{error}</p>}
              {notice && <p className="rounded-[11px] border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-[12px] leading-5 text-emerald-700">{notice}</p>}
              <div className="flex flex-col gap-2.5 border-t border-zinc-100 pt-5 sm:flex-row">
                <button type="button" onClick={startGeneration} disabled={generating} className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-[11px] bg-zinc-900 px-5 text-[13px] font-semibold text-white hover:bg-zinc-800 focus:outline-none focus:ring-4 focus:ring-zinc-200 disabled:cursor-wait disabled:opacity-60">{generating ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} {generateStatus === "starting" ? "正在创建任务" : generateStatus === "processing" ? "云端生成中" : "立即生成视频"}</button>
                <button type="button" onClick={saveDraft} disabled={generating} className="inline-flex h-11 items-center justify-center gap-2 rounded-[11px] border border-zinc-200 bg-white px-5 text-[13px] font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"><Save className="h-4 w-4" /> 保存草稿</button>
              </div>
            </div>
          </div>

          <aside className="space-y-4 lg:sticky lg:top-6">
            <div className="overflow-hidden rounded-[22px] bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,.045)]">
              <div className={cn("relative mx-auto grid max-h-[270px] min-h-[188px] place-items-center overflow-hidden rounded-[16px] bg-zinc-950", ratio === "9:16" ? "aspect-[9/12] max-w-[220px]" : ratio === "1:1" ? "aspect-square" : "aspect-video")}>
                {videoUrl ? (
                  <video src={videoUrl} controls playsInline preload="metadata" className="absolute inset-0 h-full w-full object-contain" />
                ) : (
                  <>
                    <div className="absolute inset-0 opacity-60 [background-image:linear-gradient(rgba(255,255,255,.045)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.045)_1px,transparent_1px)] [background-size:24px_24px]" />
                    <div className="relative flex max-w-[220px] flex-col items-center px-5 text-center"><span className="grid h-12 w-12 place-items-center rounded-full bg-white/10 text-white/80">{generating ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <Film className="h-5 w-5" />}</span><strong className="mt-3 text-[13px] font-semibold text-white">{generating ? "云端正在生成" : "等待生成视频"}</strong><p className="mt-1 text-[10px] leading-4 text-zinc-400">{generating ? "生成期间请保持页面打开" : "提交后会在这里显示真实结果"}</p></div>
                    <span className="absolute bottom-2.5 right-2.5 rounded-md bg-black/55 px-2 py-1 text-[9px] font-medium text-white/75">{duration}s · {ratio} · {resolution}</span>
                  </>
                )}
              </div>
              {videoUrl && <button type="button" onClick={downloadVideo} className="mt-3 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-[10px] bg-zinc-900 text-[11px] font-semibold text-white hover:bg-zinc-800"><Download className="h-3.5 w-3.5" /> 下载视频</button>}
              <div className="mt-4 rounded-[13px] bg-zinc-50 p-3.5">
                <div className="flex items-center justify-between text-[11px]"><span className="font-semibold text-zinc-700">当前任务</span><span className={cn(generateStatus === "succeeded" ? "text-emerald-700" : generateStatus === "failed" ? "text-red-600" : generating ? "text-sky-700" : "text-zinc-400")}>{generateStatus === "succeeded" ? "已完成" : generateStatus === "failed" ? "失败" : generating ? "生成中" : "待提交"}</span></div>
                <div className="mt-3 space-y-2 text-[10.5px] text-zinc-500">
                  <StatusLine done={script.trim().length > 0}>脚本已填写</StatusLine>
                  <StatusLine done={assets.length > 0}>{assets.length ? `已添加 ${assets.length} 份素材` : "可选素材未添加"}</StatusLine>
                  <StatusLine done={generateStatus === "succeeded"}>{generateStatus === "succeeded" ? "真实视频已返回" : generating ? "真实模型正在处理" : "等待发起真实生成"}</StatusLine>
                </div>
              </div>
            </div>

            <div className="rounded-[22px] bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,.045)]">
              <div className="flex items-center justify-between"><div className="flex items-center gap-2"><Clock3 className="h-4 w-4 text-zinc-400" /><h2 className="text-[13px] font-semibold text-zinc-900">创作历史</h2></div><span className="text-[10px] text-zinc-400">本机草稿</span></div>
              {drafts.length ? (
                <div className="mt-3 max-h-[330px] space-y-2 overflow-y-auto pr-0.5">
                  {drafts.map((draft) => (
                    <div key={draft.id} className="group rounded-[12px] border border-zinc-100 bg-zinc-50 p-3 hover:border-zinc-200">
                      <button type="button" onClick={() => loadDraft(draft)} className="block w-full text-left"><span className="flex items-center justify-between gap-2"><strong className="text-[11px] font-semibold text-zinc-800">{modeLabel(draft.mode)}</strong><small className="text-[9px] text-zinc-400">{draftTime(draft.createdAt)}</small></span><span className="mt-1.5 block truncate text-[11px] text-zinc-600">{draft.title}</span><span className="mt-2 flex items-center gap-2 text-[9.5px] text-zinc-400"><span>{draft.duration}s</span><span>{draft.ratio}</span><span>{draft.resolution}</span><span>{draft.materialCount} 素材</span></span></button>
                      <div className="mt-2 flex items-center justify-between border-t border-zinc-200/70 pt-2"><span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[9px] font-medium text-zinc-500">本机草稿</span><button type="button" onClick={() => persist(drafts.filter((item) => item.id !== draft.id))} className="grid h-6 w-6 place-items-center rounded-md text-zinc-400 opacity-0 hover:bg-white hover:text-red-500 group-hover:opacity-100 focus:opacity-100" aria-label="删除草稿"><Trash2 className="h-3.5 w-3.5" /></button></div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-3 flex min-h-[132px] flex-col items-center justify-center rounded-[14px] border border-dashed border-zinc-200 bg-zinc-50 px-5 text-center"><Clock3 className="h-5 w-5 text-zinc-300" /><p className="mt-2 text-[11px] text-zinc-500">还没有草稿</p><p className="mt-1 text-[9.5px] leading-4 text-zinc-400">保存后会出现在这里，可随时继续编辑</p></div>
              )}
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}

function UploadTile({ title, detail, count, dragging, icon, onClick, onDrag, onDrop }: {
  title: string; detail: string; count: number; dragging: boolean; icon: ReactNode;
  onClick: () => void; onDrag: (active: boolean) => void; onDrop: (files: FileList) => void;
}) {
  function drop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault(); onDrag(false); onDrop(event.dataTransfer.files);
  }
  return <button type="button" onClick={onClick} onDragOver={(event) => { event.preventDefault(); onDrag(true); }} onDragLeave={() => onDrag(false)} onDrop={drop}
    className={cn("relative flex min-h-[92px] flex-col items-center justify-center rounded-[13px] border border-dashed px-2 text-center transition", dragging ? "border-zinc-700 bg-zinc-100" : "border-zinc-200 bg-zinc-50 hover:border-zinc-400 hover:bg-zinc-100")}
  ><span className="text-zinc-500">{icon}</span><strong className="mt-1.5 text-[11px] font-semibold text-zinc-700">{title}</strong><span className="mt-0.5 hidden text-[8.5px] text-zinc-400 sm:block">{detail}</span>{count ? <span className="absolute right-2 top-2 grid h-5 min-w-5 place-items-center rounded-full bg-zinc-900 px-1 text-[9px] font-bold text-white">{count}</span> : <Plus className="absolute right-2 top-2 h-3.5 w-3.5 text-zinc-300" />}</button>;
}

function MaterialRow({ asset, onMention, onRemove }: { asset: MaterialAsset; onMention: () => void; onRemove: () => void }) {
  return <div className="flex min-w-0 items-center gap-2.5 rounded-[11px] border border-zinc-100 bg-zinc-50 p-2">
    {asset.kind === "image" ? (
      // Browser object URLs cannot be passed through the Next image optimizer.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={asset.url} alt="" className="h-10 w-10 flex-none rounded-[8px] object-cover" />
    ) : <span className="grid h-10 w-10 flex-none place-items-center rounded-[8px] bg-white text-zinc-500"><AssetIcon kind={asset.kind} className="h-4 w-4" /></span>}
    <button type="button" onClick={onMention} className="min-w-0 flex-1 text-left"><strong className="block text-[10.5px] font-semibold text-zinc-700">{asset.mention}</strong><span className="mt-0.5 block truncate text-[9px] text-zinc-400">{asset.name} · {fileSize(asset.size)}</span></button>
    <button type="button" onClick={onRemove} className="grid h-7 w-7 flex-none place-items-center rounded-[7px] text-zinc-400 hover:bg-white hover:text-red-500" aria-label="删除素材"><X className="h-3.5 w-3.5" /></button>
  </div>;
}
function AssetIcon({ kind, className }: { kind: AssetKind; className?: string }) {
  return kind === "image" ? <FileImage className={className} /> : kind === "audio" ? <FileAudio className={className} /> : <FileVideo className={className} />;
}
function Control({ label, children }: { label: string; children: ReactNode }) {
  return <div><label className="mb-2 block text-[11px] font-semibold text-zinc-600">{label}</label>{children}</div>;
}
function Segmented({ value, onChange, options, suffix = "" }: { value: string; onChange: (value: string) => void; options: string[]; suffix?: string }) {
  return <div className="grid h-10 grid-flow-col auto-cols-fr gap-1 rounded-[10px] bg-zinc-100 p-1">{options.map((option) => <button key={option} type="button" onClick={() => onChange(option)} className={cn("rounded-[7px] px-1 text-[10.5px] font-semibold transition", value === option ? "bg-white text-zinc-900 shadow-[0_1px_2px_rgba(0,0,0,.08)]" : "text-zinc-500 hover:text-zinc-800")}>{option}{suffix}</button>)}</div>;
}
function ToggleChoice({ value, onChange, onLabel, offLabel, onIcon, offIcon }: { value: boolean; onChange: (value: boolean) => void; onLabel: string; offLabel: string; onIcon: ReactNode; offIcon: ReactNode }) {
  return <button type="button" onClick={() => onChange(!value)} className="flex h-10 w-full items-center justify-between rounded-[10px] border border-zinc-200 bg-zinc-50 px-3 text-[11px] font-semibold text-zinc-700"><span className="flex items-center gap-1.5">{value ? onIcon : offIcon}{value ? onLabel : offLabel}</span><span className={cn("relative h-5 w-9 rounded-full transition", value ? "bg-zinc-900" : "bg-zinc-300")}><span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition", value ? "left-[18px]" : "left-0.5")} /></span></button>;
}
function Select({ value, onChange, options, disabled }: { value: string; onChange: (value: string) => void; options: string[]; disabled?: boolean }) {
  return <select value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} className="h-10 w-full rounded-[10px] border border-zinc-200 bg-zinc-50 px-3 text-[12px] font-medium text-zinc-700 outline-none disabled:cursor-not-allowed disabled:opacity-45">{options.map((option) => <option key={option}>{option}</option>)}</select>;
}
function StatusLine({ done, children }: { done: boolean; children: ReactNode }) {
  return <div className="flex items-center gap-2"><span className={cn("grid h-4 w-4 flex-none place-items-center rounded-full", done ? "bg-emerald-100 text-emerald-700" : "bg-zinc-200 text-zinc-400")}>{done ? <Check className="h-2.5 w-2.5" strokeWidth={3} /> : <span className="h-1 w-1 rounded-full bg-current" />}</span><span>{children}</span></div>;
}
