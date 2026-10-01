import { PricingClient } from "@/components/pricing/pricing-client";
import { BRAND } from "@/lib/brand";

export const metadata = { title: `套餐价格 — ${BRAND}` };

export default function PricingPage() {
  return <PricingClient />;
}
