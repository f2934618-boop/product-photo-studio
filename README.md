# Picset 商品图工作台

面向电商图片生产的全栈网页工具。页面结构、导航和主要工作流按 Picset 的公开产品界面复刻，并保留可自部署、可配置模型、可管理积分与作品的后端。

## 已实现页面

- 全品类商品图：产品分析、套图规划、主图 / 详情图 / 广告图生成
- 风格复刻：单图、批量、包装风格复刻
- SKU 替换：智能替换与多场景任务
- 服装组图：模特试穿、基础套图与分镜规划
- 买家秀、图片精修、图片翻译
- 万能画布、电商视频工作台、批量抠图
- 套餐价格、开发者 API、邀请有礼

批量抠图自带浏览器本地 U²-Net 模型，未配置付费接口也能输出透明底或白底 PNG，并按 1:1、3:4、4:3、9:16、16:9 统一画布比例。处理在浏览器内完成，保留原商品 RGB 像素与原始分辨率，不用生成模型重绘商品。

其余图片功能通过服务端 OpenAI Images 或兼容接口运行。后台可配置 API Key、模型和中转地址；未配置 Key 时接口会明确返回“服务未配置”，不会扣积分或返回假结果。电商视频通过 Replicate 的 Seedance 1.5 Pro / Kling 2.1 Master 真实出片，在服务端设置 `REPLICATE_API_TOKEN` 后即可使用；未配置时返回 503，不创建任务。视频任务的轮询授权目前保存在单个 Node 进程内，单机 / 单容器可直接使用，多实例或 Serverless 部署应改用 Redis / 数据库共享任务状态。

## 本地运行

```bash
npm install
npm run dev
```

打开 `http://localhost:3000/studio-genesis`。

生产构建：

```bash
npm run build
npm start
```

## Docker 部署

```bash
cp .env.example .env
# 为 .env 中的 POSTGRES_PASSWORD 与 SETTINGS_SECRET 生成随机值
docker compose up -d --build
```

完整部署、GHCR 镜像、更新与备份命令见 [DEPLOY.md](DEPLOY.md)。GitHub Pages 只能运行静态网页，不能运行本项目的 API、Postgres 与图片处理后端；GitHub 仓库用于保存源码并构建 Docker 镜像。

要获得可直接分享的公网 HTTPS 地址，可使用 [Railway + Neon 部署说明](docs/DEPLOY_RAILWAY.md)。

## 模型配置

首次打开网站会进入配置向导，也可以在 `/admin` 设置：

- `OPENAI_API_KEY`
- `OPENAI_IMAGE_MODEL`
- `OPENAI_BASE_URL`（可选，供兼容网关或中转使用）
- Replicate Token（可选，用于更精细的云端抠图）

不能把 API Key 写进浏览器代码或提交到 GitHub。后台配置会使用 `SETTINGS_SECRET` 加密后保存。

## 技术栈

Next.js 15、React 18、TypeScript、PostgreSQL、OpenAI Images、Replicate、ONNX Runtime Web、Sharp、React Flow、Docker。

## 许可与来源

本项目基于 [Novaryns](https://github.com/usscottli-ctrl/novaryns) 修改，继续按 [AGPL-3.0](LICENSE) 发布。对外提供修改后的网络服务时，需要按 AGPL-3.0 公开对应源码。第三方运行时与模型来源见 [THIRD_PARTY.md](THIRD_PARTY.md)。

本项目与 Picset 官方没有隶属或授权关系。
