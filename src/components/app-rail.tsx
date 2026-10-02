"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Headset,
  Image as ImageIcon,
  Images,
  Languages,
  Menu,
  PanelLeftClose,
  PenTool,
  Play,
  Replace,
  Scissors,
  Shirt,
  Sparkles,
  Wand2,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useBrand } from "@/lib/brand-context";
import { FRIENDS_MODE } from "@/lib/friends-mode";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: "NEW" | "Beta";
  aliases?: string[];
};

const ALL_ITEMS: NavItem[] = [
  { href: "/batch-matting", label: "商品白底图", icon: Scissors, aliases: ["/cutout", "/batch-cutout"] },
  { href: "/studio-genesis", label: "全品类商品图", icon: Sparkles, aliases: ["/suite"] },
  { href: "/aesthetic-mirror", label: "风格复刻", icon: ImageIcon, aliases: ["/style", "/style-copy"] },
  { href: "/sku-replace", label: "SKU 替换", icon: Replace, badge: "NEW", aliases: ["/fuse"] },
  { href: "/clothing-studio", label: "服装组图", icon: Shirt, aliases: ["/tryon", "/garment", "/garment3d", "/clothing-group"] },
  { href: "/buyer-show", label: "买家秀&种草图", icon: Images, badge: "NEW", aliases: ["/avatar", "/variations"] },
  { href: "/refinement-studio", label: "图片精修", icon: Wand2, aliases: ["/upscale", "/dewrinkle", "/dewatermark", "/inpaint", "/image-retouch"] },
  { href: "/batch-translation", label: "图片翻译", icon: Languages, aliases: ["/image-translate"] },
  { href: "/canvas-studio", label: "万能画布", icon: PenTool, badge: "Beta", aliases: ["/canvas"] },
  { href: "/video-studio", label: "电商视频", icon: Play, badge: "Beta", aliases: ["/generate", "/ecommerce-video"] },
];

const FRIENDS_ITEMS: NavItem[] = [
  { href: "/batch-matting", label: "商品白底图", icon: Scissors, aliases: ["/cutout", "/batch-cutout"] },
  { href: "/refinement-studio", label: "图片精修", icon: Wand2, aliases: ["/image-retouch"] },
  { href: "/canvas-studio", label: "万能画布", icon: PenTool, aliases: ["/canvas", "/history"] },
];

const ITEMS = FRIENDS_MODE ? FRIENDS_ITEMS : ALL_ITEMS;

function activeFor(path: string, item: NavItem) {
  return path === item.href || path.startsWith(`${item.href}/`) || !!item.aliases?.some((p) => path === p || path.startsWith(`${p}/`));
}

function destinationFor(path: string, item: NavItem) {
  return item.href === "/pricing" ? `/pricing?return_to=${encodeURIComponent(path)}` : item.href;
}

function Brand({ mobile = false, collapsed = false }: { mobile?: boolean; collapsed?: boolean }) {
  const { name: brandName } = useBrand();

  return (
    <Link
      href="/"
      aria-label={`${brandName} 首页`}
      className={cn(
        mobile
          ? "flex h-16 min-w-0 items-center gap-2.5 text-[#18181b] no-underline"
          : "picset-brand",
        !mobile && collapsed && "!justify-center !px-0"
      )}
      style={mobile ? undefined : { height: 64, minHeight: 64 }}
    >
      <span
        className={mobile ? "grid shrink-0 place-items-center text-white" : "picset-brand-mark"}
        style={{
          width: 40,
          height: 40,
          borderRadius: 16,
          background: "#18181b",
          boxShadow: "0 1px 2px rgba(0,0,0,.05)",
        }}
      >
        <Sparkles aria-hidden="true" className={mobile ? "h-5 w-5" : undefined} />
      </span>
      <strong className={mobile ? "truncate text-lg font-extrabold tracking-[-.6px]" : undefined}>{brandName}</strong>
    </Link>
  );
}

export function AppRail() {
  const path = usePathname() || "/studio-genesis";
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem("studio:sidebar-collapsed") === "1";
    setCollapsed(saved);
    document.documentElement.classList.toggle("picset-sidebar-collapsed", saved);
    return () => document.documentElement.classList.remove("picset-sidebar-collapsed");
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [path]);

  useEffect(() => {
    if (!mobileOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobileOpen]);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    document.documentElement.classList.toggle("picset-sidebar-collapsed", next);
    window.localStorage.setItem("studio:sidebar-collapsed", next ? "1" : "0");
  }

  return (
    <>
      <aside className="picset-sidebar max-[760px]:!hidden min-[761px]:!flex min-[761px]:!pt-0" aria-label="创作工具">
        <Brand collapsed={collapsed} />

        <nav className="picset-nav">
          {ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeFor(path, item);
            return (
              <Link
                key={item.href}
                href={destinationFor(path, item)}
                title={collapsed ? item.label : undefined}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "picset-nav-item",
                  active && "is-active",
                  item.href === "/invite" && !active && "!font-medium !text-orange-600"
                )}
              >
                <Icon aria-hidden="true" />
                <span>{item.label}</span>
                {item.badge && (
                  <em
                    className={cn(
                      "picset-nav-badge",
                      item.badge === "NEW" ? "is-new !bg-[#ff4d4f] !text-white" : "is-beta !bg-amber-100 !text-amber-700"
                    )}
                  >
                    {item.badge}
                  </em>
                )}
              </Link>
            );
          })}
        </nav>

        <button type="button" className="picset-collapse" onClick={toggle} title={collapsed ? "展开导航" : "收起导航"}>
          <PanelLeftClose aria-hidden="true" className={cn(collapsed && "rotate-180")} />
          <span>{collapsed ? "展开导航" : "收起导航"}</span>
        </button>
      </aside>

      <header className="sticky top-0 z-[70] flex h-16 items-center justify-between border-b border-zinc-200 bg-[#f5f5f6] px-4 min-[761px]:!hidden">
        <Brand mobile />
        <div className="flex items-center gap-2">
          <Link
            href="/contact"
            aria-label="联系我们"
            className="grid h-10 w-10 place-items-center rounded-xl border border-zinc-200 bg-white text-zinc-800 shadow-sm transition-colors hover:bg-zinc-50 active:bg-zinc-100"
          >
            <Headset aria-hidden="true" className="h-5 w-5" />
          </Link>
          <button
            type="button"
            className="grid h-10 w-10 place-items-center rounded-xl border border-zinc-200 bg-white text-zinc-800 shadow-sm"
            aria-label={mobileOpen ? "关闭导航" : "打开导航"}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((open) => !open)}
          >
            {mobileOpen ? <X aria-hidden="true" className="h-5 w-5" /> : <Menu aria-hidden="true" className="h-5 w-5" />}
          </button>
        </div>
      </header>

      {mobileOpen && (
        <>
          <button
            type="button"
            aria-label="关闭导航"
            className="fixed inset-0 top-16 z-[64] bg-black/20 min-[761px]:!hidden"
            onClick={() => setMobileOpen(false)}
          />
          <div className="fixed inset-x-0 top-16 z-[65] max-h-[calc(100dvh-4rem)] overflow-y-auto border-b border-zinc-200 bg-[#f5f5f6] p-3 shadow-xl min-[761px]:!hidden">
            <nav className="space-y-1" aria-label="移动端创作工具">
              {ITEMS.map((item) => {
                const Icon = item.icon;
                const active = activeFor(path, item);
                return (
                  <Link
                    key={item.href}
                    href={destinationFor(path, item)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex min-h-10 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-zinc-600 no-underline",
                      active && "bg-[#18181b] text-white",
                      item.href === "/invite" && !active && "text-orange-600"
                    )}
                  >
                    <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
                    <span>{item.label}</span>
                    {item.badge && (
                      <em className={cn("ml-auto rounded px-1.5 py-0.5 text-[9px] not-italic leading-3", item.badge === "NEW" ? "bg-[#ff4d4f] font-extrabold text-white" : "bg-amber-100 font-extrabold text-amber-700")}>
                        {item.badge}
                      </em>
                    )}
                  </Link>
                );
              })}
            </nav>

          </div>
        </>
      )}
    </>
  );
}
