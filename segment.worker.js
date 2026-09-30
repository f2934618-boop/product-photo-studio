import * as ort from 'onnxruntime-web/wasm';

// Preprocessing follows rembg (MIT). No generative image editing is performed.
let session, currentModel;
const modelInfo = {
  u2netp: { side: 320, bytes: 4574861, version: '8e83ca70' },
  'isnet-general-use': { side: 1024, bytes: 178648008, version: 'fc16ebd8' },
};
const report = (id, message) => self.postMessage({ id, progress: message });

async function modelBytes(base, name, id) {
  const info = modelInfo[name];
  const url = new URL(`models/${name}.onnx?v=${info.version}`, base).href;
  let cache;
  try {
    cache = await caches.open('product-studio-models-v1');
    const hit = await cache.match(url);
    if (hit) { report(id, '正在加载已缓存的抠图模型…'); return await hit.arrayBuffer(); }
  } catch { /* Private browsing may disallow persistent caches. */ }
  report(id, `首次下载模型（约 ${Math.round(info.bytes / 1048576)} MB），之后会复用缓存…`);
  const response = await fetch(url, { signal: AbortSignal.timeout(600000) });
  if (!response.ok) throw new Error(`模型下载失败（HTTP ${response.status}），请检查网络后重试。`);
  const reader = response.body.getReader();
  const parts = []; let size = 0, last = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value); size += value.length;
    if (performance.now() - last > 350) {
      report(id, `下载抠图模型 ${Math.min(99, Math.round(size / info.bytes * 100))}% · ${Math.round(size / 1048576)} / ${Math.round(info.bytes / 1048576)} MB`);
      last = performance.now();
    }
  }
  if (size !== info.bytes) throw new Error('模型文件不完整，请检查网络后重试。');
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  try { await cache?.put(url, new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream' } })); } catch {}
  return bytes.buffer;
}

function boxMean(input, width, height, radius) {
  const pitch = width + 1;
  const integral = new Float64Array(pitch * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) { row += input[y * width + x]; integral[(y + 1) * pitch + x + 1] = integral[y * pitch + x + 1] + row; }
  }
  const result = new Float32Array(input.length);
  for (let y = 0; y < height; y++) {
    const top = Math.max(0, y - radius), bottom = Math.min(height, y + radius + 1);
    for (let x = 0; x < width; x++) {
      const left = Math.max(0, x - radius), right = Math.min(width, x + radius + 1);
      result[y * width + x] = (integral[bottom * pitch + right] - integral[top * pitch + right] - integral[bottom * pitch + left] + integral[top * pitch + left]) / ((right - left) * (bottom - top));
    }
  }
  return result;
}

function refine(alpha, rgba, width, height) {
  // Guided filtering on luminance smooths alpha without repainting the original RGB.
  const length = width * height, guide = new Float32Array(length), ii = new Float32Array(length), ip = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    guide[i] = (rgba[i * 4] * .299 + rgba[i * 4 + 1] * .587 + rgba[i * 4 + 2] * .114) / 255;
    ii[i] = guide[i] * guide[i]; ip[i] = guide[i] * alpha[i];
  }
  const mi = boxMean(guide, width, height, 4), mp = boxMean(alpha, width, height, 4);
  const mii = boxMean(ii, width, height, 4), mip = boxMean(ip, width, height, 4);
  for (let i = 0; i < length; i++) {
    ii[i] = (mip[i] - mi[i] * mp[i]) / (mii[i] - mi[i] * mi[i] + .001);
    ip[i] = mp[i] - ii[i] * mi[i];
  }
  const ma = boxMean(ii, width, height, 4), mb = boxMean(ip, width, height, 4);
  const output = new Uint8ClampedArray(length);
  for (let i = 0; i < length; i++) {
    const a = (ma[i] * guide[i] + mb[i] - .035) / .93;
    output[i] = a < .015 ? 0 : a > .985 ? 255 : Math.round(a * 255);
  }
  return output;
}

self.onmessage = async event => {
  const { id, model, base, rgba, width, height } = event.data;
  try {
    const info = modelInfo[model];
    if (!info) throw new Error('不支持的抠图模式');
    if (!session || currentModel !== model) {
      if (session) { await session.release(); session = undefined; }
      ort.env.wasm.numThreads = 1; // GitHub Pages has no cross-origin isolation headers.
      ort.env.wasm.wasmPaths = new URL('runtime/', base).href;
      ort.env.logLevel = 'error';
      const bytes = await modelBytes(base, model, id);
      report(id, '正在准备模型，首次加载稍慢…');
      session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], enableCpuMemArena: false, enableMemPattern: false });
      currentModel = model;
    }
    report(id, model === 'u2netp' ? '正在识别商品轮廓…' : '正在精细识别商品边缘，图片不会上传…');
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
    const small = new OffscreenCanvas(info.side, info.side), ctx = small.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, info.side, info.side);
    ctx.drawImage(canvas, 0, 0, info.side, info.side);
    const pixels = ctx.getImageData(0, 0, info.side, info.side).data;
    const count = info.side ** 2, values = new Float32Array(count * 3);
    let max = 1;
    for (let i = 0; i < count; i++) for (let c = 0; c < 3; c++) max = Math.max(max, pixels[i * 4 + c]);
    for (let i = 0; i < count; i++) for (let c = 0; c < 3; c++) {
      const value = pixels[i * 4 + c] / max;
      values[c * count + i] = model === 'u2netp' ? (value - [.485, .456, .406][c]) / [.229, .224, .225][c] : value - .5;
    }
    const tensor = new ort.Tensor('float32', values, [1, 3, info.side, info.side]);
    const outputs = await session.run({ [session.inputNames[0]]: tensor });
    const prediction = outputs[session.outputNames[0]].data;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < count; i++) { lo = Math.min(lo, prediction[i]); hi = Math.max(hi, prediction[i]); }
    if (hi - lo < 1e-6) throw new Error('没有识别到清晰主体，请换图或切换抠图模式。');
    const mask = ctx.createImageData(info.side, info.side);
    for (let i = 0; i < count; i++) {
      const value = (prediction[i] - lo) / (hi - lo) * 255;
      mask.data[i * 4] = mask.data[i * 4 + 1] = mask.data[i * 4 + 2] = value; mask.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(mask, 0, 0);
    const largeCtx = canvas.getContext('2d'); largeCtx.drawImage(small, 0, 0, width, height);
    const large = largeCtx.getImageData(0, 0, width, height).data, alpha = new Float32Array(width * height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = large[i * 4] / 255;
    report(id, '正在整理边缘与透明度…');
    const result = refine(alpha, new Uint8ClampedArray(rgba), width, height);
    Object.values(outputs).forEach(output => output.dispose()); tensor.dispose();
    self.postMessage({ id, alpha: result.buffer, width, height }, [result.buffer]);
  } catch (error) {
    const message = String(error?.message || error);
    const friendly = /memory|alloc|out of bounds|RangeError/i.test(message) ? '浏览器可用内存不足，请切换快速抠图并关闭其他占内存的标签页。' : message;
    self.postMessage({ id, error: friendly });
  }
};
