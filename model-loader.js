// Download independently verified pieces so interruptions never discard the entire model.
export const MODEL_INFO = {
  u2netp: { side: 320, bytes: 4574861, version: '8e83ca70' },
  'isnet-general-use': { side: 1024, bytes: 178648008, version: 'fc16ebd8' },
};

export async function readResponse(response, { expected, onProgress = () => {}, signal } = {}) {
  if (!response.ok) throw new Error(`下载失败（HTTP ${response.status}）`);
  if (!response.body) throw new Error('浏览器无法读取模型，请使用新版 Chrome、Edge 或 Safari。');
  if (!Number.isSafeInteger(expected) || expected <= 0) throw new Error('模型大小无效');
  const reader = response.body.getReader(), output = new Uint8Array(expected);
  let offset = 0;
  try {
    while (true) {
      if (signal?.aborted) throw signal.reason;
      const { value, done } = await reader.read();
      if (done) break;
      if (offset + value.length > expected) throw new Error('模型大小不符，请重试。');
      output.set(value, offset); offset += value.length; onProgress(offset);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; } finally { reader.releaseLock(); }
  if (offset !== expected) throw new Error('模型下载中断，重试会继续使用已经下载的部分。');
  return output;
}

export async function modelBytes(base, name, report = () => {}) {
  const info = MODEL_INFO[name];
  if (!info) throw new Error('不支持的抠图模式');
  let cache;
  try { cache = await caches.open('product-studio-model-parts-v2'); } catch {}
  // Reuse models already downloaded by earlier versions of this same site.
  try {
    const previous = await caches.open('product-studio-models-v1');
    const hit = await previous.match(new URL(`models/${name}.onnx?v=${info.version}`, base));
    if (hit) { const bytes = await readResponse(hit, { expected: info.bytes }); report('正在使用已缓存的模型…'); return bytes.buffer; }
  } catch {}
  const manifestURL = new URL(`models/manifest.json?v=${info.version}`, base);
  const manifestResponse = await fetch(manifestURL, { signal: AbortSignal.timeout(30000) });
  // Development trees and older deployments keep the single-file model.
  if (manifestResponse.status === 404 || (manifestResponse.ok && manifestResponse.headers.get('content-type')?.includes('text/html'))) {
    const url = new URL(`models/${name}.onnx?v=${info.version}`, base).href;
    const hit = await cache?.match(url);
    if (hit) return (await readResponse(hit, { expected: info.bytes })).buffer;
    const data = await readResponse(await fetch(url, { signal: AbortSignal.timeout(600000) }), { expected: info.bytes, onProgress: n => report(`下载模型 ${Math.round(n / info.bytes * 100)}% · ${Math.round(n / 1048576)} / ${Math.round(info.bytes / 1048576)} MB`) });
    try { await cache?.put(url, new Response(data)); } catch {}
    return data.buffer;
  }
  if (!manifestResponse.ok) throw new Error('无法连接模型下载服务，请重试。');
  const entry = (await manifestResponse.json()).models?.[name];
  if (!entry || entry.bytes !== info.bytes || !entry.parts?.length || entry.parts.some(p => !Number.isSafeInteger(p.bytes) || p.bytes <= 0 || !/^[a-f0-9]{64}$/.test(p.sha256)) || entry.parts.reduce((n, p) => n + p.bytes, 0) !== info.bytes) throw new Error('模型目录不完整，请刷新网页。');
  const output = new Uint8Array(info.bytes), progress = new Array(entry.parts.length).fill(0);
  let next = 0, last = 0, failed;
  const active = new Set();
  const offsets = []; let position = 0;
  for (const p of entry.parts) { offsets.push(position); position += p.bytes; }
  function update(index, loaded) {
    progress[index] = loaded;
    if (performance.now() - last < 250) return;
    const bytes = progress.reduce((n, v) => n + v, 0); last = performance.now();
    report(`准备模型 ${Math.min(100, Math.round(bytes / info.bytes * 100))}% · ${Math.round(bytes / 1048576)} / ${Math.round(info.bytes / 1048576)} MB，已下载部分会保留`);
  }
  async function getPart(index) {
    const part = entry.parts[index], url = new URL(`models/${part.file}`, base);
    if (url.origin !== new URL(base).origin || !/^[a-z0-9.-]+\.bin$/.test(part.file)) throw new Error('模型目录无效。');
    for (let attempt = 0; attempt < 3; attempt++) {
      if (failed) throw failed;
      const control = new AbortController(); let idle, cached; active.add(control);
      const resetIdle = () => { clearTimeout(idle); idle = setTimeout(() => control.abort(new Error('模型下载暂时停滞，正在重试…')), 30000); };
      try {
        cached = await cache?.match(url.href); resetIdle();
        const response = cached || await fetch(url, { signal: control.signal });
        const data = await readResponse(response, { expected: part.bytes, signal: control.signal, onProgress: size => { resetIdle(); update(index, size); } });
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
        const actual = [...digest].map(b => b.toString(16).padStart(2, '0')).join('');
        if (actual !== part.sha256) { await cache?.delete(url.href); throw new Error('模型片段校验失败'); }
        output.set(data, offsets[index]); update(index, data.length);
        if (!cached) try { await cache?.put(url.href, new Response(data, { headers: { 'Content-Type': 'application/octet-stream' } })); } catch {}
        return;
      } catch (error) {
        if (cached) await cache?.delete(url.href);
        if (failed) throw failed;
        update(index, 0);
        if (attempt === 2) throw new Error('模型下载失败。已下载部分已保留，点击“重新抠图”继续。');
        report(`网络波动，正在重试片段 ${index + 1}…`);
      } finally { clearTimeout(idle); active.delete(control); }
    }
  }
  async function work() {
    try { while (!failed && next < entry.parts.length) { const index = next++; await getPart(index); } }
    catch (error) { failed ||= error; for (const control of active) control.abort(failed); }
  }
  await Promise.all([work(), work(), work()]);
  if (failed) throw failed;
  report('模型已准备好，正在识别商品…');
  return output.buffer;
}
