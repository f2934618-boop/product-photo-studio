import { StudioWorkspace } from "@/components/studio/studio-workspace";
import { BRAND } from "@/lib/brand";

export const metadata = { title: `SKU 替换 · ${BRAND}` };
export default function Page() { return <StudioWorkspace mode="sku" />; }
