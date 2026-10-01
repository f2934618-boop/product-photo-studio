# 部署

GitHub 只保存代码并通过 Actions 构建容器镜像。GitHub Pages、静态网页托管或仓库本身不能运行本项目的 API、Postgres、图片处理和持久化存储；完整功能需要一台安装了 Docker 的 Linux 主机。

## 最短部署

服务器建议至少 2 GB 内存、20 GB 可用磁盘，并开放 80 端口。

```bash
git clone https://github.com/f2934618-boop/product-photo-studio.git
cd product-photo-studio
printf 'POSTGRES_PASSWORD=%s\nSETTINGS_SECRET=%s\n' "$(openssl rand -hex 24)" "$(openssl rand -hex 32)" > .env
docker compose up -d --build
```

打开 `http://服务器IP`，在首启向导中设置管理员密码、AI 接口和站点名称。80 端口被占用时，在 `.env` 增加 `HTTP_PORT=8080` 后重新执行最后一条命令。

`.env` 已被 Git 忽略。不要提交、截图或共享其中的 `POSTGRES_PASSWORD` 和 `SETTINGS_SECRET`；实例创建后不要修改 `SETTINGS_SECRET`，否则已加密的配置无法解密。

## 使用 GHCR 预构建镜像

推送到 `main` 后，[`.github/workflows/docker.yml`](.github/workflows/docker.yml) 会发布：

```text
ghcr.io/f2934618-boop/product-photo-studio:latest
ghcr.io/f2934618-boop/product-photo-studio:sha-<commit>
```

在前面的 `.env` 追加镜像地址，然后拉取启动：

```bash
echo 'APP_IMAGE=ghcr.io/f2934618-boop/product-photo-studio:latest' >> .env
docker compose pull app
docker compose up -d --no-build
```

GHCR 包为私有时，先执行 `docker login ghcr.io`，或在 GitHub Packages 中把包设为 Public。开启 Supabase 多用户模式时，在仓库 Actions Variables 中设置 `NEXT_PUBLIC_SUPABASE_URL` 和 `NEXT_PUBLIC_SUPABASE_ANON_KEY` 后重新运行工作流。

## 更新与备份

源码构建更新：

```bash
git pull --ff-only
docker compose up -d --build
```

GHCR 镜像更新：

```bash
docker compose pull app
docker compose up -d --no-build
```

数据库和媒体文件分别保存在 `pgdata`、`appdata` Docker 卷中。升级或迁移前至少备份数据库：

```bash
docker compose exec -T db pg_dump -U novaryns novaryns > backup.sql
```

查看状态与日志：

```bash
docker compose ps
docker compose logs -f app
```
