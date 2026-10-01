import { CanvasClient } from "@/components/canvas/canvas-client";
import { CanvasErrorBoundary } from "@/components/canvas/canvas-error-boundary";
export const metadata = { title: "万能画布 · Picset" };
export default function Page() { return <CanvasErrorBoundary><CanvasClient /></CanvasErrorBoundary>; }
