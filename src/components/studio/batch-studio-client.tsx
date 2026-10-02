"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Download,
  History,
  Image as ImageIcon,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { FRIENDS_MODE } from "@/lib/friends-mode";
import { useAuthModal } from "@/lib/auth-modal-context";
import { authHeader } from "@/lib/supabase";
import { BRAND } from "@/lib/brand";

type BatchResult = {
  id: string;
  label: string;
  status: "pending" | "done" | "error";
  url?: string | null;
};

type BatchItem = {
  id: string;
  files: File[];
  previews: string[];
  requirements: string;
  status: "idle" | "queued" | "running" | "done" | "error";
  progress: number;
  results: BatchResult[];
  error?: string;
};

const createItem = (): BatchItem => ({
  id: crypto.randomUUID(),
  files: [],
  previews: [],
  requirements: "",
  status: "idle",
  progress: 0,
  results: [],
});

function pause(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function BatchStudioClient() {
  const { user, ready } = useAuth();
  const { openAuth } = useAuthModal();
  const [items, setItems] = useState<BatchItem[]>([createItem()]);
  const [imageType, setImageType] = useState<"main" | "detail">("main");
  const [platform, setPlatform] = useState("taobao");
  const [language, setLanguage] = useState("简体中文");
  const [ratio, setRatio] = useState("1:1");
  const [resolution, setResolution] = useState("1K");
  const [expert, setExpert] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => () => {
    alive.current = false;
    items.forEach((item) => item.previews.forEach((url) => URL.revokeObjectURL(url)));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const estimated = items.length * 78;
  const valid = items.every((item) => item.files.length > 0);
  const completed = items.filter((item) => item.status === "done").length;

  function patchItem(id: string, patch: Partial<BatchItem>) {
    setItems((old) => old.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  function addFiles(id: string, list: FileList | null) {
    if (!list?.length) return;
    setItems((old) => old.map((item) => {
      if (item.id !== id) return item;
      const files = [...item.files, ...Array.from(list)].slice(0, 6);
      const added = files.slice(item.files.length).map((file) => URL.createObjectURL(file));
      return { ...item, files, previews: [...item.previews, ...added], error: undefined };
    }));
  }

  function removeFile(id: string, index: number) {
    setItems((old) => old.map((item) => {
      if (item.id !== id) return item;
      URL.revokeObjectURL(item.previews[index]);
      return {
        ...item,
        files: item.files.filter((_, i) => i !== index),
        previews: item.previews.filter((_, i) => i !== index),
      };
    }));
  }

  function removeItem(id: string) {
    setItems((old) => {
      const target = old.find((item) => item.id === id);
      target?.previews.forEach((url) => URL.revokeObjectURL(url));
      const next = old.filter((item) => item.id !== id);
      return next.length ? next : [createItem()];
    });
  }

  async function poll(jobId: string, itemId: string) {
    for (let attempt = 0; attempt < 240 && alive.current; attempt++) {
      await pause(2500);
      const response = await fetch(`/api/suite?job=${encodeURIComponent(jobId)}`, { cache: "no-store" });
      const data = await response.json();
      const results = Array.isArray(data.shots) ? data.shots as BatchResult[] : [];
      const total = Number(data.total || 13);
      const done = Number(data.done || 0);
      patchItem(itemId, { results, progress: Math.round((done / total) * 100) });
      if (data.status === "done") {
        patchItem(itemId, { status: "done", progress: 100, results });
        return;
      }
      if (data.status === "error") throw new Error(data.error || "任务生成失败");
    }
    throw new Error("任务等待超时，请稍后在历史记录中查看");
  }

  async function runItem(item: BatchItem) {
    patchItem(item.id, { status: "running", progress: 2, results: [], error: undefined });
    const form = new FormData();
    item.files.forEach((file) => form.append("image", file));
    const requirements = [
      item.requirements.trim(),
      `图片类型：${imageType === "main" ? "主图" : "详情图"}`,
      `目标语言：${language}`,
      `尺寸：${ratio}`,
      `清晰度：${resolution}`,
      expert ? "使用专家分析" : "",
    ].filter(Boolean).join("；");
    form.append("text", requirements);
    form.append("platform", platform);
    form.append("outputType", imageType);
    form.append("ratio", ratio);
    form.append("resolution", resolution);
    form.append("expert", String(expert));
    form.append("count", imageType === "main" ? "1" : "4");
    if (user?.email) form.append("email", user.email);
    const response = await fetch("/api/suite", {
      method: "POST",
      headers: await authHeader(),
      body: form,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "任务创建失败");
    await poll(String(data.jobId), item.id);
  }

  async function submitAll() {
    setConfirming(false);
    setGlobalError(null);
    if (!user && !FRIENDS_MODE) {
      openAuth("sign-in");
      return;
    }
    if (!valid) {
      setGlobalError("请为每个任务至少上传一张产品图");
      return;
    }
    setSubmitting(true);
    setItems((old) => old.map((item) => ({ ...item, status: "queued", progress: 0, error: undefined })));
    const snapshot = [...items];
    for (const item of snapshot) {
      try {
        await runItem(item);
      } catch (error) {
        patchItem(item.id, {
          status: "error",
          error: error instanceof Error ? error.message : "任务生成失败",
        });
      }
    }
    if (alive.current) setSubmitting(false);
  }

  async function downloadResults(item: BatchItem) {
    const selected = item.results.filter((result) => result.status === "done" && result.url);
    if (!selected.length) return;
    const response = await fetch("/api/suite/download", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeader()) },
      body: JSON.stringify({ items: selected.map((result) => ({ url: result.url, name: result.label })) }),
    });
    if (!response.ok) return;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${BRAND}-批量任务-${Date.now()}.zip`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const summary = useMemo(() => {
    if (!submitting) return FRIENDS_MODE ? `${items.length} 个任务，按顺序处理` : `${items.length} 个任务，预计消耗 ${estimated} 积分`;
    return `正在处理 ${completed + 1}/${items.length}，已完成 ${completed} 个任务`;
  }, [completed, estimated, items.length, submitting]);

  if (!ready) return <div className="grid min-h-screen place-items-center"><Loader2 className="h-6 w-6 animate-spin text-zinc-400" /></div>;

  return (
    <div className="min-h-screen bg-[#f4f4f5] px-4 pb-14 sm:px-6">
      <main className="mx-auto max-w-6xl">
        <section className="flex flex-col gap-4 py-7 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-zinc-900">批量任务管理</h1>
            <p className="mt-2 text-sm text-zinc-500">一次配置多个商品任务，统一提交并自动排队生成</p>
          </div>
          <Link href="/history" className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-700 no-underline shadow-sm">
            <History className="h-4 w-4" />任务历史
          </Link>
        </section>

        <div className="mt-1 grid grid-cols-2 gap-2 rounded-2xl border border-zinc-200 bg-white p-1.5 shadow-sm" role="tablist">
          <button className={`h-12 rounded-xl text-base font-semibold ${imageType === "main" ? "bg-zinc-900 text-white" : "text-zinc-600"}`} onClick={() => setImageType("main")}>主图</button>
          <button className={`h-12 rounded-xl text-base font-semibold ${imageType === "detail" ? "bg-zinc-900 text-white" : "text-zinc-600"}`} onClick={() => setImageType("detail")}>详情图</button>
        </div>

        <section className="mt-6 rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="mb-5 flex items-center gap-2"><Sparkles className="h-4 w-4" /><h2 className="text-sm font-semibold">全局参数</h2></div>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <BatchSelect label="目标平台" value={platform} onChange={setPlatform} options={[{ v: "taobao", l: "淘宝 / 天猫" }, { v: "douyin", l: "抖音 / 小红书" }, { v: "tiktok", l: "TikTok Shop" }, { v: "amazon", l: "Amazon" }]} />
            <BatchSelect label="目标语言" value={language} onChange={setLanguage} options={[{ v: "简体中文", l: "简体中文" }, { v: "English", l: "English" }, { v: "日本語", l: "日本語" }]} />
            <BatchSelect label="尺寸比例" value={ratio} onChange={setRatio} options={[{ v: "1:1", l: "1:1 方形" }, { v: "3:4", l: "3:4 竖版" }, { v: "4:3", l: "4:3 横版" }]} />
            <BatchSelect label="清晰度" value={resolution} onChange={setResolution} options={[{ v: "1K", l: "1K 标准" }, { v: "2K", l: "2K 高清" }, { v: "4K", l: "4K 超清" }]} />
          </div>
          <label className="mt-5 flex items-center justify-between border-t border-zinc-100 pt-4 text-xs text-zinc-500">
            <span>开启后会进行更深入的商品分析与分镜规划</span>
            <span className="flex items-center gap-2"><span>专家模式</span><input type="checkbox" checked={expert} onChange={(event) => setExpert(event.target.checked)} className="h-4 w-4 accent-zinc-900" /></span>
          </label>
        </section>

        <section className="mt-6 space-y-4">
          {items.map((item, index) => (
            <article key={item.id} id={`batch-task-${item.id}`} className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6">
              <header className="mb-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3"><span className="grid h-8 w-8 place-items-center rounded-full bg-zinc-100 text-xs font-bold">{index + 1}</span><div><h2 className="text-sm font-semibold">商品任务 {index + 1}</h2><p className="text-xs text-zinc-400">每个任务最多上传 6 张商品角度图</p></div></div>
                <button type="button" disabled={submitting} onClick={() => removeItem(item.id)} className="grid h-9 w-9 place-items-center rounded-xl text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"><Trash2 className="h-4 w-4" /></button>
              </header>
              <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
                <label className="flex min-h-32 cursor-pointer items-center justify-center rounded-2xl border-2 border-dashed border-zinc-300 bg-zinc-50 p-3 hover:border-zinc-700">
                  <input type="file" multiple accept="image/jpeg,image/png,image/webp" className="hidden" disabled={submitting} onChange={(event) => addFiles(item.id, event.target.files)} />
                  {item.previews.length ? <div className="grid w-full grid-cols-3 gap-2">{item.previews.map((url, imageIndex) => <div key={url} className="group relative aspect-square overflow-hidden rounded-xl bg-zinc-100"><img src={url} alt="" className="h-full w-full object-cover" /><button type="button" onClick={(event) => { event.preventDefault(); removeFile(item.id, imageIndex); }} className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-black/70 text-white"><X className="h-3 w-3" /></button></div>)}{item.files.length < 6 && <span className="grid aspect-square place-items-center rounded-xl border border-dashed border-zinc-300"><Plus className="h-5 w-5" /></span>}</div> : <span className="flex flex-col items-center gap-2 text-center text-xs text-zinc-500"><Upload className="h-6 w-6" />上传产品图<br />干净白底图效果最佳</span>}
                </label>
                <div className="flex min-w-0 flex-col gap-3">
                  <label className="text-xs font-medium text-zinc-500">商品要求</label>
                  <textarea value={item.requirements} onChange={(event) => patchItem(item.id, { requirements: event.target.value })} disabled={submitting} className="min-h-24 flex-1 resize-y rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm outline-none focus:border-zinc-400" placeholder="填写商品名称、卖点、人群、场景与需要保留的细节" />
                  {item.status !== "idle" && <div className="flex items-center gap-3"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-100"><span className="block h-full rounded-full bg-zinc-900" style={{ width: `${item.progress}%` }} /></div><span className="text-xs text-zinc-500">{item.status === "queued" ? "排队中" : item.status === "running" ? `${item.progress}%` : item.status === "done" ? "已完成" : "失败"}</span></div>}
                  {item.error && <p className="text-xs text-red-600">{item.error}</p>}
                </div>
              </div>
              {item.results.some((result) => result.status === "done" && result.url) && <div className="mt-5 border-t border-zinc-100 pt-4"><div className="mb-3 flex items-center justify-between"><span className="flex items-center gap-2 text-sm font-semibold"><ImageIcon className="h-4 w-4" />生成结果</span><button onClick={() => downloadResults(item)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-200 px-3 text-xs font-semibold"><Download className="h-3.5 w-3.5" />下载 ZIP</button></div><div className="grid grid-cols-3 gap-2 sm:grid-cols-6">{item.results.filter((result) => result.status === "done" && result.url).map((result) => <img key={result.id} src={result.url!} alt={result.label} className="aspect-square w-full rounded-xl bg-zinc-100 object-cover" />)}</div></div>}
            </article>
          ))}

          <button type="button" disabled={submitting} onClick={() => setItems((old) => [...old, createItem()])} className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-white text-sm font-semibold text-zinc-700 shadow-sm"><Plus className="h-4 w-4" />添加商品任务</button>

          <div className="sticky bottom-3 z-20 space-y-3 rounded-3xl border border-zinc-200 bg-white/95 p-4 shadow-lg backdrop-blur">
            <p className="text-center text-sm text-zinc-500">{summary}</p>
            {globalError && <p className="text-center text-xs text-red-600">{globalError}</p>}
            <button type="button" disabled={submitting} onClick={() => (user || FRIENDS_MODE) ? setConfirming(true) : openAuth("sign-in")} className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-zinc-900 text-base font-semibold text-white disabled:opacity-60">{submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}{submitting ? "批量任务处理中" : "提交批量任务"}</button>
          </div>
        </section>
      </main>

      {confirming && <div className="fixed inset-0 z-[90] grid place-items-center bg-black/30 p-4"><div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl"><h2 className="text-lg font-bold">确认提交批量任务</h2><p className="mt-2 text-sm leading-6 text-zinc-500">将提交 {items.length} 个商品任务，按顺序排队处理。</p><div className="mt-6 flex justify-end gap-2"><button onClick={() => setConfirming(false)} className="h-10 rounded-xl border border-zinc-200 px-4 text-sm font-semibold">取消</button><button onClick={submitAll} className="flex h-10 items-center gap-2 rounded-xl bg-zinc-900 px-4 text-sm font-semibold text-white"><Check className="h-4 w-4" />确认提交</button></div></div></div>}
    </div>
  );
}

function BatchSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: { v: string; l: string }[] }) {
  return <label className="space-y-1.5 text-xs font-medium text-zinc-500"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className="h-10 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-xs text-zinc-800 outline-none">{options.map((option) => <option key={option.v} value={option.v}>{option.l}</option>)}</select></label>;
}
