import { NextResponse, type NextRequest } from "next/server";
import { FRIENDS_MODE } from "@/lib/friends-mode";

// 轻量中间件:把当前请求路径写进 x-pathname 请求头,供根 layout(RSC)读取以做
// 「未配置 → 引导到 /setup」的门控。这里不碰 DB/加密,只贴一个 header,开销极小。
export function middleware(req: NextRequest) {
  if (FRIENDS_MODE) {
    const pathname = req.nextUrl.pathname;
    const destinations: Record<string, string> = {
      "/sign-in": "/batch-matting", "/sign-up": "/batch-matting", "/account": "/batch-matting",
      "/pricing": "/batch-matting", "/plans": "/batch-matting", "/credits": "/batch-matting",
      "/invite": "/batch-matting", "/developer-api": "/batch-matting", "/api-access": "/batch-matting",
      "/history": "/canvas-studio", "/checkout": "/batch-matting", "/security": "/batch-matting",
      "/cutout": "/batch-matting", "/batch-cutout": "/batch-matting",
      "/studio-genesis": "/batch-matting", "/studio-genesis/batch": "/batch-matting",
      "/aesthetic-mirror": "/batch-matting", "/sku-replace": "/batch-matting",
      "/clothing-studio": "/batch-matting", "/buyer-show": "/batch-matting",
      "/batch-translation": "/batch-matting", "/video-studio": "/batch-matting",
      "/style": "/batch-matting", "/style-copy": "/batch-matting", "/fuse": "/batch-matting",
      "/tryon": "/batch-matting", "/garment": "/batch-matting", "/garment3d": "/batch-matting",
      "/avatar": "/batch-matting", "/variations": "/batch-matting",
      "/upscale": "/refinement-studio", "/dewrinkle": "/refinement-studio", "/dewatermark": "/refinement-studio", "/inpaint": "/refinement-studio",
      "/generate": "/batch-matting", "/suite": "/batch-matting",
    };
    if (destinations[pathname]) return NextResponse.redirect(new URL(destinations[pathname], req.url));
  }
  const headers = new Headers(req.headers);
  headers.set("x-pathname", req.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

// 只对页面请求生效;排除 API、Next 静态资源、图片、favicon 等,避免无谓开销。
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
