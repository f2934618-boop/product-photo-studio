import "server-only";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "crypto";
import { resolveUserIdentity } from "@/lib/admin-auth";

export type JobAccess = {
  ownerEmail: string | null;
  pollCookieHash: string | null;
};

type CreatedJobAccess = {
  access: JobAccess;
  pollCookieSecret: string | null;
};

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

function cookieValue(request: Request, name: string): string | null {
  const raw = request.headers.get("cookie") || "";
  for (const part of raw.split(/; */)) {
    const index = part.indexOf("=");
    if (index < 0 || part.slice(0, index).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(index + 1));
    } catch {
      return null;
    }
  }
  return null;
}

export function createJobId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

export function jobPollCookieName(scope: string, jobId: string): string {
  return `nv_${scope}_${sha256(jobId).slice(0, 24)}`;
}

/**
 * API Key 任务不签发 cookie，轮询必须再次提交仍然有效、且属于同一账号的 Key。
 * 浏览器会话及无数据库的本地开发模式使用短期 HttpOnly cookie，现有同源客户端
 * 无需把 Supabase token 暴露到查询参数，也不会退回到“只凭 jobId”授权。
 */
export function createJobAccess(
  ownerEmail: string | null,
  allowPollCookie: boolean
): CreatedJobAccess {
  const pollCookieSecret = allowPollCookie
    ? randomBytes(32).toString("base64url")
    : null;
  return {
    access: {
      ownerEmail: ownerEmail?.trim().toLowerCase() || null,
      pollCookieHash: pollCookieSecret ? sha256(pollCookieSecret) : null,
    },
    pollCookieSecret,
  };
}

export async function canReadJob(
  request: Request,
  scope: string,
  jobId: string,
  access: JobAccess
): Promise<boolean> {
  try {
    if (access.pollCookieHash) {
      const secret = cookieValue(request, jobPollCookieName(scope, jobId));
      if (secret && safeEqual(sha256(secret), access.pollCookieHash)) return true;
    }

    if (!access.ownerEmail) return false;
    const identity = await resolveUserIdentity(request);
    return identity?.email.toLowerCase() === access.ownerEmail;
  } catch {
    return false;
  }
}
