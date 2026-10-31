# 连接并部署到 Cloudflare

本文说明如何把 quiz 部署到 Cloudflare Workers，并连接 D1 数据库，使注册登录和云端题库可用。完成后，同一个 Worker 既提供网页，也处理 `/api/*` 请求。

想部署到自己的服务器，请看 [自部署 Go 后端](self-host.md)。两种方式的接口和数据库结构相同，之后可以互相迁移。

## 整体结构

```
浏览器 ──► Cloudflare Worker（cloudflare/worker.js）
              ├─ /api/*  → 注册、登录、题库同步 ──► D1 数据库 quiz
              └─ 其他路径 → dist/ 中的静态文件
```

| 名称 | 位置 | 作用 |
| --- | --- | --- |
| Worker 名称 `quiz` | `cloudflare/wrangler.jsonc` 的 `name` | 决定默认网址 `https://quiz.<你的子域>.workers.dev` |
| D1 数据库 `quiz` | `cloudflare/wrangler.jsonc` 的 `d1_databases` | 保存用户、登录会话和题目 |
| 绑定 `DB` | 同上 | 代码中通过 `env.DB` 访问数据库，不要修改 |
| 绑定 `ASSETS` | `cloudflare/wrangler.jsonc` 的 `assets` | 代码中通过 `env.ASSETS` 返回静态文件 |
| 表结构 | `migrations/*.sql` | 由 Wrangler 按顺序应用到数据库；Go 后端也使用这些文件 |

## 准备工作

1. 注册 Cloudflare 账户：<https://dash.cloudflare.com/sign-up>。免费套餐即可运行本项目。
2. 安装 Node.js 22.5 或更高版本。
3. 在项目根目录安装依赖（包含 Cloudflare 命令行工具 Wrangler）：

   ```bash
   npm install
   ```

之后所有 `wrangler` 命令都通过 `npx wrangler …` 运行，使用项目内安装的版本。

**Wrangler 的配置文件位于 `cloudflare/wrangler.jsonc`。** 本文中直接使用 `npx wrangler` 的命令（`login`、`whoami` 除外）都请先进入该目录再运行：

```bash
cd cloudflare
```

`npm run …` 脚本已经指定了配置文件，可以在项目根目录运行。

## 第一步：登录 Wrangler

```bash
npx wrangler login
```

命令会打开浏览器，请在 Cloudflare 页面中点击允许。完成后检查登录状态：

```bash
npx wrangler whoami
```

能看到你的邮箱和账户 ID 即表示连接成功。

**无法打开浏览器时**（例如远程服务器、CI）：在 Cloudflare 控制台的「我的个人资料 → API 令牌」中，用「编辑 Cloudflare Workers」模板创建令牌，并额外勾选 **D1 编辑** 权限，然后设置环境变量：

```bash
export CLOUDFLARE_API_TOKEN=你的令牌
export CLOUDFLARE_ACCOUNT_ID=你的账户ID   # 账户下有多个账户时需要
```

令牌等同于账户密码，不要提交到 Git。项目的 `.gitignore` 已忽略 `.env` 文件。

## 第二步：创建 D1 数据库

```bash
npx wrangler d1 create quiz
```

输出中会包含一段配置，例如：

```jsonc
{
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "quiz",
      "database_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
    }
  ]
}
```

只需要其中的 `database_id`。打开 `cloudflare/wrangler.jsonc`，把占位的 `00000000-0000-0000-0000-000000000000` 替换为这个值，其余字段保持不变。如果 Wrangler 询问是否自动写入配置文件，请检查结果，确认仍然只有一个 `binding` 为 `DB` 的数据库。

`database_id` 不是密钥，可以提交到 Git。

忘记 ID 时可以重新查看：

```bash
npx wrangler d1 list
```

## 第三步：创建数据表

```bash
npm run db:migrate:remote
```

Wrangler 会列出待执行的迁移并请求确认，输入 `y`。成功后可以查看表：

```bash
npx wrangler d1 execute quiz --remote --command "SELECT name FROM sqlite_master WHERE type='table'"
```

应能看到 `users`、`sessions`、`questions` 和 Wrangler 自己的 `d1_migrations`。

## 第四步：部署

```bash
npm run cf:deploy
```

这个命令依次执行：

1. 应用尚未执行的数据库迁移（已执行的会自动跳过）；
2. 运行 `npm run build` 生成 `dist/`；
3. 上传 Worker 和静态文件。

首次部署时 Wrangler 可能要求为账户注册一个 `workers.dev` 子域，按提示填写即可。部署完成后会输出网址，例如：

```
https://quiz.你的子域.workers.dev
```

以后修改代码，再运行一次 `npm run cf:deploy` 即可。

## 第五步：验证

在浏览器打开部署网址，右上角应出现账户（人像）按钮。也可以用命令检查后端：

```bash
curl https://quiz.你的子域.workers.dev/api/auth/me
```

返回 `{"user":null}` 表示 Worker 和数据库都已连通。然后在网页中注册一个账户、添加一道题，刷新后题目仍在，即说明云端保存正常。

## 绑定自定义域名（可选）

目前 `quiz.aimer.moe` 通过 GitHub Pages 发布（`public/CNAME`）。改由 Cloudflare 提供服务时：

1. 确认域名 `aimer.moe` 已托管在 Cloudflare（控制台「网站」列表中能看到，且域名服务器已指向 Cloudflare）。
2. 在 Cloudflare 的 DNS 设置中，删除 `quiz` 现有的 CNAME 记录（目前指向 GitHub Pages），否则无法绑定。
3. 在 `cloudflare/wrangler.jsonc` 中加入：

   ```jsonc
   "routes": [
     { "pattern": "quiz.aimer.moe", "custom_domain": true }
   ]
   ```

   也可以在控制台「Workers 和 Pages → quiz → 设置 → 域和路由」中添加。
4. 重新运行 `npm run cf:deploy`。Cloudflare 会自动创建 DNS 记录和 HTTPS 证书，通常几分钟内生效。

切换后不再需要运行 `deploy.sh` 推送 GitHub Pages。

**沿用同一个域名的好处：** 浏览器本地题库按域名保存。继续使用 `quiz.aimer.moe` 时，访客原有的本地题库仍然可见，首次登录时网站会提示把这些题目上传到账户。换成新域名则看不到旧的本地题库，需要先在旧网站导出、再在新网站导入。

## 本地开发

本地开发使用一份独立的本地数据库（保存在 `cloudflare/.wrangler/`），不会影响线上数据：

```bash
npm run db:migrate:local   # 首次或新增迁移后运行
npm run cf:dev             # 打开 http://localhost:8787
```

`npm run dev` 仍可用于只调试前端，此时没有后端，账户按钮会自动隐藏。

## 日常维护

| 需求 | 命令 |
| --- | --- |
| 查看线上实时日志 | `npx wrangler tail` |
| 查询线上数据 | `npx wrangler d1 execute quiz --remote --command "SELECT username, created_at FROM users"` |
| 备份整个数据库 | `npx wrangler d1 export quiz --remote --output=quiz-backup.sql` |
| 新增表结构变更 | `npx wrangler d1 migrations create quiz 描述`，编辑生成的 SQL 后运行 `npm run cf:deploy` |
| 查看已部署版本 | `npx wrangler deployments list` |
| 回滚到上一版本 | `npx wrangler rollback` |

注意：

- 已经应用到线上的迁移文件不要修改，表结构变更一律新建迁移文件。
- `wrangler rollback` 只回滚代码，不回滚数据库。修改表结构前请先导出备份。
- 备份文件包含用户名和密码哈希，请妥善保管，不要提交到 Git。

## 迁移到自己的服务器

1. 导出线上数据库（在 `cloudflare/` 目录中运行）：

   ```bash
   npx wrangler d1 export quiz --remote --output=quiz-backup.sql
   ```

2. 用 Go 后端导入到新的数据库文件：

   ```bash
   quiz-server import -db ./data/quiz.db quiz-backup.sql
   ```

3. 按 [自部署 Go 后端](self-host.md) 启动服务。账户、密码和题目都会保留，用户需要重新登录一次。

反方向（从自己的服务器迁回 Cloudflare）见自部署文档中的「迁移到 Cloudflare」。

## 常见问题

**部署时报错找不到数据库或 `database_id` 无效**
`cloudflare/wrangler.jsonc` 中的 `database_id` 仍是占位值，或与 `npx wrangler d1 list` 中的不一致。

**网页正常，但注册时提示“服务器暂时无法处理请求”**
通常是线上数据库还没有建表。运行 `npm run db:migrate:remote`，再用 `npx wrangler tail` 查看具体错误。

**右上角没有账户按钮**
网页没有连接到 Worker 的 `/api/*`。确认打开的是 Cloudflare 的网址而不是 GitHub Pages，并检查 `curl …/api/auth/me` 是否返回 JSON。

**运行 Wrangler 命令时提示找不到配置或数据库 `quiz`**
没有在 `cloudflare/` 目录中运行。先 `cd cloudflare`，或在命令中加上 `--config cloudflare/wrangler.jsonc`。

**`wrangler login` 后提示没有权限**
账户下有多个 Cloudflare 账户时，设置 `CLOUDFLARE_ACCOUNT_ID` 指定要使用的账户；使用 API 令牌时，确认令牌包含 Workers 和 D1 的编辑权限。

**自定义域名绑定失败，提示记录已存在**
先在 DNS 设置中删除该子域原有的记录，再重新部署。
