# AGENTS.md

给在本仓库工作的编码代理（Codex 等）的说明。人看的文档在 [`README.md`](README.md)，部署细节在
[`docs/deploy.md`](docs/deploy.md)。

## 项目速览

`lx-music-sync-service`（产品名「听柜」）是一个自托管的单用户曲库：歌手 / 专辑 / 歌曲存在
**一份 Postgres** 里，三条入库路径（订阅在线歌单、搜索点歌、扫描本地目录）写入同一套表。
对外提供 Subsonic（`/rest`），对内是 Hono 管理接口；播放走 `src/library/openSong.ts`
（本地文件优先，否则按音源顺序向脚本要地址）。仓库同时包含 Node/TypeScript 后端、commander CLI，
以及 `web/` 下的 Vue 3 前端。UI 文案、注释、文档使用中文。

## 常用命令

```bash
npm install                  # 安装依赖（有 pnpm-lock.yaml，装了 pnpm 时也可 pnpm install）
npm test                     # Vitest，现有 test/ 用例；不要为新改动补测
npm run dev                  # tsx watch src/cli.ts serve，后端开发
npm run build                # 仅类型检查（tsconfig 是 noEmit）
npm --prefix web run dev     # 前端 dev server，5173，/api 代理到 8787
npm --prefix web run build   # 前端类型检查 + 构建到 web/dist
node bin/lx-sync.mjs serve   # 生产启动方式（等价 npm start）
./scripts/deploy.sh          # 服务器一键部署 / 更新（PM2）
```

需要跑单个现有用例时用 `npx vitest run test/cron.test.ts` 这类命令；不要去扩 `test/sync.test.ts`
或 `test/db.test.ts`。

## 代码地图

| 位置 | 职责 |
| --- | --- |
| `src/serve.ts` | `createAppContext` 组装全部依赖；`startServe` 起 HTTP + 静态资源 + cron + 优雅退出 |
| `src/http/app.ts` | `AppCtx` 与音源脚本 / 歌词等少量 `/api/*`；业务逻辑不要堆在这里 |
| `src/http/manage.ts` | 管理路由：订阅、搜索入库、扫描根、缓存、任务、设置 |
| `src/library/subscribe.ts` | 订阅刮削与 `playlist_items` 整表替换 |
| `src/library/scan.ts` | 按 `library_roots` 扫目录 |
| `src/library/openSong.ts` | 播放：本地文件或按音源顺序取地址 |
| `src/library/upsert.ts` / `normalize.ts` | 三条入口共用的入库 |
| `src/subsonic/` | `/rest`：鉴权、浏览、播放、歌单、收藏、scrobble |
| `src/jobs/queue.ts` | 进程内串行任务队列（刷新 / 扫描 / 缓存） |
| `src/db/pg.ts` + `src/db/sql/` | 打开 Postgres、按文件名跑 SQL 迁移 |
| `src/services/playlists.ts` | 仍提供 `GetListDetail`（在线歌单分页刮削） |
| `src/services/search.ts` | 多源合并搜索 |
| `src/userApi/runtime.ts` | 音源脚本沙箱，LX 与 CeruMusic 双协议；`parseScript.ts` 解析脚本头注释 |
| `src/sdk/*` | `musicSdk/` 是从 lx-music-desktop 抽取的第三方搜索/歌单代码，`load.ts` 做统一包装 |
| `src/lib/*` | 音质选择、`MusicInfo` 归一化、cron 表达式 |
| `src/cli.ts` | commander 命令；`search` / `serve` 可用 |
| `bin/lx-sync.mjs` | 生产入口：进程内 `tsx` 的 `register()` 后 import `src/cli.ts` |
| `web/src/*` | Vue 3 前端：`api.ts` 客户端、`router.ts` 五页路由、`themes.ts` 主题 token、`views/`、`components/` |
| `test/*.test.ts` | 仓库里已有的 Vitest 用例；不要新增或扩写 |

## 约定

- **ESM + NodeNext**：所有相对 import 必须带 `.js` 后缀（即使源文件是 `.ts`），例如 `import { openPool } from './db/pg.js'`。
- **TypeScript strict**：类型不完整就补类型，不要用 `any` 绕过；`tsconfig.json` 已 `noEmit`，类型检查靠 `npm run build` 和 `npm test` 间接覆盖。
- **依赖注入**：service 与 CLI 都通过参数接收依赖（`AppCtx` / `ManageDeps` / `CliDeps`），新增外部调用时沿用这个模式，方便测试里替换。
- **数据库**：曲库在 Postgres。新表/列写 `src/db/sql/` 下新的迁移文件，由 `src/db/pg.ts` 按文件名顺序执行。
- **注释与文案**：注释用中文、说清「为什么」；面向用户的文案保持轻音乐感、说人话（见 `docs/superpowers/specs/2026-09-14-copy-and-themes-design.md`）。
- **歌曲身份**：`song_sources` 用 **平台 + 平台歌曲 id** 对齐（酷狗为 `songmid_hash`）。不要另造 `songKey` 当主键。
- **Subsonic 目录 id**：歌手 `ar-<id>`，专辑 `al-<id>`；歌曲 id 是 bigint 的十进制文本，不要加前缀。
- **前端数据**：页面数据一律走 `web/src/api.ts`；`web/src/mock/data.ts` 现在只提供类型和平台中文名，不要再往里加假数据。

## 硬性约束（改了会出事）

- **只能单进程**：后台任务是进程内队列，服务只听一个端口。PM2 必须 fork、`instances: 1`；不要引入 cluster、多实例，也不要把生产入口改成 spawn 子进程（会留下占端口的孤儿进程，无法响应 SIGTERM）。
- **不要提交运行期文件**：`config.yaml`、`data/`、`logs/`、`dist/` 都在 `.gitignore` 里；音源脚本、音乐文件、口令都不进仓库。
- **管理接口没有鉴权**：默认 `host: 127.0.0.1` 是刻意的。不要把默认值改成 `0.0.0.0`，也不要给管理 API 加「看起来像登录、其实挡不住」的半吊子鉴权。
- **`src/sdk/musicSdk/` 是拷贝来的第三方代码**：来源与改写范围记在 `src/sdk/COPY.md`。改动前先读它，改动后同步更新该文件；不要顺手重构这一层。
- **用户脚本在 `vm` 沙箱里跑**：加载超时 5 秒、取地址超时 20 秒、`require` 禁用、返回值必须是 `http(s)` 地址。不要为了方便把宿主能力（`fs`、`process`、真实 `require`）暴露进沙箱。

## 测试要求

- **不要写单元测试**：改行为、修 bug、加功能时不要新增或扩写 `test/*.test.ts`，也不要为了 TDD 先写失败用例。用户明确要求补测时才写。
- 仓库里已有的 Vitest 用例可以保留；不要为了配合新代码去大改测试，除非现有测试挡住了交付且用户同意改。
- 涉及前端改动时，用 `npm --prefix web run build`（含 `vue-tsc`）做类型验证即可。
- **验收由人来做**：改完后不要自己开浏览器点页面、截图对照、走一遍交互。类型检查过了就停，把改了什么说清楚即可。

## 变更流程

- **直接在 `main` 上改**：之后改代码、修 bug、加功能都在 `main` 检出里做，**不要**再建 git worktree、也不要为隔离工作区切新分支。用户明确要求开分支或 PR 时除外。
- 提交信息沿用现有风格：`feat: …` / `fix: …` / `chore: …`，一行摘要，必要时正文说明动机。
- 提交前确认工作区没有混入 `config.yaml`、`data/`、`web/dist/` 之类的未跟踪产物。
- 不要用破坏性命令（`git reset --hard`、`git checkout --`）处理他人改动。

## CodeGraph

本仓库目前**没有** `.codegraph/` 索引。如果之后在仓库根目录建了索引：

- **MCP 工具**（可用时）：`codegraph_explore` 一次调用就能拿到相关符号的带行号源码与调用链，优先于 grep/逐文件阅读。
- **命令行**（始终可用）：`codegraph explore "<符号名或问题>"` 输出相同内容。

没有 `.codegraph/` 目录时跳过它，直接用搜索和阅读代码即可；是否建索引由用户决定。
