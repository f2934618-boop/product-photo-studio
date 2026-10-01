"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Copy, Gift, Link2, Sparkles, Users } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useAuthModal } from "@/lib/auth-modal-context";
import { useBrand } from "@/lib/brand-context";
import { useI18n } from "@/lib/i18n/locale-context";
import { authHeader } from "@/lib/supabase";
import { useToast } from "@/components/ui/toast";

type ReferralDashboard = {
  code: string;
  inviteCount: number;
  rewardCredits: number;
  rewardPerPaidInvite: number;
  referrals: Array<{
    invitee: string;
    status: "registered" | "qualified" | "rewarded";
    rewardCredits: number;
    registeredAt: string;
    qualifiedAt: string | null;
    rewardedAt: string | null;
  }>;
};

export function InviteClient() {
  const { locale } = useI18n();
  const L = (zh: string, en: string) => (locale === "en" ? en : zh);
  const { name } = useBrand();
  const { user, ready } = useAuth();
  const { openAuth } = useAuthModal();
  const { toast } = useToast();
  const [dashboard, setDashboard] = useState<ReferralDashboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState<"link" | "code" | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    if (!user?.email) {
      setDashboard(null);
      setLoadError(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    void (async () => {
      try {
        const response = await fetch("/api/referrals", {
          headers: await authHeader(),
          cache: "no-store",
          signal: controller.signal,
        });
        const data = (await response.json().catch(() => null)) as
          | (ReferralDashboard & { error?: string })
          | null;
        if (!response.ok || !data) {
          throw new Error(data?.error || L("邀请数据读取失败", "Could not load referral data"));
        }
        setDashboard(data);
      } catch (error) {
        if (controller.signal.aborted) return;
        setDashboard(null);
        setLoadError(
          error instanceof Error
            ? error.message
            : L("邀请数据读取失败", "Could not load referral data")
        );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [user?.email, user?.joinedAt, locale]);

  const code = dashboard?.code ?? "";
  const inviteUrl = useMemo(
    () => (origin && code ? `${origin}/sign-up?ref=${encodeURIComponent(code)}` : ""),
    [origin, code]
  );

  async function copyText(value: string, kind: "link" | "code") {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const input = document.createElement("textarea");
      input.value = value;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
    }
    setCopied(kind);
    toast(
      kind === "link"
        ? L("邀请链接已复制", "Invite link copied")
        : L("邀请码已复制", "Invite code copied")
    );
    window.setTimeout(() => setCopied(null), 1800);
  }

  const fieldFallback = !ready
    ? L("正在读取…", "Loading…")
    : !user
      ? L("登录后获取", "Sign in to get yours")
      : loading
        ? L("正在读取…", "Loading…")
        : L("暂不可用", "Unavailable");

  return (
    <div className="min-h-full bg-c-bg px-4 pb-16 pt-7 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-[1120px]">
        <section className="overflow-hidden rounded-[22px] bg-[#E0FB71] p-6 text-[#191d16] sm:p-9 lg:grid lg:grid-cols-[1fr_1.08fr] lg:gap-12 lg:p-12">
          <div className="flex flex-col justify-center">
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-[#191d16] px-3 py-1.5 text-[11px] font-bold text-white">
              <Gift className="h-3.5 w-3.5" />
              {L("邀请有礼", "Invite and earn")}
            </span>
            <h1 className="mt-5 whitespace-pre-line text-[34px] font-bold leading-[1.13] tracking-[-0.045em] sm:text-[44px]">
              {L(`邀请好友一起使用\n${name}`, `Invite friends to use\n${name}`)}
            </h1>
            <p className="mt-4 max-w-[430px] text-[13.5px] leading-6 text-[#4b5536]">
              {L(
                "分享账号专属邀请链接。好友完成注册与首次有效付费后，邀请记录和奖励会自动确认。",
                "Share your account referral link. Records and rewards are confirmed after a friend registers and completes their first valid payment."
              )}
            </p>
            {!user && ready && (
              <button
                type="button"
                onClick={() => openAuth("sign-in")}
                className="mt-6 w-fit rounded-[10px] bg-[#191d16] px-5 py-2.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
              >
                {L("登录后获取邀请链接", "Sign in for your invite link")}
              </button>
            )}
          </div>

          <div className="mt-8 rounded-[18px] bg-white p-4 shadow-[0_16px_50px_rgba(63,76,18,.13)] sm:p-5 lg:mt-0">
            <p className="text-[14px] font-bold text-[#191d16]">{L("我的专属邀请", "My invitation")}</p>
            <p className="mt-1 text-[11.5px] text-[#7d856e]">
              {user
                ? L("邀请码已绑定当前账号", "Invite code linked to your account")
                : L("登录后由服务器生成专属邀请码", "Sign in to get a server-issued code")}
            </p>

            <CopyField
              icon={Link2}
              label={L("邀请链接", "Invite link")}
              value={inviteUrl || fieldFallback}
              copied={copied === "link"}
              disabled={!inviteUrl}
              onCopy={() => copyText(inviteUrl, "link")}
            />
            <CopyField
              icon={Sparkles}
              label={L("邀请码", "Invite code")}
              value={code || fieldFallback}
              copied={copied === "code"}
              disabled={!code}
              onCopy={() => copyText(code, "code")}
            />

            <div className="mt-4 rounded-[12px] bg-[#f5f8ed] p-3.5">
              <div className="flex items-center gap-2 text-[12.5px] font-bold text-[#303629]">
                <Gift className="h-4 w-4" />
                {L("邀请奖励", "Referral rewards")}
              </div>
              <p className="mt-1.5 text-[11.5px] leading-5 text-[#717a63]">
                {dashboard?.rewardPerPaidInvite
                  ? L(
                      `每位好友首次有效付费后，你将获得 ${dashboard.rewardPerPaidInvite} 积分。`,
                      `Earn ${dashboard.rewardPerPaidInvite} credits after each friend's first valid payment.`
                    )
                  : dashboard
                    ? L(
                        "当前活动暂停发放积分，邀请关系仍会正常记录。",
                        "Credit rewards are paused; referral relationships are still recorded."
                      )
                  : L(
                      "奖励以账号后台的当前活动配置为准。",
                      "Rewards follow the account's current campaign configuration."
                    )}
              </p>
              {loadError && (
                <p className="mt-2 text-[11.5px] text-red-600">{loadError}</p>
              )}
            </div>
          </div>
        </section>

        <section className="mt-6 grid gap-4 sm:grid-cols-2" aria-label={L("邀请统计", "Referral statistics")}>
          <StatCard
            label={L("成功邀请", "Successful invites")}
            value={dashboard ? String(dashboard.inviteCount) : "—"}
            suffix={L("人", "people")}
            icon={Users}
          />
          <StatCard
            label={L("累计获得", "Credits earned")}
            value={dashboard ? String(dashboard.rewardCredits) : "—"}
            suffix={L("积分", "credits")}
            icon={Gift}
          />
        </section>

        <section className="mt-6 grid gap-5 lg:grid-cols-[.82fr_1.18fr]">
          <div className="rounded-card border border-c-border bg-c-card p-5 shadow-card sm:p-6">
            <h2 className="text-[16px] font-bold text-c-text">{L("活动规则", "Rules")}</h2>
            <ol className="mt-5 space-y-4">
              {[
                L("好友需通过专属链接进入注册流程，系统会在首次创建账号时绑定邀请关系。", "Friends must enter sign-up through your link; the referral is bound when their account is first created."),
                L("好友首次有效付费完成后，邀请奖励自动发放。", "The reward is issued after the friend's first valid payment."),
                L("同一位好友仅能绑定一位邀请人，重复支付不会重复发奖。", "Each friend can have one inviter, and repeated payments do not issue duplicate rewards."),
                L("异常或退款订单的处理以站点活动规则为准。", "Abnormal or refunded orders follow the site's campaign rules."),
              ].map((rule, index) => (
                <li key={rule} className="flex gap-3 text-[12.5px] leading-5 text-c-text2">
                  <span className="grid h-5 w-5 flex-none place-items-center rounded-full bg-c-subtle text-[10.5px] font-bold text-c-text3">
                    {index + 1}
                  </span>
                  <span>{rule}</span>
                </li>
              ))}
            </ol>
          </div>

          <div className="overflow-hidden rounded-card border border-c-border bg-c-card shadow-card">
            <div className="border-b border-c-border px-5 py-4 sm:px-6">
              <h2 className="text-[16px] font-bold text-c-text">{L("邀请明细", "Referral details")}</h2>
            </div>
            <div className="grid grid-cols-[1.2fr_.8fr_.8fr] border-b border-c-border bg-c-subtle2 px-5 py-2.5 text-[11px] font-medium text-c-text3 sm:px-6">
              <span>{L("受邀用户", "Invitee")}</span>
              <span>{L("奖励", "Reward")}</span>
              <span className="text-right">{L("时间", "Time")}</span>
            </div>
            {dashboard?.referrals.length ? (
              <div className="divide-y divide-c-border">
                {dashboard.referrals.map((item) => {
                  const eventAt = item.rewardedAt || item.qualifiedAt || item.registeredAt;
                  return (
                    <div
                      key={`${item.invitee}-${item.registeredAt}`}
                      className="grid grid-cols-[1.2fr_.8fr_.8fr] items-center px-5 py-4 text-[12px] sm:px-6"
                    >
                      <span className="truncate pr-2 font-medium text-c-text2">{item.invitee}</span>
                      <span className={item.status === "rewarded" ? "font-semibold text-acc" : "text-c-text3"}>
                        {item.status === "rewarded"
                          ? `+${item.rewardCredits}`
                          : item.status === "qualified"
                            ? L("已确认", "Confirmed")
                            : L("待首次付费", "Awaiting payment")}
                      </span>
                      <time className="text-right text-c-text3" dateTime={eventAt}>
                        {new Intl.DateTimeFormat(locale === "en" ? "en" : "zh-CN", {
                          year: "numeric",
                          month: "2-digit",
                          day: "2-digit",
                        }).format(new Date(eventAt))}
                      </time>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex min-h-[230px] flex-col items-center justify-center px-5 py-10 text-center">
                <span className="grid h-12 w-12 place-items-center rounded-full bg-c-subtle text-c-text4">
                  <Users className="h-5 w-5" />
                </span>
                <p className="mt-3 text-[13px] font-semibold text-c-text2">
                  {loading
                    ? L("正在读取邀请记录", "Loading referral records")
                    : L("暂无邀请记录", "No referral records")}
                </p>
                <p className="mt-1 max-w-[280px] text-[11.5px] leading-5 text-c-text3">
                  {user
                    ? L("好友通过你的专属链接完成注册后会显示在这里。", "Friends appear here after registering through your link.")
                    : L("登录后查看账号的真实邀请记录。", "Sign in to view your account's referral records.")}
                </p>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function CopyField({
  icon: Icon,
  label,
  value,
  copied,
  disabled,
  onCopy,
}: {
  icon: typeof Link2;
  label: string;
  value: string;
  copied: boolean;
  disabled: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="mt-4">
      <label className="flex items-center gap-1.5 text-[11.5px] font-medium text-[#69705f]">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </label>
      <div className="mt-1.5 flex items-center rounded-[10px] border border-[#e7eadf] bg-[#fafbf7] p-1.5 pl-3">
        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-[#303629]">{value}</span>
        <button
          type="button"
          onClick={onCopy}
          disabled={disabled}
          className="ml-2 grid h-8 w-8 flex-none place-items-center rounded-[8px] bg-[#191d16] text-white transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9dbb2f] disabled:cursor-not-allowed disabled:opacity-35"
          aria-label={`${label}复制`}
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  suffix,
  icon: Icon,
}: {
  label: string;
  value: string;
  suffix: string;
  icon: typeof Users;
}) {
  return (
    <div className="flex items-center justify-between rounded-card border border-c-border bg-c-card p-5 shadow-card">
      <div>
        <p className="text-[12px] text-c-text3">{label}</p>
        <p className="mt-2 flex items-baseline gap-1.5">
          <strong className="text-[28px] leading-none tabular-nums text-c-text">{value}</strong>
          <span className="text-[11.5px] text-c-text3">{suffix}</span>
        </p>
      </div>
      <span className="grid h-10 w-10 place-items-center rounded-[12px] bg-acc-tint text-acc">
        <Icon className="h-5 w-5" />
      </span>
    </div>
  );
}
