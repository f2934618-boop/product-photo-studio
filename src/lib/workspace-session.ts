import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "crypto";

export const WORKSPACE_COOKIE = "xm_workspace";
export function newWorkspaceSession() {
  const id = randomUUID();
  const exp = Date.now() + 365 * 86_400_000;
  const value = `${id}.${exp}`;
  const signature = createHmac("sha256", process.env.SETTINGS_SECRET || "local-development-workspace")
    .update(`workspace:${value}`).digest("hex");
  return { token: `${value}.${signature}`, email: `guest-${id}@friends.invalid` };
}
export function workspaceEmail(request: Request): string | null {
  try {
    const part = (request.headers.get("cookie") || "").split(/;\s*/).find((item) => item.startsWith(`${WORKSPACE_COOKIE}=`));
    const [id, exp, mac] = decodeURIComponent(part?.slice(WORKSPACE_COOKIE.length + 1) || "").split(".");
    if (!/^[a-f0-9-]{36}$/.test(id) || !Number.isFinite(Number(exp)) || Number(exp) <= Date.now()) return null;
    const expected = createHmac("sha256", process.env.SETTINGS_SECRET || "local-development-workspace")
      .update(`workspace:${id}.${exp}`).digest();
    const supplied = Buffer.from(mac || "", "hex");
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
    return `guest-${id}@friends.invalid`;
  } catch { return null; }
}
