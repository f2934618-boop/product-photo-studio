import { StudioWorkspace } from "@/components/studio/studio-workspace";
import { BRAND } from "@/lib/brand";

export const metadata = { title: `图片翻译 · ${BRAND}` };
export default function Page() { return <StudioWorkspace mode="translation" />; }
