/// <reference lib="webworker" />

import * as ort from "onnxruntime-web/wasm";

type CutoutRequest = {
  id: number;
  bytes: ArrayBuffer;
  type: string;
  whiteBackground: boolean;
  ratio: string;
};

declare const self: DedicatedWorkerGlobalScope;

let sessionPromise: Promise<ort.InferenceSession> | null = null;

function progress(id: number, value: number, message: string) {
  self.postMessage({ id, kind: "progress", value, message });
}

async function getSession(id: number) {
  if (!sessionPromise) {
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmPaths = "/api/cutout-assets/v1/";
    ort.env.logLevel = "error";
    sessionPromise = (async () => {
      progress(id, 8, "首次使用，正在加载本地抠图模型…");
      const response = await fetch("/api/cutout-assets/v1/u2netp.onnx", { cache: "force-cache" });
      if (!response.ok) throw new Error(`本地模型加载失败（${response.status}）`);
      const model = await response.arrayBuffer();
      progress(id, 22, "正在初始化本地抠图模型…");
      return ort.InferenceSession.create(model, {
        executionProviders: ["wasm"],
        enableCpuMemArena: false,
        enableMemPattern: false,
      });
    })().catch((error) => {
      sessionPromise = null;
      throw error;
    });
  }
  return sessionPromise;
}

async function run(request: CutoutRequest) {
  const { id, bytes, type, whiteBackground, ratio } = request;
  let bitmap = await createImageBitmap(new Blob([bytes], { type }), {
    imageOrientation: "from-image",
  });
  // Phone photos can decode into several hundred MB of canvas data. Keep a
  // useful export resolution without exhausting a friend's browser memory.
  const longestEdge = Math.max(bitmap.width, bitmap.height);
  if (longestEdge > 3200) {
    const resized = await createImageBitmap(bitmap, {
      resizeWidth: Math.round(bitmap.width * 3200 / longestEdge),
      resizeHeight: Math.round(bitmap.height * 3200 / longestEdge),
      resizeQuality: "high",
    });
    bitmap.close();
    bitmap = resized;
  }
  const sourceWidth = bitmap.width;
  const sourceHeight = bitmap.height;
  const side = 320;

  const inputCanvas = new OffscreenCanvas(side, side);
  const inputContext = inputCanvas.getContext("2d", { willReadFrequently: true });
  if (!inputContext) throw new Error("浏览器无法创建图片处理画布");
  inputContext.fillStyle = "#fff";
  inputContext.fillRect(0, 0, side, side);
  inputContext.drawImage(bitmap, 0, 0, side, side);
  const rgba = inputContext.getImageData(0, 0, side, side).data;
  const pixelCount = side * side;
  const values = new Float32Array(pixelCount * 3);
  const mean = [0.485, 0.456, 0.406];
  const std = [0.229, 0.224, 0.225];
  for (let index = 0; index < pixelCount; index++) {
    for (let channel = 0; channel < 3; channel++) {
      values[channel * pixelCount + index] =
        (rgba[index * 4 + channel] / 255 - mean[channel]) / std[channel];
    }
  }

  const session = await getSession(id);
  progress(id, 38, "正在识别商品主体…");
  const tensor = new ort.Tensor("float32", values, [1, 3, side, side]);
  const outputMap = await session.run({ [session.inputNames[0]]: tensor });
  const output = outputMap[session.outputNames[0]];
  const prediction = output.data as Float32Array;
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < pixelCount; index++) {
    low = Math.min(low, prediction[index]);
    high = Math.max(high, prediction[index]);
  }
  if (high - low < 1e-6) throw new Error("没有识别到清晰商品主体");

  progress(id, 78, "正在整理商品边缘…");
  const mask = inputContext.createImageData(side, side);
  let left = side, top = side, right = -1, bottom = -1;
  for (let index = 0; index < pixelCount; index++) {
    const normalized = (prediction[index] - low) / (high - low);
    const adjusted = Math.max(0, Math.min(1, (normalized - 0.035) / 0.93));
    const alpha = adjusted < 0.015 ? 0 : adjusted > 0.985 ? 255 : Math.round(adjusted * 255);
    mask.data[index * 4] = 255;
    mask.data[index * 4 + 1] = 255;
    mask.data[index * 4 + 2] = 255;
    mask.data[index * 4 + 3] = alpha;
    if (alpha >= 32) {
      const x = index % side;
      const y = Math.floor(index / side);
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
  }
  inputContext.clearRect(0, 0, side, side);
  inputContext.putImageData(mask, 0, 0);

  const cutoutCanvas = new OffscreenCanvas(sourceWidth, sourceHeight);
  const cutoutContext = cutoutCanvas.getContext("2d");
  if (!cutoutContext) throw new Error("浏览器无法合成抠图结果");
  cutoutContext.drawImage(bitmap, 0, 0, sourceWidth, sourceHeight);
  cutoutContext.globalCompositeOperation = "destination-in";
  cutoutContext.imageSmoothingEnabled = true;
  cutoutContext.imageSmoothingQuality = "high";
  cutoutContext.drawImage(inputCanvas, 0, 0, sourceWidth, sourceHeight);
  cutoutContext.globalCompositeOperation = "source-over";

  const [ratioWidth, ratioHeight] = ratio.split(":").map(Number);
  const targetRatio = ratioWidth > 0 && ratioHeight > 0 ? ratioWidth / ratioHeight : sourceWidth / sourceHeight;
  if (right <= left || bottom <= top) throw new Error("未识别到完整商品，请换一张主体清晰的照片");
  // Center the detected subject, not the original street photograph. Keep its
  // native pixels and add margin; changing ratio must never crop the product.
  const subjectWidth = (right - left + 1) * sourceWidth / side;
  const subjectHeight = (bottom - top + 1) * sourceHeight / side;
  const centerX = (left + right + 1) * sourceWidth / (2 * side);
  const centerY = (top + bottom + 1) * sourceHeight / (2 * side);
  const targetWidth = Math.ceil(Math.max(subjectWidth / .84, subjectHeight * targetRatio / .84));
  const targetHeight = Math.ceil(targetWidth / targetRatio);
  const outputCanvas = new OffscreenCanvas(targetWidth, targetHeight);
  const context = outputCanvas.getContext("2d");
  if (!context) throw new Error("浏览器无法生成抠图结果");
  if (whiteBackground) {
    context.fillStyle = "#fff";
    context.fillRect(0, 0, targetWidth, targetHeight);
  }
  context.drawImage(
    cutoutCanvas,
    Math.round(targetWidth / 2 - centerX),
    Math.round(targetHeight / 2 - centerY)
  );

  const blob = await outputCanvas.convertToBlob({ type: "image/png" });
  const result = await blob.arrayBuffer();
  tensor.dispose();
  Object.values(outputMap).forEach((item) => item.dispose());
  bitmap.close();
  progress(id, 100, "处理完成");
  self.postMessage({ id, kind: "done", bytes: result }, [result]);
}

self.onmessage = (event: MessageEvent<CutoutRequest>) => {
  run(event.data).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "本地抠图失败";
    self.postMessage({ id: event.data.id, kind: "error", error: message });
  });
};

export {};
