import { NextResponse } from "next/server";
import { getCloudflareAISettings, getCutoutSettings, getOpenAISettings } from "@/lib/settings";
import { cloudflareAvailable } from "@/lib/cloudflare-ai";

export const dynamic = "force-dynamic";
export async function GET() {
  const [cloudflare, openai, cutout] = await Promise.all([getCloudflareAISettings(), getOpenAISettings(), getCutoutSettings()]);
  return NextResponse.json({
    cutout: true,
    generation: !!openai.apiKey.trim() || (cloudflare.ready && await cloudflareAvailable()),
    planning: openai.apiKey.trim() ? "vision" : "template",
    upscale: !!cutout.replicateToken.trim(),
    video: !!process.env.REPLICATE_API_TOKEN?.trim(),
  }, { headers: { "Cache-Control": "no-store" } });
}
