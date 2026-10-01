const REFERRAL_CODE_RE = /^NOVA-[A-Z0-9]{8,20}$/;
const PENDING_REFERRAL_KEY = "novaryns:pending-referral";

export function normalizeReferralCode(value: unknown): string | null {
  const code = String(value ?? "").trim().toUpperCase();
  return REFERRAL_CODE_RE.test(code) ? code : null;
}

/** Persist an invite across auth mode switches and OAuth redirects. */
export function rememberReferralCode(value: unknown): string | null {
  const code = normalizeReferralCode(value);
  if (!code || typeof window === "undefined") return code;
  try {
    window.localStorage.setItem(PENDING_REFERRAL_KEY, code);
  } catch {
    /* Storage can be unavailable in private/restricted browser contexts. */
  }
  return code;
}

export function pendingReferralCode(value?: unknown): string | null {
  const direct = normalizeReferralCode(value);
  if (direct) return rememberReferralCode(direct);
  if (typeof window === "undefined") return null;
  try {
    return normalizeReferralCode(
      window.localStorage.getItem(PENDING_REFERRAL_KEY)
    );
  } catch {
    return null;
  }
}

export function clearPendingReferralCode(expected?: string | null): void {
  if (typeof window === "undefined") return;
  try {
    const current = normalizeReferralCode(
      window.localStorage.getItem(PENDING_REFERRAL_KEY)
    );
    if (!expected || !current || current === normalizeReferralCode(expected)) {
      window.localStorage.removeItem(PENDING_REFERRAL_KEY);
    }
  } catch {
    /* Best-effort cleanup only. */
  }
}
