export const bgColors = { white: '#ffffff', warm: '#f7f5f0', gray: '#ebedef' };
export const defaultSettings = () => ({ background: 'white', ratio: 'square', size: '1600', occupancy: 85, center: true, format: 'jpg', rotation: 0, offsetX: 0, offsetY: 0, shadow: 0, brightness: 100 });
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
  settings = { ...defaultSettings(), ...settings };
  const [w, h] = dimensions(settings.ratio, previewSide || settings.size, bitmap), out = canvas(w, h), ctx = out.getContext('2d');
  if (settings.background !== 'transparent') { ctx.fillStyle = bgColors[settings.background] || '#fff'; ctx.fillRect(0, 0, w, h); }
  const crop = settings.center ? bounds(mask) : [0, 0, 1, 1];
  const sw = (crop[2] - crop[0]) * bitmap.width, sh = (crop[3] - crop[1]) * bitmap.height;
  const angle = settings.rotation * Math.PI / 180;
  const rw = Math.abs(sw * Math.cos(angle)) + Math.abs(sh * Math.sin(angle));
  const rh = Math.abs(sh * Math.cos(angle)) + Math.abs(sw * Math.sin(angle));
  const scale = Math.min(w / rw, h / rh) * (settings.center ? settings.occupancy / 100 : 1);
  const subject = subjectImage(bitmap, mask, crop, sw * scale, sh * scale);
  const x = w * (.5 + settings.offsetX / 100), y = h * (.5 + settings.offsetY / 100);
  if (settings.shadow > 0) {
    ctx.save(); ctx.fillStyle = '#182327'; ctx.globalAlpha = settings.shadow / 160;
    ctx.filter = `blur(${w * .023}px)`; ctx.beginPath();
    ctx.ellipse(x, y + rh * scale * .48, rw * scale * .39, h * .024, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
  if (settings.brightness !== 100) ctx.filter = `brightness(${settings.brightness}%)`;
  ctx.drawImage(subject, -subject.width / 2, -subject.height / 2); ctx.restore(); return out;
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
// The detail window stays within the subject, while the original pixels supply every crop.
export function detailCrop(crop, bitmap, aspect, zoom = 1.8, x = 50, y = 50) {
  const sw = (crop[2] - crop[0]) * bitmap.width, sh = (crop[3] - crop[1]) * bitmap.height;
  const scale = Math.max(1, Number(zoom) || 1.8);
  let cw = sw / scale, ch = cw / aspect;
  if (ch > sh / scale) { ch = sh / scale; cw = ch * aspect; }
  const left = crop[0] * bitmap.width + (sw - cw) * Math.max(0, Math.min(1, x / 100));
  const top = crop[1] * bitmap.height + (sh - ch) * Math.max(0, Math.min(1, y / 100));
  return [left / bitmap.width, top / bitmap.height, (left + cw) / bitmap.width, (top + ch) / bitmap.height];
}

export function posterImage(bitmap, mask, opts, variant = 'cover', previewSide, backgroundImage) {
  const [w, h] = dimensions(opts.ratio, previewSide || opts.size, bitmap), out = canvas(w, h), ctx = out.getContext('2d');
  const theme = opts.template || 'festive', [dark, light, accent] = opts.palette || palettes[theme] || palettes.festive;
  const crop = bounds(mask), sw = (crop[2] - crop[0]) * bitmap.width, sh = (crop[3] - crop[1]) * bitmap.height;
  const margin = w * .075, clean = variant !== 'cover';
  let paper = theme === 'cream' ? '#f5f1e9' : theme === 'forest' ? '#edf1e9' : dark;
  let ink = theme === 'cream' ? '#393c31' : theme === 'forest' ? '#204338' : accent;
  if (opts.palette) { paper = dark; ink = accent; }
  if (clean) { paper = '#f7f6f2'; ink = '#263b32'; }
  ctx.fillStyle = paper; ctx.fillRect(0, 0, w, h);
  ctx.textBaseline = 'middle';
  function text(value, x, y, width, size, align = 'left', weight = '600', color = ink) {
    ctx.fillStyle = color; ctx.textAlign = align;
    const fs = fitText(ctx, String(value || ''), width, size, undefined, weight);
    ctx.fillText(String(value || ''), x, y); return fs;
  }
  function line(x, y, width, color = ink, alpha = .25) { ctx.save(); ctx.strokeStyle = color; ctx.globalAlpha = alpha; ctx.lineWidth = Math.max(1, w * .001); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + width, y); ctx.stroke(); ctx.restore(); }
  function drawProduct(x, y, width, height, withShadow = true) {
    const fraction = (Number(opts.scale) || 80) / 85;
    const scale = Math.min(width / sw, height / sh) * fraction;
    const product = subjectImage(bitmap, mask, crop, sw * scale, sh * scale);
    const px = x + (width - product.width) / 2 + w * (Number(opts.x) || 0) / 100;
    const py = y + (height - product.height) / 2 + h * (Number(opts.y) || 0) / 100;
    if (withShadow) {
      ctx.save(); ctx.fillStyle = '#172920'; ctx.globalAlpha = .16; ctx.filter = `blur(${w * .02}px)`;
      ctx.beginPath(); ctx.ellipse(px + product.width / 2, py + product.height + w * .008, product.width * .39, w * .025, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    ctx.drawImage(product, px, py);
  }
  function titleBlock(title, startY, align = 'left', maxWidth = w * .85, maxSize = w * .077) {
    const lines = String(title || '').replaceAll('\\n', '\n').split('\n').filter(Boolean).slice(0, 3);
    if (!lines.length) return startY;
    const fs = Math.min(...lines.map(v => fitText(ctx, v, maxWidth, maxSize)));
    const x = align === 'center' ? w / 2 : margin;
    lines.forEach((v, i) => text(v, x, startY + i * fs * 1.28, maxWidth, fs, align));
    return startY + (lines.length - 1) * fs * 1.28 + fs * .65;
  }
  const pageNames = { product: '商品实拍', detail: '细节展示', info: '商品信息' };
  if (clean) {
    ctx.fillStyle = theme === 'cream' ? '#827562' : dark; ctx.fillRect(0, 0, w, h * .013);
    text(pageNames[variant], margin, h * .097, w * .75, w * .066);
    if (opts.title) text(opts.title.replaceAll('\n', ' · '), margin, h * .158, w * .8, w * .024, 'left', '400', '#6b756c');
    line(margin, h * .197, w - 2 * margin);
    if (variant === 'product') {
      ctx.fillStyle = '#fff'; ctx.fillRect(margin, h * .245, w - 2 * margin, h * .61);
      drawProduct(w * .13, h * .27, w * .74, h * .54, true);
      text('原图外观 · 真实呈现', margin, h * .92, w * .7, w * .022, 'left', '400', '#6b756c');
    } else if (variant === 'detail') {
      const fw = w - margin * 2, fh = h * .62, y = h * .24;
      const detail = detailCrop(crop, bitmap, fw / fh, opts.detailZoom, opts.detailX, opts.detailY);
      ctx.fillStyle = '#fff'; ctx.fillRect(margin, y, fw, fh);
      ctx.drawImage(subjectImage(bitmap, mask, detail, fw, fh), margin, y);
      text('原图局部放大', margin, h * .92, w * .6, w * .022, 'left', '400', '#6b756c');
      text(`${Number(opts.detailZoom || 1.8).toFixed(1)}×`, w - margin, h * .92, w * .2, w * .024, 'right', '500', '#6b756c');
    } else {
      drawProduct(w * .17, h * .225, w * .66, h * .32, true);
      const points = String(opts.points || '').split('\n').map(v => v.trim()).filter(Boolean).slice(0, 4);
      const start = h * .63, rowHeight = Math.min(h * .083, h * .30 / Math.max(1, points.length));
      points.forEach((point, i) => {
        const y = start + i * rowHeight;
        text(String(i + 1).padStart(2, '0'), margin, y, w * .065, w * .027, 'left', '500', '#7c897d');
        const initial = Math.min(w * .03, rowHeight * .28);
        ctx.font = `500 ${initial}px "Microsoft YaHei", sans-serif`;
        let lines = wrapped(ctx, point, w * .73), size = initial;
        while (lines.length > 2 && size > w * .015) { size -= 1; ctx.font = `500 ${size}px "Microsoft YaHei", sans-serif`; lines = wrapped(ctx, point, w * .73); }
        lines.forEach((value, n) => text(value, w * .19, y + n * size * 1.35, w * .73, size, 'left', '500'));
        if (i < points.length - 1) line(margin, y + rowHeight * .68, w - margin * 2, '#526552', .13);
      });
    }
    return out;
  }
  if (theme === 'festive') {
    if (backgroundImage && !opts.palette) {
      const scale = Math.max(w / backgroundImage.width, h / backgroundImage.height);
      ctx.drawImage(backgroundImage, (w - backgroundImage.width * scale) / 2, (h - backgroundImage.height * scale) / 2, backgroundImage.width * scale, backgroundImage.height * scale);
      const wash = ctx.createLinearGradient(0, 0, 0, h * .48); wash.addColorStop(0, '#65141dbc'); wash.addColorStop(1, '#65141d00'); ctx.fillStyle = wash; ctx.fillRect(0, 0, w, h * .48);
    } else {
      const gradient = ctx.createLinearGradient(0, 0, w, h); gradient.addColorStop(0, dark); gradient.addColorStop(1, light); ctx.fillStyle = gradient; ctx.fillRect(0, 0, w, h);
    }
    text(opts.badge, w / 2, h * .066, w * .8, w * .025, 'center', '500');
    const end = titleBlock(opts.title, h * .15, 'center');
    text(opts.subtitle, w / 2, end + w * .034, w * .83, w * .029, 'center', '400');
    const start = Math.max(h * .34, end + w * .10);
    drawProduct(w * .10, start, w * .8, Math.max(h * .22, h * .845 - start));
  } else if (theme === 'cream') {
    ctx.fillStyle = opts.palette ? light : '#e7dfd1'; ctx.fillRect(w * .58, 0, w * .42, h);
    text(opts.badge, margin, h * .06, w * .72, w * .023, 'left', '500');
    line(margin, h * .088, w * .85, ink, .3);
    const end = titleBlock(opts.title, h * .153, 'left', w * .82, w * .072);
    text(opts.subtitle, margin, end + w * .03, w * .82, w * .026, 'left', '400');
    const start = Math.max(h * .34, end + w * .095);
    drawProduct(w * .11, start, w * .80, Math.max(h * .23, h * .84 - start));
  } else if (theme === 'forest') {
    ctx.fillStyle = dark; ctx.fillRect(0, 0, w, h * .30); ink = accent;
    text(opts.badge, margin, h * .054, w * .7, w * .022, 'left', '500');
    const end = titleBlock(opts.title, h * .126, 'left', w * .84, w * .065);
    text(opts.subtitle, margin, Math.min(h * .266, end + w * .025), w * .82, w * .024, 'left', '400');
    ctx.fillStyle = opts.palette ? light : '#dbe3d5'; ctx.fillRect(w * .05, h * .69, w * .90, h * .19);
    ctx.fillStyle = opts.palette ? dark : '#cbd7c4'; ctx.fillRect(w * .12, h * .86, w * .76, h * .06);
    drawProduct(w * .12, h * .33, w * .76, h * .51);
    ink = opts.palette ? accent : '#204338';
  } else {
    const glow = ctx.createRadialGradient(w * .50, h * .57, 0, w * .5, h * .59, w * .70); glow.addColorStop(0, light); glow.addColorStop(1, dark); ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
    text(opts.badge, w / 2, h * .06, w * .8, w * .022, 'center', '500');
    const end = titleBlock(opts.title, h * .143, 'center', w * .82, w * .069);
    text(opts.subtitle, w / 2, end + w * .024, w * .81, w * .025, 'center', '400');
    line(w * .40, end + w * .079, w * .20, accent, .65);
    const start = Math.max(h * .35, end + w * .13);
    ctx.fillStyle = '#ffffff09'; ctx.fillRect(w * .06, h * .82, w * .88, h * .10);
    drawProduct(w * .10, start, w * .80, Math.max(h * .23, h * .85 - start), false);
  }
  const footer = opts.price || String(opts.points || '').split('\n').filter(Boolean).slice(0, 3).join(' · ');
  if (footer) text(footer, theme === 'cream' ? margin : w / 2, h * .947, w * .84, opts.price ? w * .045 : w * .023, theme === 'cream' ? 'left' : 'center', opts.price ? '600' : '400');
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
