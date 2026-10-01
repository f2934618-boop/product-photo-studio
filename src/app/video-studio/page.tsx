import { VideoStudio } from "@/components/generate/video-studio";
import { BRAND } from "@/lib/brand";

export const metadata = {
  title: `电商视频 · ${BRAND}`,
  description: "整理电商短视频脚本、素材、口播和生成参数。",
};

export default function VideoStudioPage() {
  return <VideoStudio />;
}
