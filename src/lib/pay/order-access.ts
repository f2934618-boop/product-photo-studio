import "server-only";
import crypto from "crypto";

const COOKIE_PREFIX = "nv_pay_";
const COOKIE_MAX_AGE_SECONDS = 30 * 60;

const paymentPollSecret =
  process.env.PAYMENT_POLL_SECRET?.trim() ||
  process.env.SETTINGS_SECRET?.trim() ||
  "";

export function paymentOrderAccessConfigured(): boolean {
  return paymentPollSecret.length >= 32;
}

function digestOrderId(orderId: string): string {
  return crypto
    .createHash("sha256")
    .update(orderId, "utf8")
    .digest("base64url")
    .slice(0, 18);
}

function tokenFor(orderId: string): string {
  if (!paymentOrderAccessConfigured()) {
    throw new Error("支付轮询密钥未配置或长度不足");
  }
  return crypto
    .createHmac("sha256", paymentPollSecret)
    .update(`payment-order-v1:${orderId}`, "utf8")
    .digest("base64url");
}

export function paymentOrderCookie(orderId: string): {
  name: string;
  value: string;
  maxAge: number;
} {
  return {
    name: `${COOKIE_PREFIX}${digestOrderId(orderId)}`,
    value: tokenFor(orderId),
    maxAge: COOKIE_MAX_AGE_SECONDS,
  };
}

function cookieValue(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() !== name) continue;
    const value = part.slice(index + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  return null;
}

export function canReadPaymentOrder(request: Request, orderId: string): boolean {
  if (!paymentOrderAccessConfigured()) return false;
  const expected = paymentOrderCookie(orderId);
  const actual = cookieValue(request, expected.name);
  if (!actual) return false;
  const a = Buffer.from(actual, "utf8");
  const b = Buffer.from(expected.value, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
