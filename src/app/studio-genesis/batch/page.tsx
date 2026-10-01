import type { Metadata } from "next";
import { BatchStudioClient } from "@/components/studio/batch-studio-client";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: `批量任务管理 · ${BRAND}`,
  description: "批量创建和管理 AI 商品图生成任务。",
};

export default function StudioGenesisBatchPage() {
  return <BatchStudioClient />;
}
