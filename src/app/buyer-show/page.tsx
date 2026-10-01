import { StudioWorkspace } from "@/components/studio/studio-workspace";
import { BRAND } from "@/lib/brand";

export const metadata = { title: `买家秀&种草图 · ${BRAND}` };
export default function Page() { return <StudioWorkspace mode="buyer" />; }
