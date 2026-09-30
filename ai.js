import { canvas, decode, fittedSize, toBlob } from './imaging.js';
import { defaultPlan, imagePrompt, validateConfig, generateImages, analyzeImages } from './ai-api.js';
import { saveResult, readResults, deleteResult } from './storage.js';

export function createAIStudio(hooks) {
  const $ = id => document.getElementById(id);
  let config = null, aborter = null, productIds = new Set(), results = [], activeMode = 'detail', lastLibrary = '', selectionTouched = false;
  const names = { detail: '全品类商品图', scene: '商品场景 / 广告封面', style: '风格复刻', clothing: '服装套图', retouch: '批量精修' };
  const selected = () => hooks.items().filter(item => productIds.has(item.id));
  let stage = 'input';
  function setStage(value) {
    stage = value;
    for (const b of document.querySelectorAll('[data-ai-step]')) { b.classList.toggle('active', b.dataset.aiStep === stage); b.setAttribute('aria-pressed', b.dataset.aiStep === stage); }
    $('planBoard').hidden = stage !== 'plan'; $('aiResults').hidden = stage === 'plan'; document.querySelector('.ai-result-actions').hidden = stage === 'plan';
    $('aiGenerate').hidden = stage !== 'plan';
    if (stage === 'plan') $('planBoard').scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }
  function renderPlan() {
    const parent = $('planList'); parent.replaceChildren();
    const shots = $('aiPlan').value.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 8);
    $('aiPlan').closest('.field').querySelector('label').textContent = `套图分镜 · ${shots.length} 张`;
    for (const [i, shot] of shots.entries()) {
      const card = document.createElement('article'); card.className = 'plan-card';
      const top = document.createElement('div'), label = document.createElement('label'), check = document.createElement('input'), count = document.createElement('span');
      check.type = 'checkbox'; check.checked = true; check.setAttribute('aria-label', `生成第 ${i + 1} 张`); label.append(check, document.createTextNode(`第 ${i + 1} 张`)); count.textContent = '可编辑分镜'; top.append(label, count);
      const input = document.createElement('textarea'); input.value = shot; input.rows = 3; input.maxLength = 650; input.setAttribute('aria-label', `第 ${i + 1} 张分镜`);
      input.oninput = () => { $('aiPlan').value = [...parent.querySelectorAll('textarea')].map(t => t.value.replaceAll('\n', ' ')).join('\n'); };
      check.onchange = () => card.classList.toggle('excluded', !check.checked); card.append(top, input); parent.append(card);
    }
  }
  for (const button of document.querySelectorAll('[data-ai-step]')) button.onclick = () => setStage(button.dataset.aiStep);
  function sync() {
    const items = hooks.items(), valid = new Set(items.map(i => i.id)); productIds = new Set([...productIds].filter(id => valid.has(id)));
    if (!selectionTouched && !productIds.size && hooks.current()) productIds.add(hooks.current().id);
    const key = items.map(i => i.id).join(',') + ':' + [...productIds].join(',');
    if (key !== lastLibrary) {
      const parent = $('aiProducts'); for (const img of parent.querySelectorAll('img')) URL.revokeObjectURL(img.src); parent.replaceChildren();
      for (const item of items) {
        const label = document.createElement('label'); label.className = 'ai-product'; label.title = item.name;
        const input = document.createElement('input'); input.type = 'checkbox'; input.checked = productIds.has(item.id); input.setAttribute('aria-label', `用于生成：${item.name}`);
        const img = document.createElement('img'); img.src = URL.createObjectURL(item.preview); img.alt = '';
        const title = document.createElement('span'); title.textContent = item.name;
        input.onchange = () => { if (input.checked && activeMode !== 'retouch' && productIds.size >= 6) { input.checked = false; hooks.toast('同一商品最多选择 6 张参考素材。'); return; } selectionTouched = true; input.checked ? productIds.add(item.id) : productIds.delete(item.id); sync(); };
        label.append(input, img, title); parent.append(label);
      }
      lastLibrary = key;
    }
    const has = !!selected().length, busy = hooks.busy();
    $('aiGenerate').disabled = !has || !config || busy;
    $('analyzeProduct').disabled = !has || !config || busy || (config.provider === 'openai' && (!config.analysisEndpoint || !config.analysisModel));
    $('aiDownloadAll').disabled = !results.length || busy;
    $('selectAiAll').disabled = busy; $('makePlan').disabled = busy;
    $('aiEmpty').hidden = !!results.length;
    $('aiConnectionNotice').querySelector('strong').textContent = config ? `模型已配置 · ${config.model}` : '先连接生图模型';
    $('aiConnectionNotice').querySelector('p').textContent = config ? '连接已保存，尚未验证。生成时发送到所填服务商。' : '抠图与模板免费使用；AI 创作需接入图片模型。';
    $('connectModel').textContent = config ? '修改连接' : '连接模型';
    for (const input of $('aiProducts').querySelectorAll('input')) input.disabled = busy;
    $('aiSelected').textContent = has ? `已选 ${selected().length} 张素材${activeMode === 'retouch' ? '，每张分别精修' : '，作为同一商品的参考图'}${config ? '' : ' · 请先填写模型接口'}` : '先添加商品图片，再勾选本次使用的素材。';
  }
  function setMode(mode) {
    activeMode = mode; $('aiMode').value = mode; $('aiHeading').textContent = names[mode];
    $('aiIntro').textContent = mode === 'retouch' ? '每张商品图单独精修；可随时停止队列，完成的图片会保留。' : mode === 'style' ? '上传参考图，提取设计语言与构图，让自己的商品融入同一风格。' : mode === 'clothing' ? '模特试穿、白底、人台与细节，按可编辑分镜逐张生成。' : '同一商品支持多角度素材，先规划内容，再批量生成整套商品图。';
    $('aiProductHint').textContent = mode === 'retouch' ? '最多 50 张，逐张精修；素材之间不会合并。' : '同一商品最多 6 张不同角度素材。';
    $('clothingSet').disabled = mode !== 'clothing'; $('aiCount').disabled = mode === 'retouch';
    $('aiPlan').value = defaultPlan(mode, +$('aiCount').value, $('clothingSet').value);
    renderPlan(); setStage('input');
    $('aiGenerate').textContent = mode === 'retouch' ? '开始批量精修' : '按分镜生成图片';
    if (mode !== 'retouch' && productIds.size > 6) productIds = new Set([...productIds].slice(0, 6));
    for (const b of document.querySelectorAll('[data-ai]')) b.classList.toggle('active', b.dataset.ai === mode && hooks.mode() === 'ai');
    if (hooks.mode() === 'ai') { $('breadcrumb').textContent = names[mode]; $('pageTitle').textContent = names[mode]; $('pageDescription').textContent = $('aiIntro').textContent; }
    sync();
  }
  async function normalized(blob, max = 2048) {
    if (blob.size > 40 * 1024 ** 2) throw new Error('参考图不能超过 40 MB。');
    const image = await decode(blob), c = canvas(...fittedSize(image.width, image.height, max)), ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(image, 0, 0, c.width, c.height); image.close();
    return toBlob(c, 'image/jpeg', .94);
  }
  function settings() {
    return { mode: activeMode, brief: $('aiPrompt').value.trim(), platform: $('aiPlatform').value, language: $('aiLanguage').value, ratio: $('aiRatio').value, quality: $('aiQuality').value, reference: $('aiReference').files[0] };
  }
  function start() { aborter = new AbortController(); hooks.setBusy(true); hooks.clearError(); $('cancelAi').hidden = false; $('stopQueue').hidden = true; }
  function finish() { aborter = null; $('cancelAi').hidden = true; $('stopQueue').hidden = false; hooks.setBusy(false); sync(); }
  function failed(error) { if (error.name === 'AbortError') hooks.toast('已停止，完成的图片已保留。'); else if (error.name === 'TimeoutError') hooks.showError('接口响应超时，完成的结果已保留；重试可能产生新的接口费用。'); else hooks.showError(error); }
  async function addResult(blob, job, restored = null) {
    // Decode before accepting a model response; an API success alone isn't an image.
    const image = await decode(blob); const size = `${image.width} × ${image.height}`; image.close();
    const index = results.length + 1, extension = blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/webp' ? 'webp' : 'png';
    const result = restored || { id: crypto.randomUUID(), created: Date.now(), blob, job, name: `${String(index).padStart(2, '0')}_${hooks.safeName(job.name)}_${Date.now().toString(36)}.${extension}` }; results.push(result);
    if (!restored) try { await saveResult(result); } catch { hooks.toast('结果存储空间不足，请及时下载本张图片。'); }
    const card = document.createElement('article'); card.className = 'ai-result';
    const img = document.createElement('img'); img.alt = job.name; img.src = URL.createObjectURL(blob);
    img.tabIndex = 0; img.setAttribute('role', 'button'); img.setAttribute('aria-label', `放大 ${job.name}`);
    const preview = async () => { const bitmap = await decode(blob); await hooks.showLarge(bitmap); bitmap.close(); }; img.onclick = preview; img.onkeydown = event => { if (event.key === 'Enter') preview(); };
    const title = document.createElement('h4'); title.textContent = job.name;
    const info = document.createElement('p'); info.className = 'field-help'; info.textContent = `${size} · 请核对包装文字与商品细节`;
    const a = document.createElement('a'); a.href = img.src; a.download = result.name; a.textContent = '下载图片';
    const edit = document.createElement('button'); edit.className = 'text-button'; edit.textContent = '继续修改';
    edit.onclick = () => { setMode(job.options.mode); for (const [key, id] of Object.entries({ brief: 'aiPrompt', platform: 'aiPlatform', language: 'aiLanguage', ratio: 'aiRatio', quality: 'aiQuality' })) $(id).value = job.options[key]; $('aiPlan').value = job.shot; selectionTouched = true; productIds = new Set(job.ids); renderPlan(); setStage('plan'); sync(); hooks.toast('已恢复分镜与参数，参考图请重新选择。'); };
    const reuse = document.createElement('button'); reuse.className = 'text-button'; reuse.textContent = '加入素材'; reuse.onclick = () => hooks.addFiles([new File([blob], result.name, { type: blob.type })]);
    const remove = document.createElement('button'); remove.className = 'text-button'; remove.textContent = '移除'; remove.onclick = async () => { try { await deleteResult(result.id); results = results.filter(r => r.id !== result.id); URL.revokeObjectURL(img.src); card.remove(); sync(); } catch { hooks.toast('无法移除本地结果，请重试。'); } };
    const actions = document.createElement('div'); actions.className = 'result-tools'; actions.append(edit, reuse, remove); card.append(img, title, info, a, actions); $('aiResults').prepend(card);
    sync();
  }
  $('apiProvider').onchange = () => {
    if ($('apiProvider').value === 'gemini') { $('apiEndpoint').placeholder = 'https://generativelanguage.googleapis.com/v1beta'; if (!$('apiEndpoint').value) $('apiEndpoint').value = 'https://generativelanguage.googleapis.com/v1beta'; $('apiModel').placeholder = '填写支持图片生成的 Gemini 模型名'; }
    else { $('apiEndpoint').placeholder = 'https://你的服务商/v1/images/edits'; $('apiModel').placeholder = '服务商提供的图像编辑模型名'; }
  };
  $('saveApi').onclick = () => {
    try {
      config = validateConfig({ provider: $('apiProvider').value, endpoint: $('apiEndpoint').value, model: $('apiModel').value, key: $('apiKey').value, analysisEndpoint: $('analysisEndpoint').value, analysisModel: $('analysisModel').value });
      const { key, ...publicConfig } = config; try { localStorage.setItem('studio-api-config', JSON.stringify(publicConfig)); } catch {}
      $('apiStatus').textContent = `已保存本标签页配置 · ${new URL(config.endpoint).hostname}。尚未验证接口，刷新后密钥清除。`; sync(); $('apiDialog').close(); hooks.toast('配置已保存，尚未调用接口。');
    } catch (error) { $('apiStatus').textContent = error.message; }
  };
  $('makePlan').textContent = '规划分镜';
  $('makePlan').onclick = () => { $('aiPlan').value = defaultPlan(activeMode, +$('aiCount').value, $('clothingSet').value); renderPlan(); setStage('plan'); hooks.toast('已列出默认分镜，可逐张编辑或取消勾选。'); };
  $('aiMode').onchange = () => setMode($('aiMode').value);
  $('aiCount').onchange = $('clothingSet').onchange = () => { $('aiPlan').value = defaultPlan(activeMode, +$('aiCount').value, $('clothingSet').value); renderPlan(); };
  $('selectAiAll').onclick = () => { selectionTouched = true; productIds = new Set(hooks.items().slice(0, activeMode === 'retouch' ? 50 : 6).map(i => i.id)); sync(); };
  $('cancelAi').onclick = () => aborter?.abort();
  $('analyzeProduct').onclick = async () => {
    if (hooks.busy() || !config) return; const items = selected().slice(0, 6), options = settings(); if (!items.length) return;
    start(); hooks.report('正在分析商品与规划分镜', '发送到你配置的视觉分析接口');
    try {
      const images = []; for (const item of items) images.push(await normalized(item.original, 1024));
      const result = await analyzeImages({ ...config }, { images, brief: options.brief, mode: options.mode, count: +$('aiCount').value, language: options.language }, aborter.signal);
      $('aiPlan').value = result.plan;
      renderPlan(); setStage('plan');
      let detail = $('aiAnalysis'); if (!detail) { detail = document.createElement('p'); detail.id = 'aiAnalysis'; detail.className = 'analysis-summary'; $('aiPlan').after(detail); }
      detail.textContent = result.observations; hooks.toast('已生成分镜，请检查识别结果和商品信息。');
    } catch (error) { failed(error); } finally { finish(); }
  };
  $('aiGenerate').onclick = async () => {
    if (hooks.busy() || !config) return;
    const items = selected(), options = settings(), snapshot = { ...config };
    if (!items.length) return;
    if (options.mode === 'style' && !options.reference) { hooks.toast('风格复刻需要先选择一张参考图。'); return; }
    const shots = [...$('planList').querySelectorAll('.plan-card')].filter(card => card.querySelector('input').checked).map(card => card.querySelector('textarea').value.trim()).filter(Boolean).slice(0, 8);
    if (!shots.length) { hooks.toast('请先生成或填写分镜。'); return; }
    start(); setStage('results');
    try {
      const reference = options.reference ? await normalized(options.reference) : null;
      const images = new Map(); for (const item of items) images.set(item.id, await normalized(item.original));
      const jobs = options.mode === 'retouch' ? items.map(item => ({ ids: [item.id], shot: shots[0], name: `${hooks.safeName(item.name)}_精修` })) : shots.map((shot, i) => ({ ids: items.slice(0, 6).map(item => item.id), shot, name: `${names[options.mode]}_${i + 1}` }));
      for (const [index, job] of jobs.entries()) {
        if (aborter.signal.aborted) throw new DOMException('Stopped', 'AbortError');
        hooks.report(`正在生成 ${index + 1} / ${jobs.length} · ${job.name}`, `模型 ${snapshot.model} · 由 ${new URL(snapshot.endpoint).hostname} 处理`);
        const sources = job.ids.map(id => images.get(id)); if (reference) sources.push(reference);
        const prompt = imagePrompt({ ...options, shot: job.shot, index, total: jobs.length, productCount: job.ids.length, references: !!reference });
        const blobs = await generateImages(snapshot, { images: sources, prompt, ratio: options.ratio, quality: options.quality }, aborter.signal);
        for (const blob of blobs) await addResult(blob, { ...job, options });
      }
      hooks.toast('生成完成，请核对商品细节后下载。');
    } catch (error) { failed(error); } finally { finish(); }
  };
  $('aiDownloadAll').onclick = async () => {
    if (!results.length || hooks.busy()) return; hooks.setBusy(true); hooks.report('正在打包生成结果…');
    try { const files = {}; for (const r of results) files[r.name] = new Uint8Array(await r.blob.arrayBuffer()); hooks.download(await hooks.makeZip(files), 'AI商品图.zip'); }
    catch (error) { hooks.showError(error); } finally { hooks.setBusy(false); }
  };
  try {
    const saved = JSON.parse(localStorage.getItem('studio-api-config') || 'null');
    if (saved) for (const [key, id] of Object.entries({ provider: 'apiProvider', endpoint: 'apiEndpoint', model: 'apiModel', analysisEndpoint: 'analysisEndpoint', analysisModel: 'analysisModel' })) $(id).value = saved[key] || '';
  } catch {}
  setMode('detail');
  readResults().then(async saved => { for (const r of saved.sort((a, b) => a.created - b.created)) { try { await addResult(r.blob, r.job, r); } catch {} } }).catch(() => {});
  return { sync, setMode };
}
