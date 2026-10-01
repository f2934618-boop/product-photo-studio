import { NextResponse } from "next/server";
import { dbEnabled, getOrder, ensureProLicenseForOrder } from "@/lib/db";
import { canReadPaymentOrder } from "@/lib/pay/order-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Order status lookup. Besides a random order id, the browser must hold the
// short-lived HttpOnly proof issued when that order was created.
export async function GET(req: Request) {
  if (!dbEnabled) {
    return NextResponse.json({ error: "数据库未配置" }, { status: 503 });
  }
  const id = new URL(req.url).searchParams.get("id");
  if (!id || !/^ord_[A-Za-z0-9_-]{24}$/.test(id)) {
    return NextResponse.json({ error: "缺少订单号" }, { status: 400 });
  }
  // Check access before touching the database so this endpoint is not an
  // order-existence oracle when an id leaks through logs or screenshots.
  if (!canReadPaymentOrder(req, id)) {
    return NextResponse.json(
      { error: "订单不存在" },
      { status: 404, headers: { "Cache-Control": "no-store" } }
    );
  }
  const o = await getOrder(id);
  if (!o) {
    return NextResponse.json({ error: "订单不存在" }, { status: 404 });
  }
  // Pro 直售订单已付 → 附带 License Key(幂等懒补:回调侧若没生成这里补上)。
  let licenseKey: string | null = null;
  if (o.kind === "pro" && o.status === "paid") {
    licenseKey = await ensureProLicenseForOrder(o.id, o.email).catch(() => null);
  }
  return NextResponse.json(
    {
      id: o.id,
      status: o.status,
      kind: o.kind,
      title: o.title,
      credits: o.credits,
      amount: o.amount,
      ...(licenseKey ? { licenseKey } : {}),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
