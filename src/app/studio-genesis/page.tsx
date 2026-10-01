import { StudioWorkspace } from "@/components/studio/studio-workspace";
import { BRAND } from "@/lib/brand";
import { getOpenAISettings } from "@/lib/settings";
import { redirect } from "next/navigation";

export const metadata = { title: `全品类商品图 · ${BRAND}` };
export default async function Page() {
  const { apiKey } = await getOpenAISettings();
  if (!apiKey) redirect("/batch-matting");

  return <StudioWorkspace mode="genesis" />;
}
