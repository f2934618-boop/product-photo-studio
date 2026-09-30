export const bgColors = { white: '#ffffff', warm: '#f7f5f0', gray: '#ebedef' };
export const defaultSettings = () => ({ background: 'white', ratio: 'square', size: '1600', occupancy: 85, center: true, format: 'jpg' });
export function canvas(width, height) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(width)); c.height = Math.max(1, Math.round(height)); return c; }
export function toBlob(c, type = 'image/png', quality = .96) { return new Promise((resolve, reject) => c.toBlob(b => b ? resolve(b) : reject(new Error('图片导出失败，可能尺寸过大。')), type, quality)); }
export async function decode(blob) {
  const bitmap = await createImageBitmap(blob);
  if (bitmap.width * bitmap.height > 50000000) { bitmap.close(); throw new Error('图片不能超过 5000 万像素，请先缩小。'); }
  return bitmap;
}
export function fittedSize(width, height, maxSide) { const factor = Math.min(1, maxSide / Math.max(width, height)); return [Math.round(width * factor), Math.round(height * factor)]; }
export function previewOf(bitmap) { const c = canvas(...fittedSize(bitmap.width, bitmap.height, 1536)); c.getContext('2d').drawImage(bitmap, 0, 0, c.width, c.height); return c; }
export function maskOf(alpha, width, height) {
  const c = canvas(width, height), ctx = c.getContext('2d'), d = ctx.createImageData(width, height);
  for (let i = 0; i < alpha.length; i++) { d.data[i * 4] = d.data[i * 4 + 1] = d.data[i * 4 + 2] = 255; d.data[i * 4 + 3] = alpha[i]; }
  ctx.putImageData(d, 0, 0); return c;
}
export function bounds(mask) {
  const { width: w, height: h } = mask, a = mask.getContext('2d').getImageData(0, 0, w, h).data;
  let left = w, top = h, right = -1, bottom = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (a[(y * w + x) * 4 + 3] > 12) { left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); }
  if (right < 0) throw new Error('当前没有保留的商品，请先恢复商品区域。');
  return [Math.max(0, left - 2) / w, Math.max(0, top - 2) / h, Math.min(w, right + 3) / w, Math.min(h, bottom + 3) / h];
}
export function dimensions(ratio, side, original) {
  const r = { square: 1, portrait: 3 / 4, landscape: 4 / 3, story: 9 / 16, original: original.width / original.height }[ratio] || 1;
  const length = side === 'original' ? Math.min(6000, Math.max(original.width, original.height)) : Number(side);
  return [Math.round(r >= 1 ? length : length * r), Math.round(r <= 1 ? length : length / r)];
}
export function subjectImage(bitmap, mask, crop, width, height) {
  const [left, top, right, bottom] = crop, out = canvas(width, height), ctx = out.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, left * bitmap.width, top * bitmap.height, (right - left) * bitmap.width, (bottom - top) * bitmap.height, 0, 0, out.width, out.height);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(mask, left * mask.width, top * mask.height, (right - left) * mask.width, (bottom - top) * mask.height, 0, 0, out.width, out.height);
  ctx.globalCompositeOperation = 'source-over'; return out;
}
export function whiteImage(bitmap, mask, settings, previewSide) {
  const [w, h] = dimensions(settings.ratio, previewSide || settings.size, bitmap), out = canvas(w, h), ctx = out.getContext('2d');
  if (settings.background !== 'transparent') { ctx.fillStyle = bgColors[settings.background] || '#fff'; ctx.fillRect(0, 0, w, h); }
  const crop = settings.center ? bounds(mask) : [0, 0, 1, 1];
  const sw = (crop[2] - crop[0]) * bitmap.width, sh = (crop[3] - crop[1]) * bitmap.height;
  const scale = Math.min(w / sw, h / sh) * (settings.center ? settings.occupancy / 100 : 1);
  const subject = subjectImage(bitmap, mask, crop, sw * scale, sh * scale);
  ctx.drawImage(subject, Math.round((w - subject.width) / 2), Math.round((h - subject.height) / 2)); return out;
}

const palettes = { festive: ['#871723', '#b22c30', '#fae3b7'], cream: ['#eee6d7', '#faf6ec', '#494739'], forest: ['#233e35', '#47684d', '#ece2b9'], midnight: ['#171e2a', '#343a49', '#e9d6a3'] };
export function fitText(ctx, value, maxWidth, initial, family = '"Microsoft YaHei", sans-serif', weight = '700') {
  let size = initial;
  do { ctx.font = `${weight} ${size}px ${family}`; if (ctx.measureText(value).width <= maxWidth) break; size -= 1; } while (size > initial * .38);
  return size;
}
function wrapped(ctx, value, maxWidth) {
  const lines = []; let line = '';
  for (const char of value) { if (char === '\n') { lines.push(line); line = ''; continue; } if (line && ctx.measureText(line + char).width > maxWidth) { lines.push(line); line = char; } else line += char; }
  if (line) lines.push(line); return lines;
}
export function posterImage(bitmap, mask, opts, variant = 'cover', previewSide, backgroundImage) {
  const [w, h] = dimensions(opts.ratio, previewSide || opts.size, bitmap), out = canvas(w, h), ctx = out.getContext('2d');
  const palette = opts.palette || palettes[opts.template] || palettes.festive;
  const [dark, light, ink] = palette;
  const grad = ctx.createLinearGradient(0, 0, w, h); grad.addColorStop(0, dark); grad.addColorStop(.65, light); grad.addColorStop(1, dark);
  ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
  if (opts.template === 'festive' && !opts.palette && backgroundImage && variant === 'cover') {
    const scale = Math.max(w / backgroundImage.width, h / backgroundImage.height);
    ctx.drawImage(backgroundImage, (w - backgroundImage.width * scale) / 2, (h - backgroundImage.height * scale) / 2, backgroundImage.width * scale, backgroundImage.height * scale);
  }
  ctx.save(); ctx.strokeStyle = ink; ctx.globalAlpha = .3; ctx.lineWidth = w * .0012;
  ctx.strokeRect(w * .035, h * .025, w * .93, h * .95);
  for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.ellipse(w * (1.2 + i * .1), h * .75, w * .55, h * .7, -.3, 0, Math.PI * 2); ctx.stroke(); }
  ctx.globalAlpha = .12; ctx.fillStyle = ink;
  ctx.beginPath(); ctx.arc(w * .12, h * .92, w * .2, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (opts.badge) {
    const fs = fitText(ctx, opts.badge, w * .7, w * .028, undefined, '500');
    const bw = ctx.measureText(opts.badge).width + fs * 2.3;
    ctx.strokeStyle = ink; ctx.globalAlpha = .8; ctx.strokeRect((w - bw) / 2, h * .048, bw, fs * 1.9); ctx.globalAlpha = 1;
    ctx.fillText(opts.badge, w / 2, h * .048 + fs * .95);
  }
  const title = variant === 'detail' ? '细节展示' : variant === 'info' ? '商品信息' : variant === 'product' ? '商品实拍' : opts.title;
  const titleLines = title.replaceAll('\\n', '\n').split('\n').slice(0, 3);
  const titleSize = Math.min(...titleLines.map(line => fitText(ctx, line, w * .82, w * .085, '"STSong", "SimSun", serif')));
  ctx.font = `700 ${titleSize}px "STSong", "SimSun", serif`;
  titleLines.forEach((line, i) => ctx.fillText(line, w / 2, h * .148 + i * titleSize * 1.3));
  const subtitleY = h * .148 + titleLines.length * titleSize * 1.3 + w * .012;
  const subtitle = variant === 'detail' ? '近一点，看见真实质感' : variant === 'product' ? '保留原始包装与真实外观' : variant === 'info' ? opts.subtitle : opts.subtitle;
  fitText(ctx, subtitle, w * .82, w * .029, undefined, '400'); ctx.globalAlpha = .85; ctx.fillText(subtitle, w / 2, subtitleY); ctx.globalAlpha = 1;
  const crop = bounds(mask), sw = (crop[2] - crop[0]) * bitmap.width, sh = (crop[3] - crop[1]) * bitmap.height;
  if (variant === 'detail') {
    const square = w * .76, y = Math.max(h * .30, subtitleY + w * .065);
    const subject = subjectImage(bitmap, mask, crop, square, square * sh / sw);
    ctx.fillStyle = opts.template === 'cream' ? '#fff' : '#ffffffee'; ctx.fillRect(w * .12, y, square, h * .55);
    const scale = Math.min(square * .92 / subject.width, h * .53 / subject.height);
    ctx.drawImage(subject, w / 2 - subject.width * scale / 2, y + h * .275 - subject.height * scale / 2, subject.width * scale, subject.height * scale);
    fitText(ctx, '细节以原图为准', w * .7, w * .023, undefined, '400'); ctx.fillStyle = ink; ctx.fillText('细节以原图为准', w / 2, h * .89);
  } else if (variant === 'info') {
    const scale = Math.min(w * .5 / sw, h * .32 / sh), subject = subjectImage(bitmap, mask, crop, sw * scale, sh * scale);
    ctx.drawImage(subject, (w - subject.width) / 2, h * .32 + (h * .32 - subject.height) / 2);
    ctx.textAlign = 'left'; ctx.font = `500 ${w * .032}px "Microsoft YaHei", sans-serif`;
    let y = h * .73;
    for (const [index, point] of opts.points.split('\n').filter(Boolean).slice(0, 4).entries()) {
      const lines = wrapped(ctx, point, w * .70).slice(0, 2);
      ctx.globalAlpha = .5; ctx.fillText(`0${index + 1}`, w * .12, y); ctx.globalAlpha = 1;
      lines.forEach((line, i) => ctx.fillText(line, w * .23, y + i * w * .04)); y += Math.max(w * .07, lines.length * w * .044);
    }
  } else {
    const startY = Math.max(h * .33, subtitleY + w * .055), bottomY = h * (opts.price ? .84 : .87);
    const areaHeight = Math.max(h * .2, bottomY - startY), fraction = opts.scale / 100;
    const scale = Math.min(w * fraction / sw, areaHeight / sh);
    const subject = subjectImage(bitmap, mask, crop, sw * scale, sh * scale);
    const x = (w - subject.width) / 2, y = startY + (areaHeight - subject.height) / 2;
    ctx.save(); ctx.fillStyle = '#000'; ctx.globalAlpha = .2; ctx.filter = `blur(${w * .025}px)`; ctx.beginPath(); ctx.ellipse(w / 2, y + subject.height + w * .015, subject.width * .42, w * .035, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    ctx.drawImage(subject, x, y);
    if (opts.price) { ctx.fillStyle = ink; fitText(ctx, opts.price, w * .8, w * .060); ctx.fillText(opts.price, w / 2, h * .91); }
    else if (opts.points.trim()) { ctx.fillStyle = ink; const text = opts.points.split('\n').filter(Boolean).slice(0, 3).join('  ·  '); fitText(ctx, text, w * .78, w * .025, undefined, '400'); ctx.fillText(text, w / 2, h * .915); }
  }
  return out;
}

export async function paletteFrom(blob) {
  const bitmap = await decode(blob), c = canvas(60, 60), ctx = c.getContext('2d'); ctx.drawImage(bitmap, 0, 0, 60, 60); bitmap.close();
  const data = ctx.getImageData(0, 0, 60, 60).data, buckets = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (Math.max(r, g, b) - Math.min(r, g, b) < 25 || Math.max(r, g, b) < 35) continue;
    const key = [r, g, b].map(v => Math.floor(v / 32)).join(','); const val = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    val.n++; val.r += r; val.g += g; val.b += b; buckets.set(key, val);
  }
  const top = [...buckets.values()].sort((a, b) => b.n - a.n)[0];
  if (!top) return palettes.cream;
  const rgb = [top.r, top.g, top.b].map(v => Math.round(v / top.n));
  const hex = values => '#' + values.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  return [hex(rgb.map(v => v * .42)), hex(rgb.map(v => v * .72)), '#fff1d6'];
}
