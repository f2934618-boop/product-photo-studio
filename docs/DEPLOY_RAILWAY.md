# Railway 公网部署

这套配置使用一个 Railway 应用实例、Neon PostgreSQL 和一个 Railway Volume。部署完成后 Railway 会提供公网 HTTPS 域名；浏览器本地抠图不消耗云端 AI 额度，其余生图/视频仍需对应模型接口。

## 1. 准备 Neon 数据库

1. 在 Neon 新建免费 PostgreSQL 项目。
2. 在 **Connect** 中选择 **Pooled connection**，复制连接串。主机名通常包含 `-pooler`，连接串末尾应保留 `sslmode=require`。
3. 不要把连接串提交到 GitHub；稍后把它保存为 Railway 的 `DATABASE_URL`。

## 2. 从 GitHub 部署

1. 在 Railway 新建项目，选择 **Deploy from GitHub repo**，连接 `f2934618-boop/product-photo-studio`。
2. Railway 会读取仓库根目录的 `railway.json`，使用 `Dockerfile` 构建，并固定为单实例。
3. 给应用服务添加一个 Volume，挂载路径填写 `/data`。
4. 在应用服务的 **Variables** 中添加：

```text
DATABASE_URL=<Neon 的 pooled connection string>
SETTINGS_SECRET=<至少 64 个随机十六进制字符>
MEDIA_DIR=/data/media
GEN_MAX_CONCURRENT=1
RAILWAY_RUN_UID=0
```

`RAILWAY_RUN_UID=0` 是 Railway Volume 的权限要求；Volume 由平台以 root 身份挂载。`SETTINGS_SECRET` 可在本机生成后粘贴：

```bash
openssl rand -hex 32
```

Windows PowerShell 也可以生成：

```powershell
$bytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes); $rng.Dispose()
-join ($bytes | ForEach-Object { $_.ToString('x2') })
```

保存 `SETTINGS_SECRET` 后不要修改，否则后台已加密保存的接口配置将无法解密。

## 3. 开通公网地址

在应用服务的 **Networking** 中点击 **Generate Domain**。部署日志显示健康检查通过后，打开生成的 `https://...up.railway.app` 域名；首次进入按向导设置管理员密码和模型接口。

可用下面的地址检查实例状态：

```text
https://你的域名/api/health
```

响应为 HTTP 200 才表示 Railway 会把本次部署切换为线上版本。

## 4. 费用与数据

- `railway.json` 固定 `numReplicas=1`，`GEN_MAX_CONCURRENT=1` 限制同时发起的云端生图请求。
- Neon 可从免费套餐开始；Railway 按实际资源和 Volume 用量计费，请在 Railway 项目中设置 Usage Limit/告警。
- `/data/media` 保存生成图片和模板缓存。删除 Railway Volume 会永久删除这些文件；Neon 数据库不在该 Volume 中。
- 模型调用费不包含在 Railway/Neon 费用里。未配置 OpenAI 或 Replicate 时，相应功能会返回“服务未配置”。
