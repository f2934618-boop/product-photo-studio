import { zip } from 'fflate';
import { createAIStudio } from './ai.js';
import { icon, renderIcons } from './icons.js';
import { readItems, saveItem, deleteItem } from './storage.js';
import { canvas, toBlob, decode, previewOf, maskOf, bounds, dimensions, whiteImage, posterImage, paletteFrom, defaultSettings } from './imaging.js';

const $ = id => document.getElementById(id);
const state = { items: [], selected: null, mode: 'cutout', view: 'result', busy: false, stop: false, template: 'festive', palette: null, assets: null, variant: 'cover' };
let worker, workerId = 0, workerJob, drawRevision = 0, toastTimer, saveTimer;
let festiveBackground, aiStudio, thumbTimer, settingsGesture = false, drawFrame;
const history = new Map();
const adjustments = ['rotation', 'offsetX', 'offsetY', 'shadow', 'brightness'];
const posterFields = { title: 'posterTitle', subtitle: 'posterSubtitle', badge: 'posterBadge', price: 'posterPrice', points: 'posterPoints', ratio: 'posterRatio', size: 'posterSize', scale: 'posterScale', x: 'posterX', y: 'posterY', detailZoom: 'detailZoom', detailX: 'detailX', detailY: 'detailY' };
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
  $('headerExport').disabled = !has || busy;
  $('headerExport').hidden = state.mode === 'ai';
  $('headerExport').querySelector('span').textContent = state.mode === 'suite' ? '下载套图 ZIP' : state.mode === 'poster' ? '下载海报' : '下载图片';
  $('zoomPreview').disabled = !has;
  $('resetSettings').disabled = !has || busy;
  $('undoSettings').disabled = !has || busy || state.mode !== 'cutout' || !history.get(state.selected)?.length;
  $('suiteStrip').hidden = state.mode !== 'suite' || !has;
  $('workspaceHint').textContent = !has ? '拖入照片或粘贴截图，开始制作' : state.mode === 'suite' && state.variant === 'detail' ? '拖动画面选择细节区域 · 原图裁切放大' : state.mode === 'ai' ? '生成后请核对包装文字与商品外观' : '拖动画面调整商品位置 · 原始文件保留';
  aiStudio?.sync();
  $('imageDimensions').textContent = has ? `${current().width} × ${current().height}` : '等待图片';
  $('emptyState').hidden = has; $('previewCanvas').hidden = !has;
}
function setBusy(value) { state.busy = value; if (value) state.stop = false; controls(); if (!value) { $('progress').hidden = true; $('stopQueue').disabled = false; status('浏览器本地处理'); } }
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
    name.textContent = item.name; info.textContent = item.pending ? '正在识别商品…' : item.manual ? '原图 · 可重新抠图' : item.model === 'isnet-general-use' ? '精细抠图' : item.model === 'alpha' ? '透明素材' : '快速抠图';
    text.append(name, info); button.append(img, text); button.onclick = () => { if (!state.busy) select(item.id); }; parent.append(button);
  }
}
async function persist(item) {
  try { await saveItem(item); }
  catch { toast('浏览器存储空间不足，请及时下载；当前图片仍可编辑。'); }
}
function syncSettings() {
  const opts = { ...defaultSettings(), ...current()?.settings };
  $('ratioSelect').value = opts.ratio; $('sizeSelect').value = opts.size; $('occupancy').value = opts.occupancy;
  $('occupancyValue').textContent = `${opts.occupancy}%`; $('centerToggle').checked = opts.center;
  $('formatSelect').value = opts.background === 'transparent' ? 'png' : opts.format;
  $('formatSelect').disabled = opts.background === 'transparent';
  for (const id of adjustments) { $(id).value = opts[id]; $(`${id}Value`).textContent = `${opts[id]}${id === 'rotation' ? '°' : ['shadow', 'brightness'].includes(id) ? '%' : ''}`; }
  for (const b of $('backgroundOptions').querySelectorAll('button')) b.classList.toggle('selected', b.dataset.bg === opts.background);
}
async function select(id) {
  state.selected = id;
  if (current()) current().settings = { ...defaultSettings(), ...current().settings };
  if (state.assets) { state.assets.bitmap.close(); state.assets = null; }
  listImages(); syncSettings(); controls(); await render(); queueThumbnails();
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
  const opts = { template: state.template, palette: state.palette };
  for (const [key, id] of Object.entries(posterFields)) opts[key] = $(id).type === 'range' ? +$(id).value : $(id).value;
  return opts;
}
const variants = () => [['cover', '封面'], ['product', '商品展示'], ['detail', '细节展示'], ...(posterOptions().points.trim() ? [['info', '商品信息']] : [])];
function queueThumbnails() { clearTimeout(thumbTimer); thumbTimer = setTimeout(renderThumbnails, 180); }
async function renderThumbnails() {
  if (!current() || !['suite', 'poster'].includes(state.mode)) return;
  try {
    const item = current(), data = await assets(), opts = posterOptions(); if (current() !== item) return;
    for (const button of document.querySelectorAll('[data-template]')) {
      const c = button.querySelector('canvas'), output = posterImage(data.bitmap, data.mask, { ...opts, template: button.dataset.template, palette: null }, 'cover', 180, festiveBackground);
      c.width = output.width; c.height = output.height; c.getContext('2d').drawImage(output, 0, 0);
    }
    const strip = $('suiteStrip'); strip.replaceChildren();
    for (const [index, [variant, name]] of variants().entries()) {
      const button = document.createElement('button'); button.className = `suite-page${state.variant === variant ? ' selected' : ''}`; button.dataset.variant = variant; button.setAttribute('aria-label', `预览${name}`); button.setAttribute('aria-pressed', state.variant === variant);
      const thumb = posterImage(data.bitmap, data.mask, opts, variant, 100, festiveBackground), text = document.createElement('span'), small = document.createElement('small');
      text.textContent = name; small.textContent = `第 ${index + 1} 页`; text.append(small); button.append(thumb, text);
      button.onclick = () => { state.variant = variant; for (const b of strip.children) { b.classList.toggle('selected', b === button); b.setAttribute('aria-pressed', b === button); } render(); };
      strip.append(button);
    }
  } catch (error) { showError(error); }
}
function rememberSettings(item = current()) {
  if (!item) return; const steps = history.get(item.id) || [], copy = { ...item.settings };
  if (JSON.stringify(steps.at(-1)) !== JSON.stringify(copy)) steps.push(copy);
  if (steps.length > 25) steps.shift(); history.set(item.id, steps);
}
function scheduleRender() { cancelAnimationFrame(drawFrame); drawFrame = requestAnimationFrame(render); }
function saveDesign() { try { localStorage.setItem('studio-design-v1', JSON.stringify(posterOptions())); } catch {} }
function posterChanged() {
  for (const id of ['posterScale', 'posterX', 'posterY', 'detailZoom', 'detailX', 'detailY']) $(`${id}Value`).textContent = `${$(id).value}${id === 'detailZoom' ? '×' : ['posterScale', 'detailX', 'detailY'].includes(id) ? '%' : ''}`;
  if (!variants().some(([v]) => v === state.variant)) state.variant = 'cover';
  saveDesign(); scheduleRender(); queueThumbnails();
}
async function render() {
  const revision = ++drawRevision, item = current(); if (!item || state.mode === 'ai') return;
  try {
    const { bitmap, mask } = await assets(item); if (revision !== drawRevision) return;
    let result;
    if (state.mode === 'cutout') result = whiteImage(bitmap, mask, item.settings, 1000);
    else result = posterImage(bitmap, mask, posterOptions(), state.mode === 'suite' ? state.variant : 'cover', 1100, festiveBackground);
    const target = $('previewCanvas'); target.width = result.width; target.height = result.height; const ctx = target.getContext('2d'); ctx.clearRect(0, 0, target.width, target.height);
    if ((state.view === 'original' || item.pending) && state.mode === 'cutout') {
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
    $('previewStage').classList.toggle('transparent-stage', state.mode === 'cutout' && item.settings.background === 'transparent');
    const label = state.mode === 'cutout' ? item.pending ? '识别中 · 原图预览' : item.manual ? '未抠图 · 可重新抠图或手动修补' : '原图细节保留' : state.mode === 'suite' ? variants().find(([v]) => v === state.variant)?.[1] : '封面海报';
    $('previewInfo').textContent = `${dims[0]} × ${dims[1]} px · ${label}`;
    controls();
  } catch (error) { showError(error); }
}
function settingsChanged(remember = true) {
  const item = current(); if (!item) return;
  if (remember && !settingsGesture) rememberSettings(item);
  Object.assign(item.settings, { ratio: $('ratioSelect').value, size: $('sizeSelect').value, occupancy: +$('occupancy').value, center: $('centerToggle').checked, format: $('formatSelect').value });
  for (const id of adjustments) item.settings[id] = +$(id).value;
  syncSettings(); scheduleRender(); clearTimeout(saveTimer); saveTimer = setTimeout(() => persist(item), 250);
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
  const model = $('modelSelect').value, shouldSegment = state.mode !== 'ai';
  try {
    for (const file of queue) {
      if (state.stop) break;
      report(`正在处理 ${count + 1} / ${queue.length} · ${file.name}`);
      try {
        if (file.size > 40 * 1024 ** 2) throw new Error('文件超过 40 MB。');
        if (!/image\/(jpeg|png|webp|bmp|x-ms-bmp)/.test(file.type)) throw new Error('请使用 JPG、PNG、WebP 或 BMP 静态图片。');
        const bitmap = await decode(file), preview = previewOf(bitmap), item = { id: crypto.randomUUID(), name: file.name, original: file, preview: await toBlob(preview, 'image/jpeg', .9), width: bitmap.width, height: bitmap.height, created: Date.now(), settings: defaultSettings(), pending: shouldSegment, manual: true, model }; bitmap.close();
        const full = canvas(preview.width, preview.height); full.getContext('2d').fillStyle = '#fff'; full.getContext('2d').fillRect(0, 0, full.width, full.height);
        item.mask = item.autoMask = await toBlob(full); state.items.push(item); await persist(item); await select(item.id);
        try {
          if (state.stop) throw new DOMException('Cancelled', 'AbortError');
          if (shouldSegment) { const result = await segment(preview, model); item.mask = item.autoMask = await toBlob(result.mask); item.model = result.model; item.manual = false; }
        } catch (error) {
          if (error.name !== 'AbortError') errors.push(`${file.name}：${error.message} 原图已保留，可重新抠图或用“圈选保留”手动处理。`);
        }
        item.pending = false; await persist(item); await select(item.id); count++;
      } catch (error) { errors.push(`${file.name}：${error.message}`); count++; }
    }
  } finally { setBusy(false); if (errors.length) showError(errors.join('\n')); else toast(state.stop ? '已取消处理，原图与已完成结果均已保留。' : shouldSegment ? `已处理 ${count} 张图片` : `已添加 ${count} 张商品素材`); }
}
function cancelProcessing() {
  state.stop = true; $('stopQueue').disabled = true;
  if (workerJob) {
    const job = workerJob; workerJob = null; clearTimeout(job.timer); worker?.terminate(); worker = null;
    job.reject(new DOMException('Cancelled', 'AbortError'));
  }
  toast('已取消，正在保留当前素材。');
}
async function reprocess() {
  const item = current(); if (!item || state.busy) return;
  setBusy(true); clearError(); report('正在重新抠图', '重新抠图成功后会替换当前修补结果');
  try {
    const bitmap = await decode(item.original); const preview = previewOf(bitmap); bitmap.close();
    const result = await segment(preview, $('modelSelect').value);
    item.mask = item.autoMask = await toBlob(result.mask); item.model = result.model; item.manual = false;
    await persist(item); await select(item.id); toast('已完成重新抠图。');
  } catch (error) { if (error.name === 'AbortError') toast('已取消，之前的抠图结果保留。'); else showError(error); }
  finally { setBusy(false); }
}
function download(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name;
  a.textContent = name; a.className = 'download-file';
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
      if (state.stop) break;
      report(`正在打包 ${++index} / ${state.items.length}`);
      const { blob, name } = await exportWhite(item); files[`${String(index).padStart(2, '0')}_${name}`] = new Uint8Array(await blob.arrayBuffer());
    }
    if (Object.keys(files).length) { download(await makeZip(files), '商品白底图.zip'); toast(state.stop ? '已停止，已完成的图片已打包。' : '批量图片已打包下载。'); }
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
    cutout: ['白底精修', '白底精修', '保留商品细节，做一张干净的主图。', ''],
    poster: ['封面海报', '封面海报', '选择版式，编辑文案，预览你的商品封面。', ''],
    suite: ['详情套图', '详情套图', '从封面到细节，逐页调整后打包下载。', ''],
    ai: ['AI 创作', 'AI 创作', '选择商品素材，编辑分镜，生成图片。', ''],
  }[mode];
  ['breadcrumb', 'pageTitle', 'pageDescription', 'eyebrow'].forEach((id, i) => $(id).textContent = texts[i]);
  $('editorLayout').hidden = mode === 'ai'; $('aiPanel').hidden = mode !== 'ai';
  $('cutoutControls').hidden = mode !== 'cutout'; $('posterControls').hidden = mode !== 'poster' && mode !== 'suite';
  $('previewTabs').hidden = mode !== 'cutout'; $('designTitle').textContent = mode === 'suite' ? '套图设计' : '封面设计';
  $('designExport').textContent = mode === 'suite' ? '下载详情套图 ZIP' : '下载封面海报';
  $('designHelp').textContent = mode === 'suite' ? '默认导出 3 张图；填写卖点后增加商品信息页。' : '模板排版免费，商品使用原图抠图素材。';
  $('modeTag').textContent = mode === 'ai' ? '需自备模型接口' : '浏览器免费处理';
  document.querySelector('.privacy').textContent = mode === 'ai' ? '◎ 仅生成时发送到已配置接口' : '◎ 图片留在本机';
  $('batchExport').hidden = mode !== 'cutout'; controls(); render(); queueThumbnails();
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

for (const button of document.querySelectorAll('[data-mode]')) { button.title = button.textContent.trim(); button.setAttribute('aria-label', button.textContent.trim()); button.onclick = () => { if (state.busy) { toast('请先完成或取消当前处理。'); return; } switchMode(button.dataset.mode); if (button.dataset.ai) aiStudio.setMode(button.dataset.ai); }; }
for (const button of document.querySelectorAll('[data-view]')) button.onclick = () => { state.view = button.dataset.view; for (const b of document.querySelectorAll('[data-view]')) b.classList.toggle('selected', b === button); render(); };
for (const button of document.querySelectorAll('[data-bg]')) button.onclick = () => { const item = current(); if (!item || state.busy) return; rememberSettings(); item.settings.background = button.dataset.bg; if (button.dataset.bg === 'transparent') $('formatSelect').value = 'png'; settingsChanged(false); };
for (const id of ['ratioSelect', 'sizeSelect', 'occupancy', 'centerToggle', 'formatSelect', ...adjustments]) {
  const input = $(id); input.addEventListener('input', () => settingsChanged());
  if (input.type === 'range') input.addEventListener('pointerdown', () => { rememberSettings(); settingsGesture = true; });
}
document.addEventListener('pointerup', () => { settingsGesture = false; });
document.addEventListener('pointercancel', () => { settingsGesture = false; });
for (const id of Object.values(posterFields)) $(id).addEventListener('input', posterChanged);
for (const button of document.querySelectorAll('[data-template]')) button.onclick = () => { state.template = button.dataset.template; state.palette = null; $('paletteStatus').textContent = '只提取配色，不复制图中商品与文字。'; for (const b of document.querySelectorAll('[data-template]')) b.classList.toggle('selected', b === button); posterChanged(); };
$('paletteButton').onclick = () => $('paletteInput').click();
$('paletteInput').onchange = async event => { try { const file = event.target.files[0]; if (!file) return; state.palette = await paletteFrom(file); $('paletteStatus').textContent = '已应用参考图配色，点击风格卡片可恢复默认。'; posterChanged(); } catch (error) { showError(error); } event.target.value = ''; };
$('addImages').onclick = () => $('fileInput').click();
$('uploadZone').onclick = event => { if (event.target.closest('button')) return; if (!state.busy) $('fileInput').click(); };
$('uploadZone').onkeydown = event => { if (event.target === $('uploadZone') && ['Enter', ' '].includes(event.key)) { event.preventDefault(); if (!state.busy) $('fileInput').click(); } };
$('fileInput').onchange = event => { addFiles(event.target.files); event.target.value = ''; };
for (const type of ['dragenter', 'dragover']) $('uploadZone').addEventListener(type, event => { event.preventDefault(); $('uploadZone').classList.add('drag-over'); });
for (const type of ['dragleave', 'drop']) $('uploadZone').addEventListener(type, event => { event.preventDefault(); $('uploadZone').classList.remove('drag-over'); if (type === 'drop') addFiles(event.dataTransfer.files); });
document.addEventListener('paste', event => { if (/INPUT|TEXTAREA/.test(document.activeElement.tagName)) return; const files = [...(event.clipboardData?.files || [])]; if (files.length) { event.preventDefault(); addFiles(files); } });
document.addEventListener('dragover', event => event.preventDefault()); document.addEventListener('drop', event => event.preventDefault());
$('stopQueue').onclick = cancelProcessing;
$('reprocessButton').onclick = reprocess; $('repairButton').onclick = openRepair;
$('exportButton').onclick = exportCurrent; $('batchExport').onclick = exportBatch; $('designExport').onclick = exportDesign;
$('headerExport').onclick = () => state.mode === 'cutout' ? exportCurrent() : exportDesign();
$('applyAll').onclick = async () => { if (!current()) return; const opts = { ...current().settings }; for (const item of state.items) { rememberSettings(item); item.settings = { ...opts }; await persist(item); } controls(); toast('已应用到全部图片。'); };
$('removeItem').onclick = async () => { if (!current() || state.busy) return; const id = state.selected; try { await deleteItem(id); state.items = state.items.filter(item => item.id !== id); await select(state.items.at(-1)?.id || null); } catch { showError('无法移出本地素材，请刷新后重试。'); } };
for (const id of ['helpButton', 'aboutButton']) $(id).onclick = () => $('helpDialog').showModal(); $('closeHelp').onclick = () => $('helpDialog').close();
$('sampleButton').onclick = () => $('helpDialog').showModal();

$('resetSettings').onclick = async () => { if (!current() || state.busy) return; rememberSettings(); current().settings = defaultSettings(); syncSettings(); await persist(current()); render(); toast('画面设置已重置，仍可撤销。'); };
$('undoSettings').onclick = async () => { const item = current(), previous = history.get(state.selected)?.pop(); if (!item || !previous) return; item.settings = previous; syncSettings(); await persist(item); render(); };
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !document.querySelector('dialog[open]') && !$('undoSettings').disabled) { event.preventDefault(); $('undoSettings').click(); }
});
const drag = { start: null };
$('previewCanvas').addEventListener('pointerdown', event => {
  if (event.button !== 0 || !current() || state.busy || (state.mode === 'cutout' && state.view !== 'result')) return;
  const rect = event.currentTarget.getBoundingClientRect();
  drag.start = { clientX: event.clientX, clientY: event.clientY, rect, opts: state.mode === 'cutout' ? { ...current().settings } : posterOptions() };
  if (state.mode === 'cutout') rememberSettings();
  event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault();
});
$('previewCanvas').addEventListener('pointermove', event => {
  if (!drag.start) return;
  const { rect, opts, clientX, clientY } = drag.start, dx = (event.clientX - clientX) / rect.width * 100, dy = (event.clientY - clientY) / rect.height * 100;
  const clamp = (n, limit) => Math.round(Math.max(-limit, Math.min(limit, n)));
  if (state.mode === 'cutout') {
    current().settings.offsetX = clamp(opts.offsetX + dx, 35); current().settings.offsetY = clamp(opts.offsetY + dy, 35); syncSettings();
  } else if (state.mode === 'suite' && state.variant === 'detail') {
    $('detailX').value = Math.max(0, Math.min(100, opts.detailX - dx)); $('detailY').value = Math.max(0, Math.min(100, opts.detailY - dy));
  } else { $('posterX').value = clamp(opts.x + dx, 30); $('posterY').value = clamp(opts.y + dy, 25); }
  if (state.mode !== 'cutout') posterChanged(); else scheduleRender();
});
function endDrag() { if (!drag.start) return; drag.start = null; if (state.mode === 'cutout') persist(current()); else { saveDesign(); queueThumbnails(); } controls(); }
$('previewCanvas').addEventListener('pointerup', endDrag); $('previewCanvas').addEventListener('pointercancel', endDrag);
async function showLarge(image) {
  const target = $('largeCanvas'); target.width = image.width; target.height = image.height; target.getContext('2d').drawImage(image, 0, 0); $('previewDialog').showModal();
}
$('zoomPreview').onclick = async () => {
  if (!current()) return;
  try { const { bitmap, mask } = await assets(); await showLarge(state.mode === 'cutout' ? whiteImage(bitmap, mask, current().settings, 2400) : posterImage(bitmap, mask, posterOptions(), state.mode === 'suite' ? state.variant : 'cover', 2400, festiveBackground)); } catch (error) { showError(error); }
};
$('closePreview').onclick = () => $('previewDialog').close();
const settingsPanel = document.querySelector('.ai-settings'); $('apiDialogBody').append(settingsPanel);
const aiBoard = document.createElement('div'); aiBoard.className = 'ai-board';
aiBoard.append($('aiConnectionNotice'), document.querySelector('.ai-result-actions'), $('aiResults')); document.querySelector('.ai-grid').append(aiBoard);
const aiSteps = document.createElement('div'); aiSteps.id = 'aiSteps'; aiSteps.className = 'workflow-steps'; aiSteps.setAttribute('aria-label', '商品图创作流程');
for (const [step, label] of [['input', '素材与要求'], ['plan', '确认分镜'], ['results', '生成结果']]) { const b = document.createElement('button'); b.dataset.aiStep = step; const n = document.createElement('span'); n.textContent = aiSteps.children.length + 1; b.append(n, document.createTextNode(label)); aiSteps.append(b); }
$('aiPanel').prepend(aiSteps);
const planBoard = document.createElement('section'); planBoard.id = 'planBoard'; planBoard.className = 'plan-board'; planBoard.hidden = true;
const planField = $('aiPlan').closest('.field'), planActions = planField.querySelector('.plan-actions');
document.querySelector('.ai-form').append(planActions); planBoard.append(planField);
const planList = document.createElement('div'); planList.id = 'planList'; planList.className = 'plan-list'; planBoard.append(planList); planField.querySelector('textarea').hidden = true;
aiBoard.insertBefore(planBoard, document.querySelector('.ai-result-actions'));
const generateActions = document.createElement('div'); generateActions.className = 'generate-actions'; generateActions.append($('aiSelected'), $('aiGenerate'), $('cancelAi'));
aiBoard.append(generateActions);
for (const id of ['apiSettingsButton', 'connectModel']) $(id).onclick = () => $('apiDialog').showModal();
$('closeApi').onclick = () => $('apiDialog').close();
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('themeToggle').innerHTML = icon(theme === 'dark' ? 'sun' : 'moon');
  $('themeToggle').setAttribute('aria-label', theme === 'dark' ? '切换浅色外观' : '切换深色外观');
  try { localStorage.setItem('studio-theme', theme); } catch {}
}
$('themeToggle').onclick = () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
renderIcons();
try { applyTheme(localStorage.getItem('studio-theme') || 'light'); } catch { applyTheme('light'); }

async function init() {
  if (!window.isSecureContext || !window.Worker || !window.OffscreenCanvas) { showError('请通过 HTTPS 或本机预览地址，用新版 Chrome / Edge 打开网页。'); }
  try { state.items = (await readItems()).sort((a, b) => a.created - b.created); for (const item of state.items) item.pending = false; } catch { toast('当前浏览器限制本地存储，刷新后素材可能丢失，请及时下载。'); }
  try {
    const saved = JSON.parse(localStorage.getItem('studio-design-v1') || 'null');
    if (saved) { for (const [key, id] of Object.entries(posterFields)) if (saved[key] !== undefined) $(id).value = saved[key]; state.template = saved.template || 'festive'; state.palette = saved.palette || null; for (const b of document.querySelectorAll('[data-template]')) b.classList.toggle('selected', b.dataset.template === state.template); }
  } catch {}
  status('浏览器本地处理'); $('statusDot').classList.add('connected');
  await select(state.items.at(-1)?.id || null);
  const background = new Image(); background.onload = () => { festiveBackground = background; if (state.mode === 'poster' || state.mode === 'suite') { render(); queueThumbnails(); } }; background.src = new URL('backgrounds/festive.png', baseURL).href;
}
aiStudio = createAIStudio({ items: () => state.items, current, mode: () => state.mode, busy: () => state.busy, setBusy, report, toast, showError, clearError, safeName, download, makeZip, addFiles, showLarge });
init().catch(showError);
