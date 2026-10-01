import { CanvasClient } from "@/components/canvas/canvas-client";
import { CanvasErrorBoundary } from "@/components/canvas/canvas-error-boundary";
import { BRAND } from "@/lib/brand";

export const metadata = { title: `万能画布 · ${BRAND}` };
export default function Page() { return <CanvasErrorBoundary><CanvasClient /></CanvasErrorBoundary>; }
