/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep local dev output separate from production builds when multiple
  // contributors validate the same checkout in parallel.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // standalone 输出:Docker 镜像用(.next/standalone 自带精简 node_modules)。
  // 服务器上 `next start` 不受影响,两种运行方式共存。
  output: "standalone",
  // 原生模块(含 .node 二进制)不能被 webpack 打包,标记为服务端外部依赖,
  // 运行时直接 require。sharp 是原生模块(图像缩放,generate-image 用)。
  serverExternalPackages: ["sharp"],
};

export default nextConfig;
