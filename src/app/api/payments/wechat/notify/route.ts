import { dbEnabled, getOrder, fulfillOrder } from "@/lib/db";
import { getPaymentSettings } from "@/lib/settings";
import { verifyAndDecryptWxNotify } from "@/lib/pay/wechatpay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// 微信支付 Native v3 异步通知回调。application/json。
// 解密 → 校验金额 → trade_state==="SUCCESS" 时幂等履约。
// 成功返回 {code:"SUCCESS"}(200);失败返回 {code:"FAIL",...}(非 200,微信会重试)。
// ---------------------------------------------------------------------------
function fail(message: string, status = 400) {
  return new Response(JSON.stringify({ code: "FAIL", message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(req: Request) {
  if (!dbEnabled) {
    return fail("数据库未配置", 400);
  }

  const settings = await getPaymentSettings();
  if (!settings.wxpayApiv3) {
    return fail("微信支付未配置", 500);
  }
  if (!settings.wxpayPlatformKey) {
    // Never fall back to "decrypts successfully" as authentication: anyone
    // with a leaked APIv3 key could otherwise forge a paid notification.
    return fail("微信支付平台证书/公钥未配置", 503);
  }

  const rawBody = await req.text();
  if (Buffer.byteLength(rawBody, "utf8") > 128 * 1024) {
    return fail("回调体过大", 413);
  }
  // ① 严格验签,通过后再解密。
  const decrypted = verifyAndDecryptWxNotify(
    settings.wxpayApiv3,
    settings.wxpayPlatformKey,
    settings.wxpayPlatformSerial,
    req.headers,
    rawBody
  );
  if (!decrypted.ok || !decrypted.outTradeNo) {
    return fail(decrypted.error || "回调验签/解密失败", 400);
  }

  // ② 金额校验:本地订单 amount(分)对比解密出的 amount.total(分)。
  const order = await getOrder(decrypted.outTradeNo);
  if (!order) {
    return fail("订单不存在", 400);
  }
  if (!decrypted.mchid || decrypted.mchid !== settings.wxpayMchid) {
    return fail("商户号不匹配", 400);
  }
  if (!decrypted.appid || decrypted.appid !== settings.wxpayAppid) {
    return fail("AppID 不匹配", 400);
  }
  if (decrypted.currency !== "CNY") {
    return fail("币种不匹配", 400);
  }
  if (!Number.isSafeInteger(decrypted.totalFen) || decrypted.totalFen !== order.amount) {
    return fail("金额不匹配", 400);
  }

  // ③ 成功状态才履约(幂等)。
  if (decrypted.tradeState === "SUCCESS") {
    try {
      const r = await fulfillOrder(
        decrypted.outTradeNo,
        "wechat",
        decrypted.transactionId || null
      );
      if (!r.ok) return fail(r.error || "履约失败", 400);
    } catch {
      return fail("履约异常", 500);
    }
  }

  return new Response(JSON.stringify({ code: "SUCCESS" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
