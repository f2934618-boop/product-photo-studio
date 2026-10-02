"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Headset } from "lucide-react";
import { AppRail } from "@/components/app-rail";

const BARE_ROUTES = ["/sign-in", "/sign-up", "/setup", "/admin", "/deploy", "/licenses", "/cardkeys"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname() || "/";
  const bare = BARE_ROUTES.some((route) => path === route || path.startsWith(`${route}/`));

  if (bare) return <main className="min-h-screen">{children}</main>;

  return (
    <div className="picset-app-shell">
      <AppRail />
      <div className="picset-main-shell">
        <main className="picset-page">{children}</main>
      </div>

      <Link
        href="/contact"
        aria-label="联系我们"
        className="group fixed bottom-6 right-6 z-50 flex h-14 items-center justify-center gap-2 rounded-full bg-[#18181b] px-4 text-white shadow-lg transition-transform hover:scale-105 hover:shadow-xl active:scale-95 max-[760px]:hidden"
      >
        <Headset aria-hidden="true" className="h-6 w-6 shrink-0" />
        <span className="max-w-0 overflow-hidden whitespace-nowrap text-sm font-medium transition-all duration-300 group-hover:max-w-[100px]">联系我们</span>
      </Link>
    </div>
  );
}
