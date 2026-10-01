"use client";
import { copyText } from "@/lib/clipboard";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, ShieldCheck, Sparkles, Loader2, Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n/locale-context";
import { isStrongAdminPassword } from "@/lib/setup-validation";

// 首启配置向导表单(单页)。
// - 未配置的自托管新实例才会渲染到这里(服务端 /setup 已做「已配置→跳首页」门控)。
// - 提交到 POST /api/setup(首启专用、自锁);写完即锁,已配置实例接口返回 403。
// - 中英双语按当前 locale 就地渲染(向导文案量小,不进字典)。

type Txt = {
  welcome: string;
  subtitle: string;
  finishHint: string;
  apiKeyLabel: string;
  apiKeyOptional: string;
  apiKeyPlaceholder: string;
  apiKeyHelp: string;
  licenseLabel: string;
  licenseOptional: string;
  licensePlaceholder: string;
  licenseHelp: string;
  siteNameLabel: string;
  siteNameOptional: string;
  siteNamePlaceholder: string;
  siteNameHelp: string;
  adminPwLabel: string;
  adminPwRecommended: string;
  adminPwPlaceholder: string;
  adminPw2Placeholder: string;
  adminPwHelp: string;
  needAdminPw: string;
  adminPwMismatch: string;
  secureNote: string;
  submit: string;
  submitting: string;
  saved: string;
  savedHint: string;
  savedPwLabel: string;
  savedPwNote: string;
  savedPwWarn: string;
  savedCopy: string;
  savedCopied: string;
  savedEnter: string;
  genericError: string;
};

const ZH: Txt = {
  welcome: "欢迎使用",
  subtitle: "只需填几项,配置完成即可开始使用。",
  finishHint: "以下配置会安全地保存到你的实例,无需改代码或环境变量。",
  apiKeyLabel: "OpenAI API Key",
  apiKeyOptional: "选填 · 可跳过",
  apiKeyPlaceholder: "可留空,以后在管理后台添加",
  apiKeyHelp: "不填也能完成初始化并免费使用浏览器本地白底抠图。AI 生图和视频会明确提示未配置,以后可在管理后台添加 OpenAI / Replicate Key。",
  licenseLabel: "License Key",
  licenseOptional: "选填 · Pro 授权",
  licensePlaceholder: "NOVA-XXXX-XXXX-XXXX-XXXX",
  licenseHelp: "填入后可解锁 Pro 功能(白标 / 收银 / 多用户 / 后台高阶)。没有可留空。",
  siteNameLabel: "站点名称",
  siteNameOptional: "选填",
  siteNamePlaceholder: "例如:我的商图工作台",
  siteNameHelp: "用于后续白标展示,可稍后再改。",
  adminPwLabel: "管理员密码",
  adminPwRecommended: "必填",
  adminPwPlaceholder: "至少 10 位,且包含 3 类字符",
  adminPw2Placeholder: "再次输入确认",
  adminPwHelp: "用于登录管理后台(改配置 / 提示词 / 品牌 / Logo)。请牢记,后续凭它进入 /admin。",
  needAdminPw: "管理员密码至少 10 位,并包含大写字母、小写字母、数字、符号中的至少 3 类",
  adminPwMismatch: "两次输入的密码不一致",
  secureNote: "管理员密码仅保存安全哈希;填写的 API Key 会加密存储。",
  submit: "保存并开始使用",
  submitting: "正在保存…",
  saved: "配置完成!",
  savedHint: "请先保存好下面的管理员密码,再进入。",
  savedPwLabel: "管理员密码",
  savedPwNote: "登录后台和站点都用它(无单独用户名,输这一个密码即可)。",
  savedPwWarn: "⚠️ 请务必复制保存!密码不会再次显示,忘记只能重装。",
  savedCopy: "复制",
  savedCopied: "已复制",
  savedEnter: "我已保存,进入后台",
  genericError: "保存失败,请稍后重试",
};

const EN: Txt = {
  welcome: "Welcome to",
  subtitle: "Fill in a few fields and you're ready to go.",
  finishHint:
    "These settings are stored securely on your instance — no code or env changes needed.",
  apiKeyLabel: "OpenAI API Key",
  apiKeyOptional: "Optional · Skip for now",
  apiKeyPlaceholder: "Leave blank and add it later in Admin",
  apiKeyHelp:
    "You can finish setup without a key and use the free in-browser background remover. AI image and video tools will clearly show that their provider is not configured; add OpenAI / Replicate keys in Admin later.",
  licenseLabel: "License Key",
  licenseOptional: "Optional · Pro license",
  licensePlaceholder: "NOVA-XXXX-XXXX-XXXX-XXXX",
  licenseHelp:
    "Enter to unlock Pro features (white-label / billing / multi-user / advanced admin). Leave blank if you don't have one.",
  siteNameLabel: "Site name",
  siteNameOptional: "Optional",
  siteNamePlaceholder: "e.g. My Product Studio",
  siteNameHelp: "Used for white-labeling later. You can change it anytime.",
  adminPwLabel: "Admin password",
  adminPwRecommended: "Required",
  adminPwPlaceholder: "10+ characters using at least 3 character types",
  adminPw2Placeholder: "Re-enter to confirm",
  adminPwHelp:
    "Used to sign in to the admin console (settings / prompts / brand / logo). Keep it safe — you'll use it to enter /admin.",
  needAdminPw:
    "Use at least 10 characters and 3 of: uppercase, lowercase, number, symbol",
  adminPwMismatch: "Passwords do not match",
  secureNote:
    "Your admin password is stored as a secure hash; any API Key is encrypted at rest.",
  submit: "Save & get started",
  submitting: "Saving…",
  saved: "All set!",
  savedHint: "Save your admin password below before continuing.",
  savedPwLabel: "Admin password",
  savedPwNote:
    "Use it to sign in to both the admin console and the site (no separate username — just this password).",
  savedPwWarn:
    "⚠️ Copy and save it now! It won't be shown again — if lost, you'll have to reinstall.",
  savedCopy: "Copy",
  savedCopied: "Copied",
  savedEnter: "I've saved it — enter admin",
  genericError: "Save failed, please try again.",
};

export function SetupClient({ brand }: { brand: string }) {
  const { locale } = useI18n();
  const t = locale === "en" ? EN : ZH;
  const router = useRouter();

  const [apiKey, setApiKey] = useState("");
  const [licenseKey, setLicenseKey] = useState("");
  const [siteName, setSiteName] = useState("");
  const [adminPw, setAdminPw] = useState("");
  const [adminPw2, setAdminPw2] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function enterAdmin() {
    // 服务端已判「已配置」;router.refresh 触发 layout 门控放行后进首页。
    router.replace("/");
    router.refresh();
  }
  async function copyPw() {
    try {
      if (!(await copyText(adminPw))) throw new Error();
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  async function submit() {
    setError(null);
    if (!isStrongAdminPassword(adminPw)) {
      setError(t.needAdminPw);
      return;
    }
    if (adminPw !== adminPw2) {
      setError(t.adminPwMismatch);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: apiKey.trim(),
          licenseKey: licenseKey.trim(),
          siteName: siteName.trim(),
          adminPassword: adminPw,
          adminEmail: adminEmail.trim(),
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;
      if (!res.ok || !data?.ok) {
        setError(data?.error || t.genericError);
        setBusy(false);
        return;
      }
      // 不自动跳转:先让用户看到并保存管理员密码,点「进入」再走。
      setDone(true);
    } catch {
      setError(t.genericError);
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-c-bg px-4 py-10">
      <div className="w-full max-w-xl">
        {/* 顶部欢迎 */}
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl [background:var(--grad-acc)] shadow-btn">
            <Sparkles className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-[22px] font-semibold text-c-text">
            {t.welcome} {brand}
          </h1>
          <p className="mt-1.5 text-[13.5px] text-c-text3">{t.subtitle}</p>
        </div>

        {/* 表单卡片 */}
        <div className="rounded-2xl border border-c-border2 bg-c-card p-6 shadow-btn sm:p-7">
          <p className="mb-5 text-[12.5px] leading-relaxed text-c-text3">
            {t.finishHint}
          </p>

          {done ? (
            <div className="space-y-4 py-2">
              <div className="flex flex-col items-center gap-2 text-center">
                <div className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-c-tint-g">
                  <Check className="h-6 w-6 text-c-success" />
                </div>
                <p className="text-[15px] font-semibold text-c-text">
                  {t.saved}
                </p>
                <p className="text-[13px] text-c-text3">{t.savedHint}</p>
              </div>
              <div className="space-y-2 rounded-xl border border-c-border2 bg-c-subtle2 p-4">
                <label className="text-[12px] font-medium text-c-text3">
                  {t.savedPwLabel}
                </label>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-lg bg-c-card px-3 py-2 font-mono text-[14px] text-c-text">
                    {adminPw}
                  </code>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void copyPw()}
                  >
                    {copied ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    {copied ? t.savedCopied : t.savedCopy}
                  </Button>
                </div>
                <p className="text-[12px] leading-relaxed text-c-text3">
                  {t.savedPwNote}
                </p>
                <p className="text-[12px] font-medium leading-relaxed text-c-danger">
                  {t.savedPwWarn}
                </p>
              </div>
              <Button
                variant="primary"
                className="w-full"
                onClick={enterAdmin}
              >
                {t.savedEnter}
              </Button>
            </div>
          ) : (
            <div className="space-y-5">
              {/* OpenAI API Key(选填；可先用浏览器本地免费能力) */}
              <div className="space-y-1.5">
                <label className="flex items-center gap-1.5 text-[13px] font-semibold text-c-text">
                  <KeyRound className="h-4 w-4 text-acc" />
                  {t.apiKeyLabel}
                  <span className="rounded-full bg-c-subtle px-2 py-0.5 text-[10.5px] font-medium text-c-text3">
                    {t.apiKeyOptional}
                  </span>
                </label>
                <Input
                  type="password"
                  autoComplete="off"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={t.apiKeyPlaceholder}
                  disabled={busy}
                />
                <p className="text-[12px] leading-relaxed text-c-text3">
                  {t.apiKeyHelp}
                </p>
              </div>

              {/* License Key(选填) */}
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 text-[13px] font-semibold text-c-text">
                  {t.licenseLabel}
                  <span className="rounded-full bg-c-tint-v px-2 py-0.5 text-[10.5px] font-medium text-c-violet">
                    {t.licenseOptional}
                  </span>
                </label>
                <Input
                  type="text"
                  autoComplete="off"
                  value={licenseKey}
                  onChange={(e) => setLicenseKey(e.target.value)}
                  placeholder={t.licensePlaceholder}
                  disabled={busy}
                />
                <p className="text-[12px] leading-relaxed text-c-text3">
                  {t.licenseHelp}
                </p>
              </div>

              {/* 站点名称(选填) */}
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 text-[13px] font-semibold text-c-text">
                  {t.siteNameLabel}
                  <span className="rounded-full bg-c-subtle px-2 py-0.5 text-[10.5px] font-medium text-c-text3">
                    {t.siteNameOptional}
                  </span>
                </label>
                <Input
                  type="text"
                  value={siteName}
                  onChange={(e) => setSiteName(e.target.value)}
                  placeholder={t.siteNamePlaceholder}
                  disabled={busy}
                />
                <p className="text-[12px] leading-relaxed text-c-text3">
                  {t.siteNameHelp}
                </p>
              </div>

              {/* 管理员密码(必填,后台入口) */}
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 text-[13px] font-semibold text-c-text">
                  <KeyRound className="h-4 w-4 text-acc" />
                  {t.adminPwLabel}
                  <span className="rounded-full bg-c-tint-g px-2 py-0.5 text-[10.5px] font-medium text-c-success">
                    {t.adminPwRecommended}
                  </span>
                </label>
                <Input
                  type="email"
                  autoComplete="email"
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                  placeholder={
                    locale === "en"
                      ? "Admin email (used to sign in, optional)"
                      : "管理员邮箱(登录账号,选填)"
                  }
                  disabled={busy}
                />
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={adminPw}
                  onChange={(e) => setAdminPw(e.target.value)}
                  placeholder={t.adminPwPlaceholder}
                  error={!!error && !isStrongAdminPassword(adminPw)}
                  disabled={busy}
                />
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={adminPw2}
                  onChange={(e) => setAdminPw2(e.target.value)}
                  placeholder={t.adminPw2Placeholder}
                  error={!!error && !!adminPw2 && adminPw !== adminPw2}
                  disabled={busy}
                />
                <p className="text-[12px] leading-relaxed text-c-text3">
                  {t.adminPwHelp}
                  {locale === "en"
                    ? " Admin email is optional: on Pro (multi-user), it lets you sign in with email + password like a regular account; on the free edition you can leave it blank."
                    : " 管理员邮箱选填:商业版(多用户)下可用邮箱+密码从登录框登录;开源版可留空,照常用密码登录。"}
                </p>
              </div>

              {error && (
                <p className="text-[12.5px] font-medium text-c-danger">{error}</p>
              )}

              <Button
                variant="primary"
                className="w-full"
                onClick={() => void submit()}
                disabled={busy}
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {busy ? t.submitting : t.submit}
              </Button>

              <p className="flex items-center justify-center gap-1.5 text-[11.5px] text-c-text4">
                <ShieldCheck className="h-3.5 w-3.5 text-c-success" />
                {t.secureNote}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
