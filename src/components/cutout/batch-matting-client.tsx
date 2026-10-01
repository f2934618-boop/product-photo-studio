"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import JSZip from "jszip";
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
import { useAuth, type SessionUser } from "@/lib/auth-context";
import { downloadImage } from "@/lib/download";
import { authHeader } from "@/lib/supabase";
import { cn } from "@/lib/utils";

const MAX_FILES = 50;
const MAX_FILE_SIZE = 12 * 1024 * 1024;
const RATIO_OPTIONS = [
  { value: "1:1", label: "1:1 方形" },
  { value: "3:4", label: "3:4 竖版" },
  { value: "4:3", label: "4:3 横版" },
  { value: "9:16", label: "9:16 竖屏" },
  { value: "16:9", label: "16:9 横屏" },
];

type ResultImage = {
  id: string;
  url: string;
  name: string;
  status: "done" | "error";
};

type CutoutResponse = {
  id?: string;
  url?: string;
  error?: string;
  user?: SessionUser | null;
};

type ProductReshootResponse = {
  image?: string;
  error?: string;
};

class RemoteCutoutError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly allowLocalFallback: boolean
  ) {
    super(message);
    this.name = "RemoteCutoutError";
  }
}

let localCutoutWorker: Worker | null = null;
let localCutoutRequest = 0;

function cutoutLocally(
  file: File,
  whiteBackground: boolean,
  ratio: string,
  onProgress: (value: number) => void
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
        bytes?: ArrayBuffer;
        error?: string;
      };
      if (data.id !== id) return;
      if (data.kind === "progress") {
        onProgress(data.value ?? 0);
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
      worker.postMessage(
        { id, bytes, type: file.type || "image/png", whiteBackground, ratio },
        [bytes]
      );
    } catch (error) {
      worker.removeEventListener("message", listener);
      reject(error);
    }
  });
}

function resultName(fileName: string, index: number) {
  const stem = fileName.replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]/g, "_");
  return `${String(index + 1).padStart(2, "0")}-${stem || `cutout-${index + 1}`}.png`;
}

async function fetchImage(url: string, name: string) {
  const source =
    url.startsWith("blob:") || url.startsWith("data:")
      ? url
      : `/api/download?u=${encodeURIComponent(url)}&n=${encodeURIComponent(name)}`;
  const response = await fetch(source);
  if (!response.ok) throw new Error(`下载 ${name} 失败`);
  return response.arrayBuffer();
}

export function BatchMattingClient() {
  const { user, applyServerUser } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const previewUrls = useRef<string[]>([]);
  const localResultUrls = useRef<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");
  const [ratio, setRatio] = useState("3:4");
  const [mode, setMode] = useState<"cutout" | "reshoot">("cutout");
  const [aiQuality, setAiQuality] = useState<"standard" | "quality">(
    "standard"
  );
  const [whiteBackground, setWhiteBackground] = useState(true);
  const [busy, setBusy] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<ResultImage[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    previewUrls.current = previews;
  }, [previews]);

  useEffect(() => {
    return () => {
      previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
      localResultUrls.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const accepted = Array.from(list)
      .filter((file) => file.type.startsWith("image/") && file.size <= MAX_FILE_SIZE)
      .slice(0, Math.max(0, MAX_FILES - files.length));
    if (!accepted.length) return;
    setFiles((current) => [...current, ...accepted]);
    setPreviews((current) => [
      ...current,
      ...accepted.map((file) => URL.createObjectURL(file)),
    ]);
    setErrors([]);
    setResults([]);
    setSelected(new Set());
  }

  function removeAt(index: number) {
    URL.revokeObjectURL(previews[index]);
    setFiles((current) => current.filter((_, i) => i !== index));
    setPreviews((current) => current.filter((_, i) => i !== index));
    setResults([]);
    setSelected(new Set());
  }

  function clearFiles() {
    previews.forEach((url) => URL.revokeObjectURL(url));
    setFiles([]);
    setPreviews([]);
    setResults([]);
    setSelected(new Set());
  }

  async function requestRemote(file: File) {
    const fd = new FormData();
    fd.append("image", file);
    fd.append("quality", "fine");
    fd.append("category", "cutout");
    fd.append("title", file.name);
    fd.append("background", whiteBackground ? "white" : "transparent");
    fd.append("ratio", ratio);
    fd.append("resolution", "2K");
    if (user?.email) fd.append("email", user.email);

    let response: Response;
    try {
      response = await fetch("/api/cutout", {
        method: "POST",
        headers: await authHeader(),
        body: fd,
      });
    } catch {
      throw new RemoteCutoutError("网络不可用，已尝试本地抠图", null, true);
    }

    let data: CutoutResponse = {};
    try {
      data = (await response.json()) as CutoutResponse;
    } catch {
      // 状态码仍决定是否允许本地回退。
    }
    if (!response.ok) {
      throw new RemoteCutoutError(
        data.error || `抠图失败（${response.status}）`,
        response.status,
        response.status === 401 ||
          (response.status >= 500 && response.status <= 599)
      );
    }
    if (!data.url) {
      throw new RemoteCutoutError(data.error || "抠图服务未返回结果", response.status, false);
    }
    return data;
  }

  async function requestProductReshoot(file: File) {
    const fd = new FormData();
    fd.append("image", file);
    fd.append("ratio", ratio);
    fd.append("quality", aiQuality);
    if (prompt.trim()) fd.append("prompt", prompt.trim());

    let response: Response;
    try {
      response = await fetch("/api/product-reshoot", {
        method: "POST",
        body: fd,
      });
    } catch {
      throw new RemoteCutoutError("高质量生成服务连接失败，请稍后重试", null, false);
    }

    let data: ProductReshootResponse = {};
    try {
      data = (await response.json()) as ProductReshootResponse;
    } catch {
      // 统一在下方按 HTTP 状态生成可读错误。
    }
    if (!response.ok) {
      throw new RemoteCutoutError(
        data.error || `高质量生成失败（${response.status}）`,
        response.status,
        false
      );
    }
    if (!data.image) {
      throw new RemoteCutoutError(
        data.error || "高质量生成服务未返回图片",
        response.status,
        false
      );
    }
    return data.image;
  }

  async function runMatting() {
    if (!files.length) {
      setErrors(["请先上传待抠图片"]);
      return;
    }
    localResultUrls.current.forEach((url) => URL.revokeObjectURL(url));
    localResultUrls.current = [];
    setBusy(true);
    setProgress(0);
    setErrors([]);
    setResults([]);
    setSelected(new Set());
    const next: ResultImage[] = [];
    const messages: string[] = [];

    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      const runLocal = async (): Promise<ResultImage> => {
        const localUrl = await cutoutLocally(file, whiteBackground, ratio, (value) => {
          setProgress(
            Math.round(((index + value / 100) / files.length) * 100)
          );
        });
        localResultUrls.current.push(localUrl);
        return {
          id: `local-cut-${index}`,
          url: localUrl,
          name: resultName(file.name, index),
          status: "done",
        };
      };
      try {
        if (mode === "reshoot") {
          const image = await requestProductReshoot(file);
          next.push({
            id: `reshoot-${index}-${Date.now()}`,
            url: image,
            name: resultName(file.name, index),
            status: "done",
          });
          setResults([...next]);
          setProgress(Math.round(((index + 1) / files.length) * 100));
          continue;
        }
        // 访客直接在浏览器本地处理：不需要登录，也不会把原图上传到服务器。
        if (!user?.email) {
          next.push(await runLocal());
          setResults([...next]);
          setProgress(Math.round(((index + 1) / files.length) * 100));
          continue;
        }
        const data = await requestRemote(file);
        next.push({
          id: data.id || `cut-${index}`,
          url: data.url!,
          name: resultName(file.name, index),
          status: "done",
        });
        if (data.user) applyServerUser(data.user);
      } catch (error) {
        const remoteError =
          error instanceof RemoteCutoutError
            ? error
            : new RemoteCutoutError(
                error instanceof Error ? error.message : "抠图失败",
                null,
                false
              );
        if (remoteError.allowLocalFallback) {
          try {
            next.push(await runLocal());
          } catch (localError) {
            messages.push(
              localError instanceof Error ? localError.message : remoteError.message
            );
            next.push({
              id: `cut-${index}`,
              url: previews[index],
              name: resultName(file.name, index),
              status: "error",
            });
          }
        } else {
          // 付费、封禁、限流等业务错误直接展示；本地模型不消耗云端资源。
          messages.push(remoteError.message);
          next.push({
            id: `cut-${index}`,
            url: previews[index],
            name: resultName(file.name, index),
            status: "error",
          });
          if (
            remoteError.status === 402 ||
            remoteError.status === 403 ||
            remoteError.status === 429 ||
            remoteError.status === 503
          ) {
            setResults([...next]);
            setErrors([...new Set(messages)]);
            break;
          }
        }
      }
      setResults([...next]);
      setErrors([...new Set(messages)]);
      setProgress(Math.round(((index + 1) / files.length) * 100));
    }
    setBusy(false);
  }

  async function downloadAll() {
    const list = results.filter(
      (result) =>
        result.status === "done" && (!selected.size || selected.has(result.id))
    );
    if (!list.length) return;
    setZipping(true);
    try {
      const zip = new JSZip();
      const failed: string[] = [];
      await Promise.all(
        list.map(async (result) => {
          try {
            zip.file(result.name, await fetchImage(result.url, result.name));
          } catch {
            failed.push(result.name);
          }
        })
      );
      if (Object.keys(zip.files).length === 0) throw new Error("图片下载失败");
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `批量抠图-${Date.now()}.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      if (failed.length) setErrors([`以下图片未能加入 ZIP：${failed.join("、")}`]);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "ZIP 生成失败"]);
    } finally {
      setZipping(false);
    }
  }

  return (
    <div className="studio-page">
      <section className="studio-hero">
        <span className="studio-kicker"><Sparkles />商品白底图</span>
        <h1>快速抠图或 AI 商品重拍</h1>
        <p>快速模式保留原图像素；AI 重拍会清除手持与街景，并生成棚拍白底和自然接地阴影</p>
      </section>

      <section className="studio-workspace">
        <div className="studio-flow-row without-steps">
          <button className="studio-batch" type="button" onClick={() => inputRef.current?.click()}>
            <Plus />创建批量任务<em>NEW</em>
          </button>
        </div>

        <div className="studio-grid without-steps">
          <div className="studio-left">
            <UploadCard
              files={files}
              previews={previews}
              inputRef={inputRef}
              onAdd={addFiles}
              onRemove={removeAt}
              onClear={clearFiles}
            />

            <section className="studio-card studio-form-card">
              <div className="studio-field">
                <label>处理模式</label>
                <div className="studio-segmented">
                  <button
                    type="button"
                    className={mode === "cutout" ? "is-active" : ""}
                    onClick={() => setMode("cutout")}
                  >
                    快速抠图
                  </button>
                  <button
                    type="button"
                    className={mode === "reshoot" ? "is-active" : ""}
                    onClick={() => {
                      setMode("reshoot");
                      setWhiteBackground(true);
                    }}
                  >
                    AI 商品重拍
                  </button>
                </div>
                <p className="text-xs leading-5 text-muted-foreground">
                  {mode === "cutout"
                    ? "浏览器本地处理，速度快，商品内容保持原样。"
                    : "生成式重拍会补全遮挡并改善构图、灯光和阴影，包装文字可能有细微变化。"}
                </p>
              </div>

              <div className="studio-field studio-prompt-field">
                <div className="studio-label-row"><label>{mode === "reshoot" ? "补充要求（选填）" : "边缘处理"}</label></div>
                <textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  rows={4}
                  placeholder={mode === "reshoot" ? "例如：保持正面视角，阴影更轻" : "默认保留发丝、透明材质和商品边缘细节"}
                />
                <button
                  className="studio-ai-write"
                  type="button"
                  onClick={() => setPrompt(mode === "reshoot" ? "保持商品原有视角和包装细节，使用柔和棚拍灯光与轻微接地阴影。" : "保留发丝、半透明材质、镂空、细小配件和真实边缘，主体外内容全部移除。")}
                >
                  <Wand2 />AI帮写
                </button>
              </div>

              <div className="studio-two-fields">
                <SelectField label="尺寸比例" value={ratio} onChange={setRatio} options={RATIO_OPTIONS} />
                {mode === "reshoot" ? (
                  <SelectField
                    label="AI 质量"
                    value={aiQuality}
                    onChange={(value) => setAiQuality(value === "quality" ? "quality" : "standard")}
                    options={[
                      { value: "standard", label: "标准 4B（推荐）" },
                      { value: "quality", label: "精细 9B（额度消耗更高）" },
                    ]}
                  />
                ) : (
                  <SelectField
                    label="输出背景"
                    value={whiteBackground ? "白色背景" : "透明背景"}
                    onChange={(value) => setWhiteBackground(value === "白色背景")}
                    options={["透明背景", "白色背景"]}
                  />
                )}
              </div>

              {errors.length > 0 && (
                <div className="studio-error">
                  {errors.map((message) => <div key={message}>{message}</div>)}
                </div>
              )}
              <button
                className="studio-primary batch-start-button"
                type="button"
                disabled={busy || files.length === 0}
                aria-busy={busy}
                aria-describedby={files.length === 0 ? "batch-matting-start-hint" : undefined}
                onClick={runMatting}
              >
                {busy ? <Loader2 className="animate-spin" /> : files.length ? <Sparkles /> : <Upload />}
                {busy
                  ? `${mode === "reshoot" ? "AI 重拍中" : "处理中"} ${progress}%`
                  : files.length
                    ? `${mode === "reshoot" ? "开始 AI 商品重拍" : "开始抠图"}（${files.length} 张）`
                    : "请先上传图片"}
              </button>
              {files.length === 0 && (
                <p id="batch-matting-start-hint" className="batch-start-hint">
                  上传 1–50 张图片后即可开始处理
                </p>
              )}
            </section>
          </div>

          <section className="studio-card studio-results-card">
            <header>
              <div className="studio-card-heading">
                <span><Sparkles /></span>
                <div>
                  <h2>生成结果</h2>
                  <p>{busy ? `任务处理中 · ${progress}%` : results.length ? `已完成 ${results.filter((result) => result.status === "done").length} 张` : "上传图片并选择输出背景后"}</p>
                </div>
              </div>
              {results.some((result) => result.status === "done") && (
                <button className="studio-download-all" type="button" disabled={zipping} onClick={downloadAll}>
                  {zipping ? <Loader2 className="animate-spin" /> : <Download />}
                  {zipping ? "正在打包" : selected.size ? `下载已选 ${selected.size}` : "下载全部"}
                </button>
              )}
            </header>
            {busy && <div className="studio-progress"><span style={{ width: `${progress}%` }} /></div>}
            {results.length ? (
              <div className="studio-result-grid">
                {results.map((result, index) => {
                  const checked = selected.has(result.id);
                  return (
                    <article key={result.id} className={cn("studio-result", checked && "is-selected", result.status === "error" && "is-error")}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={result.url} alt={`抠图结果 ${index + 1}`} />
                      {result.status === "done" && (
                        <button
                          className="studio-result-check"
                          type="button"
                          onClick={() => setSelected((current) => {
                            const next = new Set(current);
                            checked ? next.delete(result.id) : next.add(result.id);
                            return next;
                          })}
                        >
                          {checked && <Check />}
                        </button>
                      )}
                      <div className="studio-result-actions">
                        {result.status === "done" && (
                          <button type="button" onClick={() => downloadImage(result.url, result.name)}><Download />下载</button>
                        )}
                        <button type="button" onClick={() => { setResults([]); setSelected(new Set()); }}><RefreshCw />再生成</button>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="studio-empty"><span><Sparkles /></span><p>上传图片并选择输出背景后<br />点击“开始抠图”</p></div>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}

function UploadCard({
  files,
  previews,
  inputRef,
  onAdd,
  onRemove,
  onClear,
}: {
  files: File[];
  previews: string[];
  inputRef: RefObject<HTMLInputElement>;
  onAdd: (files: FileList | null) => void;
  onRemove: (index: number) => void;
  onClear: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  return (
    <section className="studio-card studio-upload-card">
      <header>
        <div className="studio-card-heading"><span><ImageIcon /></span><div><h2>待抠图片</h2><p>支持 JPG、PNG、WebP，一次最多 50 张</p></div></div>
        <span>{files.length}/{MAX_FILES}</span>
      </header>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        hidden
        onChange={(event) => {
          onAdd(event.target.files);
          event.target.value = "";
        }}
      />
      {!files.length ? (
        <button
          className={cn("studio-upload-zone", dragging && "is-dragging")}
          onClick={() => inputRef.current?.click()}
          onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={(event) => { event.preventDefault(); setDragging(false); }}
          onDrop={(event) => { event.preventDefault(); setDragging(false); onAdd(event.dataTransfer.files); }}
          type="button"
        >
          <Upload /><span>多图上传时建议使用主体清晰、背景干净的产品图</span>
        </button>
      ) : (
        <div className="studio-thumbs">
          {previews.map((src, index) => (
            <div key={src}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" />
              <button type="button" onClick={() => onRemove(index)}><X /></button>
            </div>
          ))}
          {files.length < MAX_FILES && <button className="studio-add-thumb" type="button" onClick={() => inputRef.current?.click()}><Plus /></button>}
        </div>
      )}
      <footer>
        <span>支持 JPG / PNG / WebP，单张最大 12MB</span>
        {files.length > 1 && <button type="button" onClick={onClear}><Trash2 />清空</button>}
      </footer>
    </section>
  );
}

type SelectOption = string | { value: string; label: string };

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
}) {
  return (
    <div className="studio-field">
      <label>{label}</label>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => {
          const item = typeof option === "string" ? { value: option, label: option } : option;
          return <option key={item.value} value={item.value}>{item.label}</option>;
        })}
      </select>
    </div>
  );
}
