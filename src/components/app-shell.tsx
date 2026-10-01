"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Diamond, Headset, UserRound } from "lucide-react";
import { AppRail } from "@/components/app-rail";
import { useAuth } from "@/lib/auth-context";

const BARE_ROUTES = ["/sign-in", "/sign-up", "/setup", "/admin", "/deploy", "/licenses", "/cardkeys"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname() || "/";
  const { user, remaining } = useAuth();
  const bare = BARE_ROUTES.some((route) => path === route || path.startsWith(`${route}/`));
  const pricingHref = `/pricing?return_to=${encodeURIComponent(path)}`;

  if (bare) return <main className="min-h-screen">{children}</main>;

  return (
    <div className="picset-app-shell">
      <AppRail />
      <div className="picset-main-shell">
        <header className="picset-topbar max-[760px]:!hidden">
          <div className="picset-topbar-actions">
            {user ? (
              <>
                <Link href={pricingHref} className="picset-credit-button" aria-label="剩余积分">
                  <Diamond aria-hidden="true" />
                  <span>{remaining}</span>
                </Link>
                <Link href="/account" className="picset-user-button" aria-label="个人中心">
                  <UserRound aria-hidden="true" />
                </Link>
              </>
            ) : (
              <Link href="/sign-in" className="picset-topbar-button !h-9 !px-4 !text-xs">
                登录
              </Link>
            )}
          </div>
        </header>
        <main className="picset-page">{children}</main>
      </div>

      <Link
        href="/contact"
        aria-label="联系我们"
        className="group fixed bottom-6 right-6 z-50 flex h-14 items-center justify-center gap-2 rounded-full bg-[#18181b] px-4 text-white shadow-lg transition-transform hover:scale-105 hover:shadow-xl active:scale-95"
      >
        <Headset aria-hidden="true" className="h-6 w-6 shrink-0" />
        <span className="max-w-0 overflow-hidden whitespace-nowrap text-sm font-medium transition-all duration-300 group-hover:max-w-[100px]">联系我们</span>
      </Link>
    </div>
  );
}
