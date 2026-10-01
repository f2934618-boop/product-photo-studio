import { StudioWorkspace } from "@/components/studio/studio-workspace";
import { BRAND } from "@/lib/brand";

export const metadata = { title: `风格复刻 · ${BRAND}` };
export default function Page() { return <StudioWorkspace mode="mirror" />; }
