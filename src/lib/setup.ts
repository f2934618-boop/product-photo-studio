import "server-only";
import { getSetting, setSetting, dbEnabled } from "@/lib/db";
import { getOpenAISettings, saveOpenAIKey } from "@/lib/settings";
import { editionName } from "@/lib/edition";
import {
  isStrongAdminPassword,
  isValidSetupEmail,
} from "@/lib/setup-validation";

// ---------------------------------------------------------------------------
// 首启配置向导(/setup)的服务端逻辑。
//
// 面向自托管买家(可能非技术、不想碰 .env):docker run 起来后打开站点,
// 未配置的实例自动进入 /setup,设置管理员密码即可用。OpenAI Key、License、
// 站点名都可选；不填模型 Key 时浏览器本地白底抠图仍可使用。
//
// 安全前提(核心):**只对「未配置」的实例生效;已配置的实例(线上站)绝不受影响**。
//   「已配置」= setup_completed 标记、旧版已有 OpenAI Key,或 edition === "cloud"。
//   满足其一即视为已配置:
//     - 访问 /setup → redirect("/");
//     - POST /api/setup → 403(自锁,配置完成后不能再被调用,防滥用)。
//   我们两站 env 有 NOVARYNS_EDITION=cloud → editionName === "cloud" → 永远「已配置」
//   → 向导永不出现、接口永远 403。
// ---------------------------------------------------------------------------

/** 向导填写的 License Key 落库项(env PRO_LICENSE_KEY 缺失时由 edition.ts 回退读取)。 */
export const PRO_LICENSE_KEY_SETTING = "pro_license_key";
/** 站点名称(为后续白标铺路,先存着)。 */
export const SITE_NAME_SETTING = "site_name";
/** 首启成功后最后写入的自锁标记；与模型 Key 解耦。 */
export const SETUP_COMPLETED_SETTING = "setup_completed";

/**
 * 本实例是否「已配置」。判定(满足其一即已配置):
 *   1) 官方云:editionName === "cloud"(我们的线上站,env 直接标记)。
 *   2) 新版首启已完成:DB 中 setup_completed=1。
 *   3) 兼容旧版:已填 OpenAI Key(DB 或 env 任一)。
 *
 * 永不抛错:DB 抖动时按「已配置」兜底,绝不误把线上站/正常实例引到向导。
 */
export async function isConfigured(): Promise<boolean> {
  if (editionName === "cloud") return true; // 官方云永远已配置
  try {
    if (dbEnabled) {
      const completed = (await getSetting(SETUP_COMPLETED_SETTING))?.trim();
      if (completed === "1" || completed === "true") return true;
    }
    // 兼容升级前只靠 OpenAI Key 完成首启的实例，避免升级后重新显示向导。
    const s = await getOpenAISettings();
    return !!s.apiKey;
  } catch {
    // 读设置失败 → 保守当作「已配置」,宁可不显示向导也不打扰正常实例。
    return true;
  }
}

/** 读向导填写的 License Key(DB);无则空串。edition.ts 的 proEnabled() 会回退读它。 */
export async function getProLicenseKeyFromDb(): Promise<string> {
  if (!dbEnabled) return "";
  try {
    return (await getSetting(PRO_LICENSE_KEY_SETTING))?.trim() || "";
  } catch {
    return "";
  }
}

/** 读向导填写的站点名称(DB);无则空串。 */
export async function getSiteName(): Promise<string> {
  if (!dbEnabled) return "";
  try {
    return (await getSetting(SITE_NAME_SETTING))?.trim() || "";
  } catch {
    return "";
  }
}

export type SetupInput = {
  /** 选填:OpenAI API Key(明文,经 TLS 传输;落库走 settings.ts 的 AES 加密)。 */
  apiKey: string;
  /** 选填:Pro 授权 License Key(落库 pro_license_key,可激活 Pro)。 */
  licenseKey?: string;
  /** 选填:站点名称(白标铺路)。 */
  siteName?: string;
  /** 必填:管理员密码(自托管无 Supabase 时的后台入口;scrypt 哈希落库)。 */
  adminPassword: string;
  /** 选填:管理员邮箱 —— 同密码一起建「站长邮箱账号」(role=admin),
   * 站长即可像官方站一样在普通登录框用邮箱+密码登录。 */
  adminEmail?: string;
};

export type SetupResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

/**
 * 落库首启配置。**仅「未配置」时可写,写完即锁**(已配置 → 返回 403,自锁)。
 * 首启还没管理员,本函数供无需登录的 /api/setup 调用,靠 isConfigured() 自锁防滥用。
 */
export async function applySetup(input: SetupInput): Promise<SetupResult> {
  if (!dbEnabled) {
    return { ok: false, status: 503, error: "未配置数据库,无法保存设置" };
  }
  // 自锁:已配置的实例(含官方云)一律拒绝,防配置完成后被再次调用覆盖。
  if (await isConfigured()) {
    return { ok: false, status: 403, error: "本实例已完成配置" };
  }

  const apiKey = (input.apiKey ?? "").trim();
  if (apiKey && apiKey.length < 8) {
    return { ok: false, status: 400, error: "请填写有效的 OpenAI API Key" };
  }

  const adminPassword = input.adminPassword ?? "";
  if (!isStrongAdminPassword(adminPassword)) {
    return {
      ok: false,
      status: 400,
      error: "管理员密码至少 10 位,并包含大写字母、小写字母、数字、符号中的至少 3 类",
    };
  }

  const adminEmail = (input.adminEmail ?? "").trim().toLowerCase();
  if (adminEmail && !isValidSetupEmail(adminEmail)) {
    return { ok: false, status: 400, error: "管理员邮箱格式无效" };
  }

  // 1) License Key(选填)—— 落库,edition.ts 会在 env 缺失时回退读取以激活 Pro。
  const licenseKey = (input.licenseKey ?? "").trim();
  if (licenseKey) {
    await setSetting(PRO_LICENSE_KEY_SETTING, licenseKey);
  }

  // 2) 站点名称(选填)—— 落库,为白标铺路。
  const siteName = (input.siteName ?? "").trim();
  if (siteName) {
    await setSetting(SITE_NAME_SETTING, siteName.slice(0, 80));
  }

  // 3) 管理员密码(必填)—— 自托管无 Supabase 时的后台入口。
  //    scrypt 哈希落库(动态 import 避免与 db/crypto 的加载顺序耦合)。
  const { setAdminPassword } = await import("@/lib/admin-auth");
  await setAdminPassword(adminPassword);

  // 4) 管理员邮箱(选填)—— 建「站长邮箱账号」(role=admin,密码同管理员密码),
  //    站长即可像官方站一样在普通登录框用邮箱+密码登录;/admin 密码入口仍保留兜底。
  if (adminEmail) {
    try {
      const { getOrCreateUser, setUserPassword, setUserRole } = await import(
        "@/lib/db"
      );
      const { hashPassword } = await import("@/lib/pw");
      await getOrCreateUser(adminEmail, "站长");
      await setUserPassword(adminEmail, hashPassword(adminPassword));
      await setUserRole(adminEmail, "admin");
    } catch {
      /* 建号失败不阻断首启(密码入口仍可用,后台可再绑定) */
    }
  }

  // 5) OpenAI Key 最后保存:旧版兼容逻辑会把「已有 Key」视为已配置，
  //    因此放到其余必需写入之后，避免中途失败导致向导提前自锁。
  if (apiKey) {
    await saveOpenAIKey(apiKey);
  }

  // 6) 所有必需写入成功后再落最终标记。之后 /setup 与 POST /api/setup 都自锁。
  await setSetting(SETUP_COMPLETED_SETTING, "1");

  return { ok: true };
}
