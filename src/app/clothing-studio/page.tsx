import { StudioWorkspace } from "@/components/studio/studio-workspace";
import { BRAND } from "@/lib/brand";

export const metadata = { title: `服装组图 · ${BRAND}` };
export default function Page() { return <StudioWorkspace mode="clothing" />; }
