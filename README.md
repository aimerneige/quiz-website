# quiz · 本地答题空间

中、日、英三语答题工具，前端使用原生 HTML、CSS、JavaScript ES modules。可以作为纯静态站点部署（题库保存在浏览器本地），也可以接入后端，支持注册登录并把题库保存到云端。后端有两种实现，接口和数据库结构完全相同，可以任选其一并互相迁移：Cloudflare Workers + D1，或在自己的服务器上运行的 Go 程序（SQLite）。源码维护在 `src/`，构建产物生成到 `dist/`。

## 开发和测试

测试需要 Node.js 22.5 或更高版本（Worker 测试使用内置的 `node:sqlite` 模拟 D1）。前端和测试没有第三方依赖；只有 Cloudflare 本地开发和部署需要先运行 `npm install` 安装 Wrangler。

`npm test` 会对两种后端运行同一套接口测试（`tests/api-contract.mjs`）。已安装 Go 1.26+ 时会自动编译并启动 Go 后端参与测试，否则跳过这一部分；Go 自身的单元测试用 `npm run server:test`（即 `go test ./...`）运行。

```bash
npm test
```

测试直接加载 `src/` 中的模块，无需先构建。

开发时修改 `src/` 中的文件，在项目根目录启动预览：

```bash
npm run dev
```

开发服务器由操作系统自动分配空闲端口，在浏览器打开终端打印的地址即可。服务器直接读取 `src/`，无需先构建；修改文件后刷新浏览器即可。页面使用 ES modules，请通过 HTTP(S) 打开，不要直接双击 `index.html`。

本地题库按站点源（包含端口）保存。重新启动后端口可能变化，如需继续使用原题库，请先导出备份，再在新地址导入。

## 构建和手动部署

```bash
npm run build
```

构建会先清空 `dist/`，再依次将 `src/` 和 `public/` 中的全部文件复制到 `dist/`。`public/CNAME` 会复制到 `dist/CNAME`，用于 GitHub Pages 自定义域名；修改域名时请编辑 `public/CNAME`。现有代码可直接由浏览器执行，因此无需转译或打包依赖。`dist/` 已被 Git 忽略，可以随时删除后重新构建；不要直接在其中修改代码。

将 `dist/` 内的全部文件上传到静态服务器的网站目录，保持文件之间的相对路径即可。部署时不需要上传 `src/`、`scripts/`、`tests/` 或 `package.json`。

如需本地预览构建产物：

```bash
python3 -m http.server 8000 --directory dist
```

## 部署后端（账户与云端题库）

| 方式 | 适合 | 文档 |
| --- | --- | --- |
| Cloudflare Workers + D1 | 不想维护服务器；免费套餐通常足够 | [docs/cloudflare.md](docs/cloudflare.md) |
| 自己的服务器（Go + SQLite） | 已有服务器、内网使用、数据需要留在自己手里 | [docs/self-host.md](docs/self-host.md) |

两种后端都同时提供网页和 `/api/*`，前端无需任何配置：能访问到 `/api` 时右上角出现账户按钮，否则保持本地模式。

**Cloudflare**（详细步骤见文档）：

```bash
npm install
npx wrangler login
cd cloudflare && npx wrangler d1 create quiz && cd ..
# 把输出的 database_id 填入 cloudflare/wrangler.jsonc
npm run cf:deploy
```

本地调试：`npm run db:migrate:local && npm run cf:dev`，打开 `http://localhost:8787`。

**自己的服务器**（详细步骤见文档）：

```bash
docker compose up -d            # 打开 http://服务器地址:8080
# 或不用 Docker：
npm run server:build && ./bin/quiz-server -addr :8080 -db ./data/quiz.db
```

本地调试：`npm run server`，打开 `http://localhost:8080`。

**互相迁移**：`wrangler d1 export` 导出的备份可以用 `quiz-server import` 导入；`quiz-server export` 导出的数据可以用 `wrangler d1 execute --file` 写入 D1。账户密码和题目都会保留。

### 账户与同步行为

- 右上角的账户按钮仅在后端可用时出现；用 `npm run dev` 或 GitHub Pages 等纯静态方式部署时自动隐藏，网站保持原来的本地模式。
- 未登录时题库保存在浏览器本地，与以前相同。登录后显示并编辑账户中的云端题库，本地题库保留在浏览器中，退出登录后恢复显示。
- 首次登录且账户题库为空时，会询问是否把本地自己添加的题目（不含示例题）上传到账户。
- 每次修改只上传新增、修改和删除的题目；右上角显示“正在同步 / 已同步 / 同步失败”。同步失败可点击重试；有未同步的修改时关闭页面或退出登录会提示。切回页面时会拉取其他设备上的修改。
- 用户名为 3–32 位字母、数字、`_`、`.` 或 `-`，不区分大小写；密码 8–128 位，使用 PBKDF2-SHA256（10 万次迭代，独立盐值）存储。
- 登录状态保存在 30 天有效的 HttpOnly、SameSite=Lax Cookie 中（HTTPS 下带 Secure），数据库只保存其 SHA-256 哈希。写请求校验 `Origin` 并要求 JSON 请求体。
- 两种后端的密码哈希、Cookie、校验规则和错误码完全一致，由同一套接口测试保证。
- 每个账户最多 10,000 道题，单题长度限制与本地相同。

### API

| 方法与路径 | 说明 |
| --- | --- |
| `GET /api/auth/me` | 当前登录用户，未登录返回 `{"user": null}` |
| `POST /api/auth/register` | `{username, password}`，注册并登录 |
| `POST /api/auth/login` | `{username, password}` |
| `POST /api/auth/logout` | 退出登录 |
| `GET /api/questions` | 当前用户的全部题目（按 `sort` 排序） |
| `POST /api/questions/sync` | `{upsert: [...], remove: [ids], replace?: boolean}`，在一个事务中增量保存 |

## 迁移你的题库

浏览器中添加的题目保存在原网址的本地存储，不在源码包中。迁移到新域名前：

1. 在原网站的“我的题库”中导出 JSON 备份。
2. 打开新网站，在“我的题库”中导入该文件。
3. 确认题目完整后，再决定是否移除新站首次载入的示例题。导入时选择“替换整个题库”可直接使用自己的题库。

每位访问者的题库保存在其自己的浏览器中，不会随源码上传，也不会与其他访问者自动共享。源包仅含内置示例题。

## 文件说明

| 路径 | 用途 |
| --- | --- |
| `src/index.html` | 页面入口 |
| `src/styles.css` | Material Design 3 风格与明暗主题 |
| `src/app.js` | 页面交互、本地保存、题库管理 |
| `src/i18n.js` | 中日英词典、语言识别及参数插值 |
| `src/core.js` | 导入导出、CSV 处理、标签筛选和随机抽题 |
| `src/data.js` | 首次访问时的示例题 |
| `src/icon.svg` | 网站图标 |
| `public/CNAME` | GitHub Pages 自定义域名，构建时复制到部署目录根目录 |
| `scripts/dev.mjs` | 直接预览 `src/` 的本地开发服务器 |
| `scripts/build.mjs` | 清理并生成 `dist/` 的构建脚本 |
| `tests/core.test.mjs` | 核心逻辑测试 |
| `tests/i18n.test.mjs` | 语言识别、词典完整性、插值和多语言导入校验测试 |
| `migrations/` | 数据库表结构迁移，Cloudflare D1 与 Go 后端共用 |
| `cloudflare/worker.js` | Cloudflare Worker：注册登录、会话和题库同步 API，并提供静态文件 |
| `cloudflare/wrangler.jsonc` | Cloudflare Workers / D1 配置 |
| `server/` | Go 自部署后端：接口（`server.go`、`auth.go`、`questions.go`）、SQLite 与迁移（`store.go`）、导入导出（`dump.go`） |
| `server/cmd/quiz-server/` | Go 后端的命令行入口 |
| `embed.go`、`go.mod` | Go 模块根；把 `src/` 和 `migrations/` 嵌入可执行文件 |
| `Dockerfile`、`compose.yaml` | 自部署的 Docker 镜像与 Compose 配置 |
| `docs/cloudflare.md` | 连接并部署到 Cloudflare 的详细说明 |
| `docs/self-host.md` | 在自己的服务器上部署 Go 后端的详细说明 |
| `tests/sync.test.mjs` | 云端排序键与增量同步计算测试 |
| `tests/api-contract.mjs` | 两种后端共用的接口测试 |
| `tests/worker.test.mjs` | 用接口测试检查 Worker（`tests/d1-mock.mjs` 模拟 D1） |
| `tests/go-server.test.mjs` | 编译并启动 Go 后端，用同一套接口测试检查 |
| `dist/` | 可删除、可重新生成的部署产物，不提交到 Git |

## 功能

- 手动添加、编辑、删除题目，每题支持提示、参考答案及多个标签；删除后可即时撤销。
- 标签按任一 / 全部匹配，随机抽题，每轮不重复，可返回上一题。
- 左侧主导航和抽题筛选可分别收起、展开，操作不会重置当前题目、筛选条件或提示与答案的展开状态。
- 提示与答案独立展开，支持空格查看答案、H 查看提示、左右方向键切换题目。
- 本地题库搜索和分页，JSON / UTF-8 CSV 导入预览、追加 / 替换、去重和错误报告。
- JSON / CSV 全量导出及格式模板下载；CSV 支持引号、逗号、换行及标签数组。
- 基于 Material Design 3 的色彩角色、层级表面、圆角卡片、标签、分段按钮和模态对话框；亮色、暗色、跟随系统。
- 响应式侧边导航 / 手机底部导航，键盘操作、可见焦点、对话框焦点管理及减弱动画支持。

## 界面语言

右上角语言选择器仅提供中文（`zh-CN`）、日本語（`ja`）和 English（`en`）。首次打开按浏览器语言偏好选择支持的语言，均不匹配时使用中文；手动选择后优先使用本地保存的偏好。语言偏好保存在 `localStorage` 的 `zhijian-language` 键中；存储不可用时仍可切换，但刷新后不会保留选择。

切换语言即时更新导航、页面、弹窗、操作提示、校验错误、无障碍标签、页面标题及描述，不重置当前题目、练习进度、筛选、搜索或答案展开状态。题目、提示、答案、标签和内置示例题属于题库内容，不会自动翻译或改写；下载的导入模板示例使用当前界面语言。JSON / CSV 字段名和既有数据格式保持兼容，CSV 表头仍使用英文或已有的中文别名。

翻译集中维护在 `src/i18n.js`：中文原文作为键，每项依次提供英文和日文译文，动态参数使用 `{count}` 等占位符，通过 `tr(key, values)` 插值。新增文案时补全三语并保持占位符一致；缺失译文回退到中文原文。

## 数据

题库使用当前站点源的 `localStorage`，键为 `zhijian-bank-v1`。主题键为 `zhijian-theme`。首次访问载入 12 道示例题。清空浏览器存储、更换设备、浏览器或站点域名后，需重新导入备份。多个标签页通过 `storage` 事件同步题库变更。

JSON 支持数组或 `{ "questions": [...] }`。每条记录的 `question` 必填，`hint`、`answer` 和 `tags` 选填，可先添加问题再编辑补充；CSV 仅需题目列；CSV 也支持中文表头“题目、提示、答案、标签”。题目与答案完全相同的导入记录自动去重。

## 验证

运行 `npm test` 检查后端注册登录与题库同步、导入导出、CSV 转义、去重、标签匹配、随机轮次，以及三语识别、翻译完整性、参数插值和多语言校验。静态站点请经 HTTP(S) 打开，ES modules 不支持直接使用 `file://` 打开。
