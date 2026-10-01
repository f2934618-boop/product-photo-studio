import "server-only";

/**
 * Session cookies are Secure for browser-facing HTTPS. An explicit HTTP
 * request remains usable for local/bare-IP self-hosting; production is only
 * the fallback when no protocol information is available.
 */
export function shouldUseSecureCookie(request?: Request): boolean {
  if (request) {
    // Reverse proxies (Railway, nginx, Cloudflare) expose the browser-facing
    // protocol here even when the app container itself receives plain HTTP.
    const forwardedProto = request.headers
      .get("x-forwarded-proto")
      ?.split(",")[0]
      .trim()
      .toLowerCase();
    if (forwardedProto === "https") return true;
    if (forwardedProto === "http") return false;

    try {
      const protocol = new URL(request.url).protocol;
      if (protocol === "https:") return true;
      if (protocol === "http:") return false;
    } catch {
      // Fall through only when the request carries no usable protocol.
    }
  }

  return process.env.NODE_ENV === "production";
}
