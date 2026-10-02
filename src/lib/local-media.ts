import 'server-only';
import { readFile, realpath, stat } from 'fs/promises';
import path from 'path';
import { MEDIA_DIR } from '@/lib/storage';

const types: Record<string, string> = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', webp:'image/webp', gif:'image/gif', avif:'image/avif' };

// Read first-party stored images directly. An HTTP request back through a
// hosting proxy is slower and may resolve to an unreachable internal origin.
export async function readLocalMedia(pathname: string, limit: number) {
  if (!pathname.startsWith('/media/')) throw new Error('不允许的图片来源');
  const parts = pathname.slice('/media/'.length).split('/').map(decodeURIComponent);
  if (!parts.length || parts.some(part => !part || part.startsWith('.') || /[\\/\0]/.test(part))) {
    throw new Error('非法图片路径');
  }
  const ext = path.extname(parts[parts.length-1]).slice(1).toLowerCase();
  if (!types[ext]) throw new Error('图片格式不支持');
  const base = await realpath(MEDIA_DIR);
  const file = await realpath(path.join(base, ...parts));
  if (!file.startsWith(base + path.sep)) throw new Error('非法图片路径');
  const info = await stat(file);
  if (!info.isFile() || info.size > limit) throw new Error('图片过大');
  const bytes = await readFile(file);
  if (bytes.length > limit) throw new Error('图片过大');
  return { bytes, type: types[ext], ext: ext === 'jpeg' ? 'jpg' : ext };
}
