import { zip } from 'fflate';
import { createAIStudio } from './ai.js';
import { readItems, saveItem, deleteItem } from './storage.js';
import { canvas, toBlob, decode, previewOf, maskOf, bounds, dimensions, whiteImage, posterImage, paletteFrom, defaultSettings } from './imaging.js';

const $ = id => document.getElementById(id);
const state = { items: [], selected: null, mode: 'cutout', view: 'result', busy: false, stop: false, template: 'festive', palette: null, assets: null };
let worker, workerId = 0, workerJob, drawRevision = 0, toastTimer, saveTimer;
let festiveBackground, aiStudio;
const current = () => state.items.find(item => item.id === state.selected);
const baseURL = new URL('./', location.href).href;
const status = message => { $('connectionStatus').textContent = message; };
const safeName = name => name.replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 70) || '商品图';
function toast(text) { $('toast').textContent = text; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 3800); }
function showError(error) { $('errorBanner').textContent = String(error?.message || error); $('errorBanner').hidden = false; }
function clearError() { $('errorBanner').hidden = true; }
function report(title, detail = '图片只在当前浏览器中处理') { $('progress').hidden = false; $('progressText').textContent = title; $('progressDetail').textContent = detail; }
function controls() {
  const has = !!current(), busy = state.busy;
  ['removeItem', 'repairButton', 'reprocessButton', 'exportButton', 'applyAll', 'designExport'].forEach(id => $(id).disabled = !has || busy);
  $('batchExport').disabled = !state.items.length || busy;
  $('addImages').disabled = $('sampleButton').disabled = busy;
  aiStudio?.sync();
  $('imageDimensions').textContent = has ? `${current().width} × ${current().height}` : '等待图片';
  $('emptyState').hidden = has; $('previewCanvas').hidden = !has;
}
function setBusy(value) { state.busy = value; controls(); if (!value) { $('progress').hidden = true; $('stopQueue').disabled = false; status('浏览器本地处理'); } }
function listImages() {
  $('itemCount').textContent = state.items.length;
  const parent = $('imageList');
  for (const img of parent.querySelectorAll('img')) URL.revokeObjectURL(img.src);
  parent.replaceChildren();
  if (!state.items.length) { const p = document.createElement('p'); p.className = 'library-empty'; p.textContent = '从一张商品照片开始'; parent.append(p); }
  for (const item of state.items) {
    const button = document.createElement('button'); button.className = `image-item${item.id === state.selected ? ' selected' : ''}`;
    button.setAttribute('aria-label', `选择 ${item.name}`); button.setAttribute('aria-pressed', item.id === state.selected);
    const img = document.createElement('img'); img.src = URL.createObjectURL(item.preview); img.alt = ''; img.loading = 'lazy';
    const text = document.createElement('div'), name = document.createElement('strong'), info = document.createElement('small');
    name.textContent = item.name; info.textContent = item.manual ? '待手动修补' : item.model === 'isnet-general-use' ? '精细抠图' : item.model === 'alpha' ? '透明素材' : '快速抠图';
    text.append(name, info); button.append(img, text); button.onclick = () => { if (!state.busy) select(item.id); }; parent.append(button);
  }
}
async function persist(item) {
  try { await saveItem(item); }
  catch { toast('浏览器存储空间不足，请及时下载；当前图片仍可编辑。'); }
}
function syncSettings() {
  const opts = current()?.settings || defaultSettings();
  $('ratioSelect').value = opts.ratio; $('sizeSelect').value = opts.size; $('occupancy').value = opts.occupancy;
  $('occupancyValue').textContent = `${opts.occupancy}%`; $('centerToggle').checked = opts.center;
  $('formatSelect').value = opts.background === 'transparent' ? 'png' : opts.format;
  $('formatSelect').disabled = opts.background === 'transparent';
  for (const b of $('backgroundOptions').querySelectorAll('button')) b.classList.toggle('selected', b.dataset.bg === opts.background);
}
async function select(id) {
  state.selected = id;
  if (state.assets) { state.assets.bitmap.close(); state.assets = null; }
  listImages(); syncSettings(); controls(); await render();
}
async function assets(item = current()) {
  if (state.assets?.id === item.id) return state.assets;
  const bitmap = await decode(item.original), maskBitmap = await decode(item.mask), mask = canvas(maskBitmap.width, maskBitmap.height);
  mask.getContext('2d').drawImage(maskBitmap, 0, 0); maskBitmap.close();
  const result = { id: item.id, bitmap, mask };
  if (item.id === state.selected) { state.assets?.bitmap.close(); state.assets = result; }
  return result;
}
function posterOptions() {
  return { template: state.template, palette: state.palette, title: $('posterTitle').value, subtitle: $('posterSubtitle').value, badge: $('posterBadge').value, price: $('posterPrice').value, points: $('posterPoints').value, ratio: $('posterRatio').value, size: $('posterSize').value, scale: +$('posterScale').value };
}
async function render() {
  const revision = ++drawRevision, item = current(); if (!item || state.mode === 'ai') return;
  try {
    const { bitmap, mask } = await assets(item); if (revision !== drawRevision) return;
    let result;
    if (state.mode === 'cutout') result = whiteImage(bitmap, mask, item.settings, 1000);
    else result = posterImage(bitmap, mask, posterOptions(), 'cover', 1100, festiveBackground);
    const target = $('previewCanvas'); target.width = result.width; target.height = result.height; const ctx = target.getContext('2d'); ctx.clearRect(0, 0, target.width, target.height);
    if (state.view === 'original' && state.mode === 'cutout') {
      target.width = Math.round(1000 * bitmap.width / Math.max(bitmap.width, bitmap.height)); target.height = Math.round(1000 * bitmap.height / Math.max(bitmap.width, bitmap.height));
      ctx.drawImage(bitmap, 0, 0, target.width, target.height);
    } else {
      ctx.drawImage(result, 0, 0);
      if (state.view === 'compare' && state.mode === 'cutout') {
        const split = target.width / 2; ctx.save(); ctx.beginPath(); ctx.rect(0, 0, split, target.height); ctx.clip();
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, target.width, target.height);
        const scale = Math.min(target.width / bitmap.width, target.height / bitmap.height);
        ctx.drawImage(bitmap, (target.width - bitmap.width * scale) / 2, (target.height - bitmap.height * scale) / 2, bitmap.width * scale, bitmap.height * scale); ctx.restore();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(split, 0); ctx.lineTo(split, target.height); ctx.stroke();
        ctx.font = '24px sans-serif'; ctx.fillStyle = '#20301dce'; ctx.fillRect(18, 18, 78, 40); ctx.fillRect(target.width - 96, 18, 78, 40); ctx.fillStyle = '#fff'; ctx.fillText('原图', 31, 46); ctx.fillText('效果', target.width - 83, 46);
      }
    }
    const dims = state.mode === 'cutout' ? dimensions(item.settings.ratio, item.settings.size, bitmap) : dimensions(posterOptions().ratio, posterOptions().size, bitmap);
    $('previewInfo').textContent = `${state.mode === 'cutout' ? '导出' : state.mode === 'suite' ? '套图封面预览' : '封面导出'} ${dims[0]} × ${dims[1]} px · 原图细节保留`;
    controls();
  } catch (error) { showError(error); }
}
function settingsChanged() {
  const item = current(); if (!item) return;
  Object.assign(item.settings, { ratio: $('ratioSelect').value, size: $('sizeSelect').value, occupancy: +$('occupancy').value, center: $('centerToggle').checked, format: $('formatSelect').value });
  syncSettings(); render(); clearTimeout(saveTimer); saveTimer = setTimeout(() => persist(item), 250);
}

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./segment.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (!workerJob || data.id !== workerJob.id) return;
      if (data.progress) { $('progressDetail').textContent = data.progress; return; }
      clearTimeout(workerJob.timer);
      if (data.error) workerJob.reject(new Error(data.error)); else workerJob.resolve(maskOf(new Uint8ClampedArray(data.alpha), data.width, data.height));
      workerJob = null;
    };
    worker.onerror = () => { if (workerJob) { clearTimeout(workerJob.timer); workerJob.reject(new Error('抠图引擎启动失败，请刷新网页或使用新版 Chrome / Edge。')); workerJob = null; } worker?.terminate(); worker = null; };
  }
  return worker;
}
async function segment(preview, model) {
  const rgba = preview.getContext('2d').getImageData(0, 0, preview.width, preview.height).data;
  let transparent = false;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] < 250) { transparent = true; break; }
  if (transparent) {
    const alpha = new Uint8ClampedArray(preview.width * preview.height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3];
    return { mask: maskOf(alpha, preview.width, preview.height), model: 'alpha' };
  }
  const mask = await new Promise((resolve, reject) => {
    const id = ++workerId, instance = getWorker();
    const timer = setTimeout(() => { instance.terminate(); worker = null; workerJob = null; reject(new Error('处理超时，请切换快速抠图，或用“修补边缘”圈选商品。')); }, 600000);
    workerJob = { id, resolve, reject, timer };
    instance.postMessage({ id, model, base: baseURL, rgba: rgba.buffer, width: preview.width, height: preview.height }, [rgba.buffer]);
  });
  return { mask, model };
}

async function addFiles(files) {
  if (state.busy) { toast('请等待当前处理完成。'); return; }
  const available = Math.max(0, 50 - state.items.length), queue = Array.from(files).slice(0, available);
  if (!queue.length) { toast('一次最多保留 50 张图片，请先下载并移出部分素材。'); return; }
  if (files.length > available) toast('最多保留 50 张图片，已截取可用数量。');
  clearError(); state.stop = false; setBusy(true); let count = 0, errors = [];
  const model = $('modelSelect').value;
  try {
    for (const file of queue) {
      if (state.stop) break;
      report(`正在处理 ${count + 1} / ${queue.length} · ${file.name}`);
      try {
        if (file.size > 40 * 1024 ** 2) throw new Error('文件超过 40 MB。');
        if (!/image\/(jpeg|png|webp|bmp|x-ms-bmp)/.test(file.type)) throw new Error('请使用 JPG、PNG、WebP 或 BMP 静态图片。');
        const bitmap = await decode(file), preview = previewOf(bitmap), item = { id: crypto.randomUUID(), name: file.name, original: file, preview: await toBlob(preview, 'image/jpeg', .9), width: bitmap.width, height: bitmap.height, created: Date.now(), settings: defaultSettings() }; bitmap.close();
        try {
          const result = await segment(preview, model); item.mask = await toBlob(result.mask); item.model = result.model;
        } catch (error) {
          const full = canvas(preview.width, preview.height); full.getContext('2d').fillStyle = '#fff'; full.getContext('2d').fillRect(0, 0, full.width, full.height);
          item.mask = await toBlob(full); item.model = model; item.manual = true;
          errors.push(`${file.name}：${error.message} 已保留原图，可用“圈选保留”手动抠图。`);
        }
        item.autoMask = item.mask; state.items.push(item); await persist(item); await select(item.id); count++;
      } catch (error) { errors.push(`${file.name}：${error.message}`); count++; }
    }
  } finally { setBusy(false); if (errors.length) showError(errors.join('\n')); else toast(state.stop ? '已停止后续图片，完成的图片已保留。' : `已处理 ${count} 张图片`); }
}
async function reprocess() {
  const item = current(); if (!item || state.busy) return;
  setBusy(true); clearError(); report('正在重新抠图', '重新抠图成功后会替换当前修补结果');
  try {
    const bitmap = await decode(item.original); const preview = previewOf(bitmap); bitmap.close();
    const result = await segment(preview, $('modelSelect').value);
    item.mask = item.autoMask = await toBlob(result.mask); item.model = result.model; item.manual = false;
    await persist(item); await select(item.id); toast('已完成重新抠图。');
  } catch (error) { showError(error); }
  finally { setBusy(false); }
}
function download(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name;
  a.textContent = `↓ ${name}`; a.className = 'download-file';
  const shelf = $('downloadShelf'); shelf.hidden = false; shelf.prepend(a); a.click();
  while (shelf.children.length > 4) { URL.revokeObjectURL(shelf.lastChild.href); shelf.lastChild.remove(); }
}
function makeZip(files) { return new Promise((resolve, reject) => zip(files, { level: 0 }, (error, data) => error ? reject(error) : resolve(new Blob([data], { type: 'application/zip' })))); }
async function exportWhite(item) {
  const data = await assets(item), output = whiteImage(data.bitmap, data.mask, item.settings);
  const format = item.settings.background === 'transparent' ? 'png' : item.settings.format;
  const blob = await toBlob(output, format === 'jpg' ? 'image/jpeg' : 'image/png');
  if (item.id !== state.selected) data.bitmap.close();
  return { blob, name: `${safeName(item.name)}_${item.settings.background === 'transparent' ? '透明底' : '商品图'}.${format}` };
}
async function exportCurrent() {
  if (!current() || state.busy) return; setBusy(true); clearError(); report('正在导出高清图片…');
  try { const { blob, name } = await exportWhite(current()); download(blob, name); toast('已开始下载。'); }
  catch (error) { showError(error); } finally { setBusy(false); }
}
async function exportBatch() {
  if (!state.items.length || state.busy) return; setBusy(true); clearError();
  try {
    const files = {}; let index = 0;
    for (const item of state.items) {
      report(`正在打包 ${++index} / ${state.items.length}`);
      const { blob, name } = await exportWhite(item); files[`${String(index).padStart(2, '0')}_${name}`] = new Uint8Array(await blob.arrayBuffer());
    }
    download(await makeZip(files), '商品白底图.zip'); toast('批量图片已打包下载。');
  } catch (error) { showError(error); } finally { setBusy(false); }
}
async function exportDesign() {
  const item = current(); if (!item || state.busy) return; setBusy(true); clearError(); report('正在导出封面…');
  try {
    const { bitmap, mask } = await assets(), opts = posterOptions();
    if (state.mode === 'suite') {
      const variants = [['cover', '01_封面'], ['product', '02_商品展示'], ['detail', '03_细节展示']];
      if (opts.points.trim()) variants.push(['info', '04_商品信息']);
      const files = {};
      for (const [variant, name] of variants) { const blob = await toBlob(posterImage(bitmap, mask, opts, variant, null, festiveBackground), 'image/jpeg'); files[`${name}.jpg`] = new Uint8Array(await blob.arrayBuffer()); }
      download(await makeZip(files), `${safeName(item.name)}_详情套图.zip`); toast(`已下载 ${variants.length} 张详情套图。`);
    } else download(await toBlob(posterImage(bitmap, mask, opts, 'cover', null, festiveBackground), 'image/jpeg'), `${safeName(item.name)}_封面.jpg`);
  } catch (error) { showError(error); } finally { setBusy(false); }
}
function switchMode(mode) {
  state.mode = mode; clearError();
  for (const b of document.querySelectorAll('[data-mode]')) b.classList.toggle('active', b.dataset.mode === mode);
  const texts = {
    cutout: ['白底精修', '让商品，成为主角。', '去掉杂乱背景，保留包装、文字与真实质感。', 'LESS BACKGROUND. MORE PRODUCT.'],
    poster: ['封面海报', '好商品，也要好封面。', '选一套配色，写一句好标题。商品细节，始终来自原图。', 'A GOOD PRODUCT DESERVES A GOOD COVER.'],
    suite: ['详情套图', '一张实拍，一套表达。', '封面、商品展示、细节与卖点，统一风格打包导出。', 'ONE PRODUCT. A COMPLETE STORY.'],
    ai: ['AI 创作', '把想法，变成画面。', '连接自己的图片编辑接口，扩展商品场景与风格。', 'MAKE ROOM FOR YOUR IDEAS.'],
  }[mode];
  ['breadcrumb', 'pageTitle', 'pageDescription', 'eyebrow'].forEach((id, i) => $(id).textContent = texts[i]);
  $('editorLayout').hidden = mode === 'ai'; $('aiPanel').hidden = mode !== 'ai';
  $('cutoutControls').hidden = mode !== 'cutout'; $('posterControls').hidden = mode !== 'poster' && mode !== 'suite';
  $('previewTabs').hidden = mode !== 'cutout'; $('designTitle').textContent = mode === 'suite' ? '套图设计' : '封面设计';
  $('designExport').innerHTML = mode === 'suite' ? '下载详情套图 ZIP <span>↓</span>' : '下载封面海报 <span>↓</span>';
  $('designHelp').textContent = mode === 'suite' ? '默认导出 3 张图；填写卖点后增加商品信息页。' : '模板排版免费，商品使用原图抠图素材。';
  $('modeTag').textContent = mode === 'ai' ? '需自备模型接口' : '浏览器免费处理';
  document.querySelector('.privacy').textContent = mode === 'ai' ? '◎ 仅生成时发送到已配置接口' : '◎ 图片留在本机';
  $('batchExport').hidden = mode === 'ai'; render();
}

// Mask editing works on alpha only. The source image is never painted over.
const repair = { mask: null, original: null, undo: [], tool: 'erase', drawing: false, points: [], last: null };
async function openRepair() {
  if (!current()) return;
  const data = await assets(), p = previewOf(data.bitmap); repair.original = p; repair.mask = canvas(data.mask.width, data.mask.height); repair.mask.getContext('2d').drawImage(data.mask, 0, 0);
  repair.undo = []; repair.points = []; repair.drawing = false; $('repairZoom').value = '1'; $('undoMask').disabled = true; $('repairDialog').showModal(); drawRepair();
}
function rememberMask() { repair.undo.push(repair.mask.getContext('2d').getImageData(0, 0, repair.mask.width, repair.mask.height)); if (repair.undo.length > 8) repair.undo.shift(); $('undoMask').disabled = false; }
function drawRepair() {
  const target = $('repairCanvas'); if (!repair.mask) return; const { width: w, height: h } = repair.mask;
  if (target.width !== w || target.height !== h) { target.width = w; target.height = h; }
  const wrap = $('repairCanvasWrap'), scale = Math.min((wrap.clientWidth - 36) / w, (wrap.clientHeight - 36) / h) * +$('repairZoom').value;
  target.style.width = `${w * scale}px`; target.style.height = `${h * scale}px`;
  const ctx = target.getContext('2d'); ctx.clearRect(0, 0, w, h); ctx.globalAlpha = .14; ctx.drawImage(repair.original, 0, 0, w, h); ctx.globalAlpha = 1;
  const layer = canvas(w, h), lctx = layer.getContext('2d'); lctx.drawImage(repair.original, 0, 0, w, h); lctx.globalCompositeOperation = 'destination-in'; lctx.drawImage(repair.mask, 0, 0); ctx.drawImage(layer, 0, 0);
  if (repair.points.length) {
    ctx.strokeStyle = '#e59523'; ctx.lineWidth = 3 / Math.max(.2, scale); ctx.fillStyle = '#df952225'; ctx.beginPath(); repair.points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#f0a32e'; for (const [x, y] of repair.points) { ctx.beginPath(); ctx.arc(x, y, 4 / scale, 0, Math.PI * 2); ctx.fill(); }
  }
  $('applyPolygon').hidden = repair.tool !== 'polygon'; $('applyPolygon').disabled = repair.points.length < 3;
}
function point(event) { const r = $('repairCanvas').getBoundingClientRect(); return [(event.clientX - r.left) / r.width * repair.mask.width, (event.clientY - r.top) / r.height * repair.mask.height]; }
function brush(from, to) {
  const ctx = repair.mask.getContext('2d'); ctx.globalCompositeOperation = repair.tool === 'erase' ? 'destination-out' : 'source-over'; ctx.strokeStyle = ctx.fillStyle = '#fff'; ctx.lineWidth = +$('brushSize').value; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(...from); ctx.lineTo(...to); ctx.stroke(); ctx.beginPath(); ctx.arc(...to, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill(); ctx.globalCompositeOperation = 'source-over'; drawRepair();
}
$('repairCanvas').addEventListener('pointerdown', event => {
  if (event.button !== 0) return; event.preventDefault(); const p = point(event);
  if (repair.tool === 'polygon') { repair.points.push(p); drawRepair(); return; }
  rememberMask(); repair.drawing = true; repair.last = p; $('repairCanvas').setPointerCapture(event.pointerId); brush(p, p);
});
$('repairCanvas').addEventListener('pointermove', event => { if (!repair.drawing) return; const p = point(event); brush(repair.last, p); repair.last = p; });
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) $('repairCanvas').addEventListener(name, () => repair.drawing = false);
for (const button of document.querySelectorAll('[data-tool]')) button.onclick = () => {
  repair.tool = button.dataset.tool; repair.points = [];
  for (const b of document.querySelectorAll('[data-tool]')) b.classList.toggle('selected', b === button);
  $('repairHint').textContent = repair.tool === 'polygon' ? '沿商品外边缘逐点点击，再“完成圈选”；圈内保留原图，圈外移除。' : repair.tool === 'restore' ? '涂抹恢复误删部分，原图内容不会被重绘。' : '在不需要的部分涂抹即可擦除。'; drawRepair();
};
$('applyPolygon').onclick = () => {
  if (repair.points.length < 3) return; rememberMask(); const ctx = repair.mask.getContext('2d'); ctx.clearRect(0, 0, repair.mask.width, repair.mask.height); ctx.fillStyle = '#fff'; ctx.beginPath(); repair.points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.fill(); repair.points = []; drawRepair();
};
$('undoMask').onclick = () => { const prev = repair.undo.pop(); if (prev) repair.mask.getContext('2d').putImageData(prev, 0, 0); $('undoMask').disabled = !repair.undo.length; repair.points = []; drawRepair(); };
$('resetMask').onclick = async () => { rememberMask(); const b = await decode(current().autoMask); const ctx = repair.mask.getContext('2d'); ctx.clearRect(0, 0, repair.mask.width, repair.mask.height); ctx.drawImage(b, 0, 0); b.close(); repair.points = []; drawRepair(); };
$('saveMask').onclick = async () => {
  try { bounds(repair.mask); const item = current(); item.mask = await toBlob(repair.mask); item.manual = false; await persist(item); $('repairDialog').close(); await select(item.id); toast('修补已保存。'); }
  catch (error) { toast(error.message); }
};
$('repairZoom').onchange = drawRepair; $('closeRepair').onclick = () => $('repairDialog').close();

for (const button of document.querySelectorAll('[data-mode]')) button.onclick = () => { switchMode(button.dataset.mode); if (button.dataset.ai) aiStudio.setMode(button.dataset.ai); };
for (const button of document.querySelectorAll('[data-view]')) button.onclick = () => { state.view = button.dataset.view; for (const b of document.querySelectorAll('[data-view]')) b.classList.toggle('selected', b === button); render(); };
for (const button of document.querySelectorAll('[data-bg]')) button.onclick = () => { const item = current(); if (!item) return; item.settings.background = button.dataset.bg; if (button.dataset.bg === 'transparent') $('formatSelect').value = 'png'; settingsChanged(); };
for (const id of ['ratioSelect', 'sizeSelect', 'occupancy', 'centerToggle', 'formatSelect']) $(id).addEventListener('input', settingsChanged);
for (const id of ['posterTitle', 'posterSubtitle', 'posterBadge', 'posterPrice', 'posterPoints', 'posterRatio', 'posterSize', 'posterScale']) $(id).addEventListener('input', () => { $('posterScaleValue').textContent = `${$('posterScale').value}%`; localStorage.setItem('studio-design-v1', JSON.stringify(posterOptions())); render(); });
for (const button of document.querySelectorAll('[data-template]')) button.onclick = () => { state.template = button.dataset.template; state.palette = null; $('paletteStatus').textContent = '只提取配色，不复制图中商品与文字。'; for (const b of document.querySelectorAll('[data-template]')) b.classList.toggle('selected', b === button); render(); };
$('paletteButton').onclick = () => $('paletteInput').click();
$('paletteInput').onchange = async event => { try { const file = event.target.files[0]; if (!file) return; state.palette = await paletteFrom(file); $('paletteStatus').textContent = '已应用参考图配色，点击风格卡片可恢复默认。'; render(); } catch (error) { showError(error); } event.target.value = ''; };
$('addImages').onclick = () => $('fileInput').click();
$('uploadZone').onclick = event => { if (event.target.closest('button')) return; if (!state.busy) $('fileInput').click(); };
$('uploadZone').onkeydown = event => { if (event.target === $('uploadZone') && ['Enter', ' '].includes(event.key)) { event.preventDefault(); if (!state.busy) $('fileInput').click(); } };
$('fileInput').onchange = event => { addFiles(event.target.files); event.target.value = ''; };
for (const type of ['dragenter', 'dragover']) $('uploadZone').addEventListener(type, event => { event.preventDefault(); $('uploadZone').classList.add('drag-over'); });
for (const type of ['dragleave', 'drop']) $('uploadZone').addEventListener(type, event => { event.preventDefault(); $('uploadZone').classList.remove('drag-over'); if (type === 'drop') addFiles(event.dataTransfer.files); });
document.addEventListener('paste', event => { if (/INPUT|TEXTAREA/.test(document.activeElement.tagName)) return; const files = [...(event.clipboardData?.files || [])]; if (files.length) { event.preventDefault(); addFiles(files); } });
document.addEventListener('dragover', event => event.preventDefault()); document.addEventListener('drop', event => event.preventDefault());
$('stopQueue').onclick = () => { state.stop = true; $('stopQueue').disabled = true; toast('当前图片完成后停止。'); };
$('reprocessButton').onclick = reprocess; $('repairButton').onclick = openRepair;
$('exportButton').onclick = exportCurrent; $('batchExport').onclick = exportBatch; $('designExport').onclick = exportDesign;
$('applyAll').onclick = async () => { if (!current()) return; const opts = { ...current().settings }; for (const item of state.items) { item.settings = { ...opts }; await persist(item); } toast('已应用到全部图片。'); };
$('removeItem').onclick = async () => { if (!current() || state.busy) return; const id = state.selected; try { await deleteItem(id); state.items = state.items.filter(item => item.id !== id); await select(state.items.at(-1)?.id || null); } catch { showError('无法移出本地素材，请刷新后重试。'); } };
for (const id of ['helpButton', 'aboutButton']) $(id).onclick = () => $('helpDialog').showModal(); $('closeHelp').onclick = () => $('helpDialog').close();
$('sampleButton').onclick = async () => {
  // This synthetic example contains no user's photos or real brand artwork.
  const c = canvas(1000, 1000), ctx = c.getContext('2d');
  const bg = ctx.createLinearGradient(0, 0, 1000, 1000); bg.addColorStop(0, '#bdcbb9'); bg.addColorStop(1, '#63796c'); ctx.fillStyle = bg; ctx.fillRect(0, 0, 1000, 1000);
  ctx.fillStyle = '#8b9d8b'; ctx.fillRect(0, 730, 1000, 270); ctx.fillStyle = '#a98750'; ctx.fillRect(190, 300, 620, 490);
  ctx.fillStyle = '#bb3130'; ctx.fillRect(180, 280, 640, 100); ctx.fillRect(477, 280, 46, 510); ctx.fillRect(190, 500, 620, 45);
  ctx.strokeStyle = '#d64a40'; ctx.lineWidth = 30; ctx.beginPath(); ctx.ellipse(442, 245, 67, 27, .45, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.ellipse(558, 245, 67, 27, -.45, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#f0dbab'; ctx.font = 'bold 45px serif'; ctx.fillText('好礼', 260, 460); ctx.font = '20px sans-serif'; ctx.fillText('示例礼盒 · 可替换为你的商品', 240, 685);
  await addFiles([new File([await toBlob(c, 'image/jpeg')], '示例礼盒.jpg', { type: 'image/jpeg' })]);
};

async function init() {
  if (!window.isSecureContext || !window.Worker || !window.OffscreenCanvas) { showError('请通过 HTTPS 或本机预览地址，用新版 Chrome / Edge 打开网页。'); }
  try { state.items = (await readItems()).sort((a, b) => a.created - b.created); } catch { toast('当前浏览器限制本地存储，刷新后素材可能丢失，请及时下载。'); }
  try {
    const saved = JSON.parse(localStorage.getItem('studio-design-v1') || 'null');
    if (saved) { for (const [key, id] of Object.entries({ title: 'posterTitle', subtitle: 'posterSubtitle', badge: 'posterBadge', price: 'posterPrice', points: 'posterPoints', ratio: 'posterRatio', size: 'posterSize', scale: 'posterScale' })) if (saved[key] !== undefined) $(id).value = saved[key]; }
  } catch {}
  status('浏览器本地处理'); $('statusDot').classList.add('connected');
  await select(state.items.at(-1)?.id || null);
  const background = new Image(); background.onload = () => { festiveBackground = background; if (state.mode === 'poster' || state.mode === 'suite') render(); }; background.src = new URL('backgrounds/festive.png', baseURL).href;
}
aiStudio = createAIStudio({ items: () => state.items, current, mode: () => state.mode, busy: () => state.busy, setBusy, report, toast, showError, clearError, safeName, download, makeZip, addFiles });
init().catch(showError);
