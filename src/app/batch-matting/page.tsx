import { BatchMattingClient } from "@/components/cutout/batch-matting-client";
import { BRAND } from "@/lib/brand";

export const metadata = { title: `批量抠图 · ${BRAND}` };
export default function Page() { return <BatchMattingClient />; }
