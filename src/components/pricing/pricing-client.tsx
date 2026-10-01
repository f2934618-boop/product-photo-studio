"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Building2,
  Check,
  ChevronRight,
  CircleCheck,
  Diamond,
  ImageIcon,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n/locale-context";
import { usePaymentConfig } from "@/lib/payment-context";
import { useRecharge } from "@/lib/recharge-modal-context";
import {
  CREDIT_PACKS,
  fmtCredits,
  POINTS_PER_IMAGE,
  PRICING,
} from "@/lib/mock-data";
import { cn } from "@/lib/utils";

type PricingTab = "subscription" | "credits";

export function PricingClient() {
  const { locale } = useI18n();
  const L = (zh: string, en: string) => (locale === "en" ? en : zh);
  const { user, remaining } = useAuth();
  const { rechargeEnabled, pro } = usePaymentConfig();
  const { openRecharge } = useRecharge();
  const [tab, setTab] = useState<PricingTab>("credits");

  const checkout = (packId: string) =>
    openRecharge(rechargeEnabled ? "pay" : "code", packId);

  return (
    <div className="min-h-full bg-c-bg px-4 pb-16 pt-8 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-[1180px]">
        <header className="text-center">
          <h1 className="text-[30px] font-bold tracking-[-0.035em] text-c-text sm:text-[36px]">
            {L("赋能您的电商视觉", "Power your commerce visuals")}
          </h1>
          <p className="mx-auto mt-3 max-w-[620px] text-[14px] leading-6 text-c-text3">
            {L(
              "从商品素材到营销成图，按需购买积分，覆盖日常电商视觉生产。",
              "From product assets to campaign-ready images, buy credits as needed for everyday commerce production."
            )}
          </p>
          <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-c-border2 bg-c-card px-4 py-2 text-[13px] shadow-card">
            <Diamond className="h-4 w-4 text-acc" aria-hidden="true" />
            <span className="text-c-text3">{L("当前积分", "Current credits")}</span>
            <strong className="tabular-nums text-c-text">{fmtCredits(remaining)}</strong>
          </div>
        </header>

        <div className="mx-auto mt-8 flex w-fit rounded-[12px] bg-c-subtle p-1" role="tablist" aria-label={L("价格类型", "Pricing type")}>
          {([
            ["subscription", L("订阅套餐", "Subscriptions")],
            ["credits", L("购买积分", "Buy credits")],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={cn(
                "min-w-[116px] rounded-[9px] px-5 py-2.5 text-[13.5px] font-semibold transition-colors",
                tab === value
                  ? "bg-c-card text-c-text shadow-card"
                  : "text-c-text3 hover:text-c-text2"
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "subscription" ? (
          <section className="mt-8" aria-labelledby="subscription-title">
            <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 id="subscription-title" className="text-[18px] font-bold text-c-text">
                  {L("订阅套餐", "Subscription plans")}
                </h2>
                <p className="mt-1 text-[12.5px] text-c-text3">
                  {L(
                    "当前版本已切换为积分按量付费，订阅购买暂未开放。",
                    "This version now uses pay-as-you-go credits; subscription checkout is currently unavailable."
                  )}
                </p>
              </div>
              <span className="w-fit rounded-full bg-c-subtle px-3 py-1.5 text-[11.5px] font-medium text-c-text3">
                {L("按月方案", "Monthly plans")}
              </span>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {PRICING.map((plan) => {
                const current = user?.plan === plan.id;
                return (
                  <article
                    key={plan.id}
                    className={cn(
                      "relative flex min-h-[410px] flex-col rounded-card border bg-c-card p-5 shadow-card",
                      plan.highlighted ? "border-acc" : "border-c-border"
                    )}
                  >
                    {plan.highlighted && (
                      <span className="absolute -top-3 left-5 rounded-full bg-acc px-3 py-1 text-[10.5px] font-bold text-white">
                        {L("热门方案", "Popular")}
                      </span>
                    )}
                    <h3 className="text-[17px] font-bold text-c-text">{plan.name}</h3>
                    <p className="mt-1 min-h-[38px] text-[12px] leading-[19px] text-c-text3">
                      {plan.tagline}
                    </p>
                    <div className="mt-5 flex items-end gap-1">
                      <span className="text-[30px] font-bold leading-none tracking-tight text-c-text">
                        {plan.price}
                      </span>
                      <span className="pb-0.5 text-[11.5px] text-c-text3">{plan.period}</span>
                    </div>
                    <div className="mt-4 rounded-[10px] bg-c-subtle2 px-3 py-2.5 text-[12.5px] font-semibold text-c-text2">
                      {plan.credits}
                    </div>
                    <ul className="mt-5 flex-1 space-y-3">
                      {plan.features.map((feature) => (
                        <li key={feature} className="flex items-start gap-2 text-[12.5px] leading-5 text-c-text2">
                          <Check className="mt-0.5 h-3.5 w-3.5 flex-none text-c-success" strokeWidth={2.5} />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                    <button
                      type="button"
                      disabled
                      className={cn(
                        "mt-6 w-full rounded-[10px] border px-4 py-2.5 text-[13px] font-semibold",
                        current
                          ? "border-acc-border bg-acc-tint text-acc"
                          : "border-c-border2 bg-c-subtle text-c-text4"
                      )}
                    >
                      {current ? L("当前方案", "Current plan") : L("暂未开放", "Unavailable")}
                    </button>
                  </article>
                );
              })}
            </div>
          </section>
        ) : (
          <section className="mt-8" aria-labelledby="credits-title">
            <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 id="credits-title" className="text-[18px] font-bold text-c-text">
                  {L("一次性购买积分", "One-time credit packs")}
                </h2>
                <p className="mt-1 text-[12.5px] text-c-text3">
                  {L("积分自到账起 2 年有效，购买越多加赠越多。", "Credits remain valid for 2 years; larger packs include more bonus credits.")}
                </p>
              </div>
              <span className="w-fit rounded-full bg-c-tint-g px-3 py-1.5 text-[11.5px] font-semibold text-c-success">
                {L("按量付费", "Pay as you go")}
              </span>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {CREDIT_PACKS.map((pack, index) => (
                <article
                  key={pack.id}
                  className={cn(
                    "relative flex min-h-[238px] flex-col rounded-card border bg-c-card p-5 shadow-card transition-colors hover:border-acc-border",
                    index === 1 ? "border-acc" : "border-c-border"
                  )}
                >
                  {index === 1 && (
                    <span className="absolute -top-3 right-5 rounded-full bg-acc px-3 py-1 text-[10.5px] font-bold text-white">
                      {L("最受欢迎", "Most popular")}
                    </span>
                  )}
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[12px] text-c-text3">{L("到账积分", "Credits received")}</p>
                      <p className="mt-1 text-[27px] font-bold tracking-tight text-c-text">
                        {fmtCredits(pack.credits)}
                      </p>
                    </div>
                    {pack.bonus > 0 && (
                      <span className="rounded-[7px] bg-c-tint-g px-2 py-1 text-[10.5px] font-bold text-c-success">
                        {L(`赠 ${fmtCredits(pack.bonus)}`, `+${fmtCredits(pack.bonus)} bonus`)}
                      </span>
                    )}
                  </div>
                  <div className="mt-4 flex items-center gap-2 text-[12px] text-c-text3">
                    <ImageIcon className="h-4 w-4" aria-hidden="true" />
                    {L(
                      `约生成 ${fmtCredits(Math.floor(pack.credits / POINTS_PER_IMAGE))} 张标准图`,
                      `About ${fmtCredits(Math.floor(pack.credits / POINTS_PER_IMAGE))} standard images`
                    )}
                  </div>
                  <div className="mt-auto flex items-end justify-between gap-3 pt-5">
                    <div>
                      <strong className="text-[24px] text-c-text">{pack.price}</strong>
                      {pack.discount && <p className="mt-0.5 text-[10.5px] text-c-text3">{pack.discount}</p>}
                    </div>
                    <button
                      type="button"
                      onClick={() => checkout(pack.id)}
                      className="rounded-[10px] bg-acc px-4 py-2.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[rgba(79,70,229,.15)]"
                    >
                      {!pro
                        ? L("查看方式", "View options")
                        : rechargeEnabled
                          ? L("立即购买", "Buy now")
                          : L("兑换积分", "Redeem credits")}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        <section className="mt-12 grid gap-4 lg:grid-cols-[1.25fr_.75fr]">
          <div className="rounded-card border border-c-border bg-c-card p-6 shadow-card">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-acc" />
              <h2 className="text-[17px] font-bold text-c-text">{L("模型与积分消耗", "Models and credit usage")}</h2>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <div className="rounded-[12px] bg-c-subtle2 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13.5px] font-semibold text-c-text">{L("标准出图", "Standard generation")}</span>
                  <span className="rounded-full bg-c-card px-2.5 py-1 text-[11px] font-bold text-acc">{POINTS_PER_IMAGE} {L("积分/张", "credits/image")}</span>
                </div>
                <p className="mt-2 text-[12px] leading-5 text-c-text3">
                  {L("适合日常主图、场景图与营销素材生成。", "For everyday hero images, scenes and campaign assets.")}
                </p>
              </div>
              <div className="rounded-[12px] bg-c-subtle2 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13.5px] font-semibold text-c-text">{L("高阶出图", "Advanced generation")}</span>
                  <span className="rounded-full bg-c-card px-2.5 py-1 text-[11px] font-bold text-c-violet">18 {L("积分/张", "credits/image")}</span>
                </div>
                <p className="mt-2 text-[12px] leading-5 text-c-text3">
                  {L("累计充值达到解锁条件后开放，适合对细节要求更高的任务。", "Available after meeting the top-up threshold, for detail-sensitive work.")}
                </p>
              </div>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {[
                [ShieldCheck, L("真实余额", "Live balance"), L("账户积分实时同步", "Synced to your account")],
                [Zap, L("按量消耗", "Usage based"), L("不同工具按实际价格表扣除", "Charged by each tool's rate")],
                [CircleCheck, L("自动到账", "Auto credited"), L("支付完成后自动刷新余额", "Balance refreshes after payment")],
              ].map(([Icon, title, desc]) => {
                const FeatureIcon = Icon as typeof ShieldCheck;
                return (
                  <div key={String(title)} className="flex gap-3 rounded-[12px] border border-c-border p-3.5">
                    <FeatureIcon className="mt-0.5 h-4 w-4 flex-none text-acc" />
                    <div>
                      <p className="text-[12.5px] font-semibold text-c-text">{String(title)}</p>
                      <p className="mt-0.5 text-[11px] leading-4 text-c-text3">{String(desc)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col rounded-card border border-c-border bg-c-card p-6 shadow-card">
            <span className="grid h-10 w-10 place-items-center rounded-[11px] bg-c-tint-b text-c-blue">
              <Building2 className="h-5 w-5" />
            </span>
            <h2 className="mt-4 text-[17px] font-bold text-c-text">{L("团队与企业", "Teams and enterprise")}</h2>
            <p className="mt-2 text-[12.5px] leading-5 text-c-text3">
              {L("需要批量额度、团队协作或 API 接入，可提交业务需求。", "For volume credits, team workflows or API access, tell us what you need.")}
            </p>
            <Link
              href="/contact"
              className="mt-auto inline-flex items-center gap-1 pt-6 text-[13px] font-semibold text-acc hover:underline"
            >
              {L("联系商务", "Contact sales")}
              <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
