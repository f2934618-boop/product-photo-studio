import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  Braces,
  CheckCircle2,
  FileImage,
  ImagePlus,
  KeyRound,
  ScanLine,
  Shirt,
  Sparkles,
  Type,
  WandSparkles,
  Zap,
} from "lucide-react";
import { ApiKeyManager } from "@/components/developer-api/api-key-manager";
import { BRAND } from "@/lib/brand";

export const metadata = {
  title: `开发者 API — ${BRAND}`,
  description: "将商品图生成、抠图、精修、试穿与标题生成能力接入你的业务。",
};

type Endpoint = {
  id: string;
  title: string;
  path: string;
  description: string;
  input: string;
  output: string;
  icon: LucideIcon;
  async?: boolean;
};

const ENDPOINTS: Endpoint[] = [
  {
    id: "image-generation",
    title: "商品图生成",
    path: "/api/generate-image",
    description: "根据提示词与商品素材生成主图、场景图或营销视觉。",
    input: "无图片可用 JSON；上传图片须用 multipart：prompt、image（可重复）、ratio、resolution、count",
    output: "POST 返回 {jobId}；GET ?job=<id> 返回 pending / done / error，轮询须携带同一账号的 Key",
    icon: ImagePlus,
    async: true,
  },
  {
    id: "background-removal",
    title: "抠图换底",
    path: "/api/cutout",
    description: "保留商品细节，输出透明底或纯白底商品图。",
    input: "multipart：image（必填）、background=transparent|white、resolution",
    output: "{ok, id, url, creditsUsed, user}",
    icon: ScanLine,
  },
  {
    id: "image-editing",
    title: "局部改图",
    path: "/api/inpaint",
    description: "上传原图和蒙版，仅重绘选定区域。",
    input: "multipart：image、mask、prompt（均必填）、resolution=1K|2K、ratio",
    output: "{ok, id, url, creditsUsed, user}",
    icon: WandSparkles,
  },
  {
    id: "upscale",
    title: "高清放大",
    path: "/api/upscale",
    description: "2× 或 4× 超分辨率增强，可选人脸细节修复。",
    input: "multipart：image（必填）、scale=2|4、faceEnhance=0|1",
    output: "{ok, id, url, creditsUsed, user}",
    icon: Zap,
  },
  {
    id: "virtual-tryon",
    title: "虚拟试穿",
    path: "/api/tryon",
    description: "将上装、下装组合到指定模特与场景。",
    input: "multipart：top 或 bottom 至少一个；可选 modelId|modelUrl、sceneId、prompt",
    output: "POST 返回 {jobId}；GET ?job=<id> 返回 pending / done / error，轮询须携带同一账号的 Key",
    icon: Shirt,
    async: true,
  },
  {
    id: "title-generation",
    title: "标题生成",
    path: "/api/title-gen",
    description: "根据产品图或卖点生成电商标题与短卖点。",
    input: "无图片可用 JSON；上传图片须用 multipart：idea、image、platform、style、lang、count",
    output: "{titles, sellingPoints}",
    icon: Type,
  },
];

const DIRECTORY = [
  { href: "#overview", label: "概览" },
  { href: "#quick-start", label: "快速开始" },
  { href: "#authentication", label: "认证方式" },
  { href: "#api-keys", label: "API Key 管理" },
  { href: "#interfaces", label: "接口列表" },
  ...ENDPOINTS.map((item) => ({ href: `#${item.id}`, label: item.title })),
  { href: "#errors", label: "错误码" },
];

const CURL_EXAMPLE = `curl -X POST "https://your-domain.com/api/generate-image" \\
  -H "X-API-Key: nv_live_xxxxxxxxx" \\
  -F "prompt=白色背景的电商主图" \\
  -F "image=@./product.jpg" \\
  -F "ratio=1:1" \\
  -F "resolution=1K" \\
  -F "count=1"`;

const RESPONSE_EXAMPLE = `{
  "jobId": "job-550e8400-e29b-41d4-a716-446655440000"
}`;

const POLL_EXAMPLE = `curl "https://your-domain.com/api/generate-image?job=job-550e8400-e29b-41d4-a716-446655440000" \\
  -H "X-API-Key: nv_live_xxxxxxxxx"`;

const PENDING_EXAMPLE = `{
  "status": "pending"
}`;

function MethodPath({ path }: { path: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2 font-mono text-[11.5px]">
      <span className="rounded-[5px] bg-acc-tint px-2 py-1 font-semibold text-acc">POST</span>
      <code className="truncate text-c-text2">{path}</code>
    </div>
  );
}

export default function DeveloperApiPage() {
  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 pb-20 pt-5 sm:px-6 lg:px-8">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[190px_minmax(0,1fr)] xl:grid-cols-[210px_minmax(0,1fr)]">
        <aside className="min-w-0 lg:sticky lg:top-5 lg:h-[calc(100dvh-40px)] lg:self-start" aria-label="API 文档目录">
          <div className="border-b border-c-border pb-4 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-5">
            <div className="mb-3 flex items-center gap-2 text-[12px] font-semibold text-c-text">
              <Braces className="h-4 w-4 text-acc" aria-hidden="true" />
              开发者文档
            </div>
            <nav className="flex max-w-full gap-1 overflow-x-auto pb-2 lg:block lg:space-y-0.5 lg:overflow-visible lg:pb-0">
              {DIRECTORY.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  className="block shrink-0 rounded-[7px] px-2.5 py-1.5 text-[12px] text-c-text3 transition-colors hover:bg-c-subtle2 hover:text-c-text lg:w-full"
                >
                  {item.label}
                </a>
              ))}
            </nav>
          </div>
        </aside>

        <main className="min-w-0">
          <section
            id="overview"
            className="relative overflow-hidden rounded-[18px] border border-c-border bg-c-card px-6 py-8 sm:px-9 sm:py-10 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(340px,.82fr)] lg:items-center lg:gap-10"
          >
            <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[44%] bg-[radial-gradient(circle_at_70%_35%,var(--acc-tint),transparent_65%)] lg:block" />
            <div className="relative">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-acc-border bg-acc-tint px-3 py-1.5 text-[11.5px] font-semibold text-acc">
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                Developer API
              </div>
              <h1 className="max-w-[650px] text-[34px] font-semibold leading-[1.08] tracking-[-0.035em] text-c-text sm:text-[44px] lg:text-[50px]">
                把商品图能力接入你的业务
              </h1>
              <p className="mt-4 max-w-[54ch] text-[14px] leading-6 text-c-text3 sm:text-[15px]">
                一套 API 覆盖生成、抠图、精修、试穿与电商文案，按账号统一计费和归档。
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <a
                  href="#quick-start"
                  className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-c-text px-4 text-[13px] font-semibold text-c-card transition-transform active:translate-y-px"
                >
                  快速开始
                  <ArrowRight className="h-4 w-4" />
                </a>
                <a
                  href="#api-keys"
                  className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-c-border2 bg-c-card px-4 text-[13px] font-medium text-c-text transition-colors hover:bg-c-subtle2"
                >
                  <KeyRound className="h-4 w-4" />
                  管理 API Key
                </a>
              </div>
            </div>

            <div className="relative mt-8 overflow-hidden rounded-[14px] border border-c-border bg-[#15171c] shadow-[0_18px_45px_rgba(38,42,54,.18)] lg:mt-0">
              <div className="flex h-10 items-center gap-1.5 border-b border-white/10 px-4">
                <span className="h-2.5 w-2.5 rounded-full bg-white/25" />
                <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
                <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
                <span className="ml-2 font-mono text-[10.5px] text-white/45">quick-start.sh</span>
              </div>
              <pre className="overflow-x-auto p-4 font-mono text-[11.5px] leading-[1.75] text-[#d8dee9] sm:p-5">
                <code>{CURL_EXAMPLE}</code>
              </pre>
            </div>
          </section>

          <section id="quick-start" className="scroll-mt-8 border-b border-c-border py-12">
            <h2 className="text-[24px] font-semibold tracking-[-0.02em] text-c-text">快速开始</h2>
            <p className="mt-2 max-w-[65ch] text-[13.5px] leading-6 text-c-text3">
              只要请求中包含文件，就使用 multipart/form-data；商品图生成和标题生成在不上传图片时支持 application/json。
            </p>
            <div className="mt-7 grid gap-7 xl:grid-cols-[.78fr_1.22fr]">
              <ol className="space-y-5">
                {[
                  ["01", "创建 Key", "登录后在下方创建。完整密钥仅显示一次。"],
                  ["02", "发起请求", "将 Key 放入 X-API-Key 请求头，并上传素材。"],
                  ["03", "获取结果", "同步接口直接返回；异步接口轮询时每次都要携带同一账号的 Key。"],
                ].map(([number, title, text]) => (
                  <li key={number} className="grid grid-cols-[34px_minmax(0,1fr)] gap-3">
                    <span className="font-mono text-[11px] font-semibold text-acc">{number}</span>
                    <div>
                      <p className="text-[13.5px] font-semibold text-c-text">{title}</p>
                      <p className="mt-1 text-[12.5px] leading-5 text-c-text3">{text}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <div className="overflow-hidden rounded-[14px] border border-c-border bg-c-subtle2">
                <div className="flex items-center justify-between border-b border-c-border px-4 py-2.5">
                  <span className="text-[11.5px] font-medium text-c-text2">创建任务响应</span>
                  <span className="font-mono text-[10.5px] text-c-success-strong">200 OK</span>
                </div>
                <pre className="overflow-x-auto p-4 font-mono text-[11.5px] leading-6 text-c-text2">
                  <code>{RESPONSE_EXAMPLE}</code>
                </pre>
              </div>
            </div>
            <div className="mt-6 grid gap-3 xl:grid-cols-[1.35fr_.65fr]">
              <div className="overflow-hidden rounded-[14px] border border-c-border bg-[#15171c]">
                <div className="border-b border-white/10 px-4 py-2.5 text-[11.5px] font-medium text-white/65">
                  使用同一 Key 轮询
                </div>
                <pre className="overflow-x-auto p-4 font-mono text-[11.5px] leading-6 text-[#d8dee9]">
                  <code>{POLL_EXAMPLE}</code>
                </pre>
              </div>
              <div className="overflow-hidden rounded-[14px] border border-c-border bg-c-subtle2">
                <div className="border-b border-c-border px-4 py-2.5 text-[11.5px] font-medium text-c-text2">
                  未完成时
                </div>
                <pre className="overflow-x-auto p-4 font-mono text-[11.5px] leading-6 text-c-text2">
                  <code>{PENDING_EXAMPLE}</code>
                </pre>
              </div>
            </div>
          </section>

          <section id="authentication" className="scroll-mt-8 border-b border-c-border py-12">
            <h2 className="text-[24px] font-semibold tracking-[-0.02em] text-c-text">认证方式</h2>
            <p className="mt-2 max-w-[70ch] text-[13.5px] leading-6 text-c-text3">
              推荐使用 X-API-Key。也可以将同一 Key 放入 Bearer 请求头。服务端从 Key 记录解析账号，忽略请求体中的 email。异步任务的创建与每次轮询都必须携带 Key；任务结果只对同一账号开放。
            </p>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              <div className="rounded-[12px] border border-c-border bg-c-subtle2 p-4">
                <p className="text-[12px] font-semibold text-c-text">X-API-Key</p>
                <code className="mt-2 block overflow-x-auto font-mono text-[11.5px] text-c-text2">X-API-Key: nv_live_xxxxxxxxx</code>
              </div>
              <div className="rounded-[12px] border border-c-border bg-c-subtle2 p-4">
                <p className="text-[12px] font-semibold text-c-text">Bearer</p>
                <code className="mt-2 block overflow-x-auto font-mono text-[11.5px] text-c-text2">Authorization: Bearer nv_live_xxxxxxxxx</code>
              </div>
            </div>
          </section>

          <section id="api-keys" className="scroll-mt-8 border-b border-c-border py-12">
            <div className="mb-6">
              <h2 className="text-[24px] font-semibold tracking-[-0.02em] text-c-text">API Key 管理</h2>
              <p className="mt-2 max-w-[68ch] text-[13.5px] leading-6 text-c-text3">
                每个账号最多保留 10 个 Key。数据库只保存哈希；停用立即生效，删除不可恢复。
              </p>
            </div>
            <ApiKeyManager />
          </section>

          <section id="interfaces" className="scroll-mt-8 py-12">
            <h2 className="text-[24px] font-semibold tracking-[-0.02em] text-c-text">接口列表</h2>
            <p className="mt-2 text-[13.5px] leading-6 text-c-text3">六类核心能力共用同一认证和账号积分。</p>
            <div className="mt-7 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {ENDPOINTS.map((endpoint, index) => {
                const Icon = endpoint.icon;
                return (
                  <a
                    key={endpoint.id}
                    href={`#${endpoint.id}`}
                    className={`group relative min-h-[190px] overflow-hidden rounded-[14px] border border-c-border p-5 transition-colors hover:border-acc-border ${
                      index === 0 || index === 4 ? "bg-acc-tint" : "bg-c-card"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-c-card text-acc shadow-sm">
                        <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                      </span>
                      {endpoint.async && (
                        <span className="rounded-full border border-c-border bg-c-card px-2 py-1 text-[10px] font-medium text-c-text3">异步</span>
                      )}
                    </div>
                    <h3 className="mt-5 text-[15px] font-semibold text-c-text">{endpoint.title}</h3>
                    <p className="mt-1.5 text-[12.5px] leading-5 text-c-text3">{endpoint.description}</p>
                    <div className="mt-4">
                      <MethodPath path={endpoint.path} />
                    </div>
                  </a>
                );
              })}
            </div>
          </section>

          <section className="border-t border-c-border" aria-label="接口参考">
            {ENDPOINTS.map((endpoint) => {
              const Icon = endpoint.icon;
              return (
                <article key={endpoint.id} id={endpoint.id} className="scroll-mt-8 border-b border-c-border py-9">
                  <div className="grid gap-5 md:grid-cols-[minmax(0,.8fr)_minmax(320px,1.2fr)] md:items-start">
                    <div>
                      <div className="flex items-center gap-3">
                        <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-c-subtle2 text-acc">
                          <Icon className="h-[18px] w-[18px]" />
                        </span>
                        <h3 className="text-[18px] font-semibold text-c-text">{endpoint.title}</h3>
                      </div>
                      <p className="mt-3 max-w-[48ch] text-[12.5px] leading-5 text-c-text3">{endpoint.description}</p>
                    </div>
                    <div className="overflow-hidden rounded-[12px] border border-c-border bg-c-subtle2">
                      <div className="border-b border-c-border px-4 py-3">
                        <MethodPath path={endpoint.path} />
                      </div>
                      <dl className="divide-y divide-c-border text-[12px]">
                        <div className="grid grid-cols-[74px_minmax(0,1fr)] gap-3 px-4 py-3">
                          <dt className="font-medium text-c-text3">请求</dt>
                          <dd className="leading-5 text-c-text2">{endpoint.input}</dd>
                        </div>
                        <div className="grid grid-cols-[74px_minmax(0,1fr)] gap-3 px-4 py-3">
                          <dt className="font-medium text-c-text3">响应</dt>
                          <dd className="leading-5 text-c-text2">{endpoint.output}</dd>
                        </div>
                      </dl>
                    </div>
                  </div>
                </article>
              );
            })}
          </section>

          <section id="errors" className="scroll-mt-8 pt-12">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-acc" aria-hidden="true" />
              <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-c-text">错误码</h2>
            </div>
            <div className="mt-5 overflow-hidden rounded-[14px] border border-c-border bg-c-card">
              {[
                ["400", "请求参数或素材格式不正确"],
                ["401", "API Key 缺失、无效或已停用"],
                ["402", "账号积分不足"],
                ["404", "任务不存在、已过期或不属于当前账号"],
                ["429", "请求过于频繁"],
                ["500", "服务处理失败，可稍后重试"],
              ].map(([code, label]) => (
                <div key={code} className="grid grid-cols-[72px_minmax(0,1fr)] gap-4 border-b border-c-border px-4 py-3 text-[12.5px] last:border-0">
                  <code className="font-mono font-semibold text-c-text">{code}</code>
                  <span className="text-c-text3">{label}</span>
                </div>
              ))}
            </div>
            <div className="mt-8 flex items-center gap-3 rounded-[14px] border border-c-border bg-c-subtle2 p-5">
              <FileImage className="h-5 w-5 shrink-0 text-acc" />
              <p className="text-[12.5px] leading-5 text-c-text3">
                图片素材建议使用 JPG、PNG 或 WebP，单张控制在 8–12 MB 内；具体限制以接口返回为准。
              </p>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
