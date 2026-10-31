# 自部署 Go 后端

除了 Cloudflare，quiz 也可以部署在你自己的服务器上。自部署后端是一个用 Go 编写的可执行文件 `quiz-server`：

- 内置整个前端，不需要另外部署静态文件；
- 使用 SQLite 单文件数据库，不需要安装数据库服务；
- 接口与 Cloudflare Worker 完全相同，前端无需任何配置；
- 数据库结构与 Cloudflare D1 相同，两种部署方式之间可以互相迁移账户和题库。

只想部署到 Cloudflare，请看 [连接并部署到 Cloudflare](cloudflare.md)。

## 该选哪一种？

| | Cloudflare Workers + D1 | 自己的服务器（Go） |
| --- | --- | --- |
| 需要的东西 | Cloudflare 账户 | 一台能运行 Docker 或 Linux 程序的服务器 |
| 费用 | 免费套餐通常足够 | 服务器费用 |
| 维护 | 无需维护服务器 | 需要自己更新、备份、配置 HTTPS |
| 数据位置 | Cloudflare | 你的服务器上的一个文件 |
| 适合 | 想快速上线、不想管服务器 | 内网使用、数据必须留在自己手里、已有服务器 |

## 方式一：Docker Compose（推荐）

服务器上需要安装 Docker。把项目代码复制到服务器后，在项目根目录运行：

```bash
docker compose up -d
```

然后打开 `http://服务器地址:8080`。数据库保存在名为 `quiz-data` 的 Docker 卷中，更新或重建容器不会丢失数据。

更新到新版本：

```bash
git pull
docker compose up -d --build
```

查看日志：

```bash
docker compose logs -f quiz
```

如果想把数据库放在宿主机的某个目录（方便直接备份），可以把 `compose.yaml` 中的卷改为目录挂载，例如 `./data:/data`。容器内程序以 UID 65532 运行，需要先授予该目录写权限：

```bash
mkdir -p data && sudo chown 65532:65532 data
```

## 方式二：直接运行可执行文件

需要 Go 1.26 或更高版本来编译（运行时不需要 Go）：

```bash
npm run server:build        # 或：go build -o bin/quiz-server ./server/cmd/quiz-server
./bin/quiz-server -addr :8080 -db ./data/quiz.db
```

编译出的 `bin/quiz-server` 是静态链接的单个文件，可以复制到任何同架构的 Linux 服务器上运行。交叉编译示例：

```bash
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -o bin/quiz-server-arm64 ./server/cmd/quiz-server
```

开发时也可以直接运行 `npm run server`（等同于 `go run ./server/cmd/quiz-server`），在 `http://localhost:8080` 访问。

### 用 systemd 保持运行

`/etc/systemd/system/quiz.service`：

```ini
[Unit]
Description=quiz
After=network.target

[Service]
ExecStart=/opt/quiz/quiz-server -addr 127.0.0.1:8080 -db /var/lib/quiz/quiz.db -trust-proxy
DynamicUser=yes
StateDirectory=quiz
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now quiz
```

`DynamicUser` 和 `StateDirectory` 会自动创建 `/var/lib/quiz` 并以独立的低权限用户运行程序。

## 参数

| 参数 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `-addr` | `QUIZ_ADDR` | `:8080` | 监听地址。只允许本机反向代理访问时用 `127.0.0.1:8080` |
| `-db` | `QUIZ_DB` | `quiz.db` | SQLite 数据库文件，不存在时自动创建并建表 |
| `-trust-proxy` | `QUIZ_TRUST_PROXY` | `false` | 位于反向代理之后时开启，见下文 |
| `-static` | `QUIZ_STATIC` | 空 | 使用指定目录中的前端文件代替内置前端，用于调试或自定义界面 |
| `-api-only` | — | `false` | 只提供 `/api`，不提供网页 |

启动时会自动执行 `migrations/` 中尚未执行的表结构迁移，并每小时清理一次过期的登录会话。

## 配置 HTTPS

正式使用时请通过 HTTPS 访问，否则密码和登录 Cookie 会以明文传输。推荐在 `quiz-server` 前面放一个反向代理，并开启 `-trust-proxy`（Docker 中把 `QUIZ_TRUST_PROXY` 改为 `"true"`）。开启后程序会根据代理传来的 `X-Forwarded-Proto` 和 `X-Forwarded-Host` 判断原始地址，为登录 Cookie 加上 `Secure` 标记，并据此校验请求来源。

**只有在程序无法被绕过代理直接访问时才开启 `-trust-proxy`**（例如只监听 `127.0.0.1`，或 Docker 端口只映射到 `127.0.0.1:8080:8080`），否则别人可以伪造这些请求头。

Caddy（自动申请证书，最简单）：

```caddyfile
quiz.example.com {
	reverse_proxy 127.0.0.1:8080
}
```

Nginx：

```nginx
server {
    listen 443 ssl;
    server_name quiz.example.com;
    # ssl_certificate / ssl_certificate_key ...

    client_max_body_size 100m;   # 允许一次导入大题库

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

## 备份与恢复

数据库是一个 SQLite 文件（WAL 模式，旁边可能还有 `-wal`、`-shm` 文件）。推荐用导出命令生成一份可读的 SQL 备份，运行中也可以安全执行：

```bash
quiz-server export -db ./data/quiz.db > quiz-backup-$(date +%F).sql
# Docker：
docker compose exec -T quiz /quiz-server export > quiz-backup-$(date +%F).sql
```

导出内容包含账户（密码哈希）和全部题目，不含登录会话。请妥善保管。

从备份恢复到一个新的数据库文件（目标文件已存在时会拒绝执行，避免覆盖）：

```bash
quiz-server import -db ./data/restored.db quiz-backup.sql
```

确认无误后停止服务，用新文件替换旧数据库再启动。

## 与 Cloudflare 互相迁移

两种后端使用相同的表结构、密码哈希算法和迁移记录表（`d1_migrations`），因此账户密码和题目都能完整迁移，用户只需重新登录。

**从 Cloudflare 迁到自己的服务器**

```bash
cd cloudflare
npx wrangler d1 export quiz --remote --output=../quiz-d1.sql
cd ..
quiz-server import -db ./data/quiz.db quiz-d1.sql
```

使用 Docker 时，在**第一次启动服务之前**导入（此时卷中还没有数据库文件）：

```bash
docker compose run --rm -v "$PWD/quiz-d1.sql:/tmp/quiz-d1.sql:ro" quiz import -db /data/quiz.db /tmp/quiz-d1.sql
docker compose up -d
```

如果已经启动过、卷里有了数据库，导入会被拒绝。确认其中没有需要保留的数据后，可以用 `docker compose down -v` 删除卷（**会永久删除卷中的全部数据**）再导入。

**从自己的服务器迁到 Cloudflare**

1. 按 [Cloudflare 文档](cloudflare.md) 创建 D1 数据库并执行 `npm run db:migrate:remote`。数据库中应当还没有用户。
2. 导出并写入 D1：

   ```bash
   quiz-server export -db ./data/quiz.db > quiz-data.sql
   cd cloudflare
   npx wrangler d1 execute quiz --remote --file=../quiz-data.sql
   ```

D1 对单条 SQL 语句的长度有上限（约 100 KB）。一道题的题目、提示和答案合计特别长时，该行可能写入失败，需要先缩短内容。

## 常见问题

**注册或保存时提示“服务器暂时无法处理请求”**
查看 `docker compose logs quiz` 或 `journalctl -u quiz`。常见原因是数据库目录没有写权限。

**保存时返回 403 `forbidden_origin`**
浏览器地址与程序看到的 Host 不一致。经过反向代理时，确认代理传递了 `Host`（或 `X-Forwarded-Host`）请求头，并开启了 `-trust-proxy`。

**导入大题库失败（413）**
反向代理限制了请求体大小。Nginx 设置 `client_max_body_size 100m;`。

**多人使用时性能如何？**
SQLite 足以支撑个人、家庭或小团队使用。程序对数据库只使用一个连接，写入按顺序执行，不会出现锁冲突。
