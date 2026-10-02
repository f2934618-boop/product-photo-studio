import JSZip from "jszip";
import { clientIp } from "@/lib/ip";
import { rateLimit } from "@/lib/rate-limit";
import { readLocalMedia } from "@/lib/local-media";

export const runtime = "nodejs";
export const maxDuration = 120;

// 服务端打包套图为 ZIP:前端传图片 URL 列表,服务器逐张拉取(server→R2,无跨域)
// 后压成 zip 流回客户端。避免浏览器 fetch 跨域 R2 的 CORS 问题。
type Item = { url: string; name: string };

const MAX_ITEMS = 30;
const MAX_ITEM_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const MAX_JSON_BYTES = Math.ceil((MAX_TOTAL_BYTES * 4) / 3) + 1024 * 1024;

function jsonError(error: string, status: number) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "private, no-store, max-age=0",
    },
  });
}

function safeName(s: string, i: number): string {
  const cleaned = (s || `image-${i + 1}`).replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);
  return cleaned || `image-${i + 1}`;
}

function configuredStorageOrigin(): string | null {
  const raw = (process.env.R2_PUBLIC_BASE_URL ?? "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

async function readBounded(response: Response, limit: number): Promise<Buffer | null> {
  const declared = Number(response.headers.get("content-length") || "0");
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!response.body) return null;

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

export async function POST(request: Request) {
  const ip = clientIp(request) || "unknown";
  if (!rateLimit(`suite-download:${ip}`, 40, 10 * 60_000)) {
    return jsonError("下载过于频繁，请稍后再试", 429);
  }

  const declaredBodyLength = Number(request.headers.get("content-length") || "0");
  if (
    Number.isFinite(declaredBodyLength) &&
    declaredBodyLength > MAX_JSON_BYTES
  ) {
    return jsonError("打包内容过大", 413);
  }

  let items: Item[] = [];
  try {
    const body = (await request.json()) as { items?: Item[] };
    items = Array.isArray(body.items)
      ? body.items
          .filter(
            (item): item is Item =>
              !!item &&
              typeof item.url === "string" &&
              item.url.length > 0 &&
              typeof item.name === "string"
          )
          .slice(0, MAX_ITEMS)
      : [];
  } catch {
    return jsonError("请求格式不正确", 400);
  }
  if (items.length === 0) {
    return jsonError("没有可下载的图片", 400);
  }

  const zip = new JSZip();
  let ok = 0;
  let totalBytes = 0;
  const requestOrigin = new URL(request.url).origin;
  const r2Origin = configuredStorageOrigin();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    try {
      const remaining = MAX_TOTAL_BYTES - totalBytes;
      if (remaining <= 0) break;
      const itemLimit = Math.min(MAX_ITEM_BYTES, remaining);
      let buf: Buffer | null = null;
      let ext = "png";

      // OpenAI may return a data URL when object storage is not configured.
      // Reject oversized base64 before decoding it into another in-memory copy.
      const dataMatch = it.url.match(
        /^data:image\/(png|jpeg|webp);base64,([a-z0-9+/=]+)$/i
      );
      if (dataMatch) {
        if (dataMatch[2].length > Math.ceil((itemLimit * 4) / 3) + 4) continue;
        buf = Buffer.from(dataMatch[2], "base64");
        ext =
          dataMatch[1].toLowerCase() === "jpeg"
            ? "jpg"
            : dataMatch[1].toLowerCase();
      } else {
        const u = new URL(it.url, request.url);
        // Local disk media is served from /media/. For object storage, allow
        // the exact configured public origin plus legacy first-party hosts.
        const allowed =
          (u.origin === requestOrigin && u.pathname.startsWith("/media/")) ||
          (!!r2Origin && u.origin === r2Origin) ||
          u.hostname.endsWith(".r2.dev") ||
          u.hostname === "starzeco.com" ||
          u.hostname.endsWith(".starzeco.com") ||
          u.hostname === "novaryns.com" ||
          u.hostname.endsWith(".novaryns.com");
        if (!allowed) continue;
        if (u.origin === requestOrigin && u.pathname.startsWith("/media/")) {
          const local = await readLocalMedia(u.pathname, itemLimit);
          buf = local.bytes;
          ext = local.ext;
        } else {
          const res = await fetch(u, { cache: "no-store", signal: AbortSignal.timeout(30000) });
          if (!res.ok) continue;
          const contentType = (res.headers.get("content-type") || "").toLowerCase();
          if (!contentType.startsWith("image/")) continue;
          buf = await readBounded(res, itemLimit);
          const pathExt = u.pathname.match(/\.(png|jpe?g|webp)$/i)?.[1];
          ext = pathExt
            ? pathExt.toLowerCase().replace("jpeg", "jpg")
            : contentType.includes("jpeg")
              ? "jpg"
              : contentType.includes("webp")
                ? "webp"
                : "png";
        }
      }

      if (!buf || buf.length === 0 || buf.length > itemLimit) continue;
      totalBytes += buf.length;
      zip.file(
        `${String(i + 1).padStart(2, "0")}-${safeName(it.name, i)}.${ext}`,
        buf
      );
      ok++;
    } catch {
      /* 单张失败跳过 */
    }
  }

  if (ok === 0) {
    return jsonError("图片拉取失败", 502);
  }

  const blob = await zip.generateAsync({ type: "nodebuffer" });
  return new Response(blob, {
    status: 200,
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="suite-${Date.now()}.zip"`,
      "content-length": String(blob.length),
      "cache-control": "private, no-store, max-age=0",
      "x-content-type-options": "nosniff",
    },
  });
}
