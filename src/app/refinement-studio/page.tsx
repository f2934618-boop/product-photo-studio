import { StudioWorkspace } from "@/components/studio/studio-workspace";
import { BRAND } from "@/lib/brand";

export const metadata = { title: `图片精修 · ${BRAND}` };
export default function Page() { return <StudioWorkspace mode="refinement" />; }
