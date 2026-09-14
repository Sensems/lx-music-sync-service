# AGENTS.md

给在本仓库工作的编码代理（Codex 等）的说明。人看的文档在 [`README.md`](README.md)，部署细节在
[`docs/deploy.md`](docs/deploy.md)。

## 项目速览

`lx-music-sync-service`（产品名「听柜」）是一个自托管的歌单同步服务：订阅在线歌单 → 拉曲目快照 →
用用户提供的音源脚本解析 `musicUrl` → 断点续传下载到本地，数据存 SQLite。仓库同时包含 Node/TypeScript
后端、Hono HTTP API、commander CLI，以及 `web/` 下的 Vue 3 前端。UI 文案、注释、文档使用中文。

## 常用命令

```bash
npm install                  # 安装依赖（有 pnpm-lock.yaml，装了 pnpm 时也可 pnpm install）
npm test                     # Vitest，test/ 全部用例；提交前必跑
npm run dev                  # tsx watch src/cli.ts serve，后端开发
npm run build                # 仅类型检查（tsconfig 是 noEmit）
npm --prefix web run dev     # 前端 dev server，5173，/api 代理到 8787
npm --prefix web run build   # 前端类型检查 + 构建到 web/dist
node bin/lx-sync.mjs serve   # 生产启动方式（等价 npm start）
./scripts/deploy.sh          # 服务器一键部署 / 更新（PM2）
```

需要跑单个用例时用 `npx vitest run test/sync.test.ts`。当前基线：12 个测试文件、39 个用例全绿。

## 代码地图

| 位置 | 职责 |
| --- | --- |
| `src/serve.ts` | `createAppContext` 组装全部依赖；`startServe` 起 HTTP + 静态资源 + cron + 优雅退出 |
| `src/http/app.ts` | `AppCtx` 类型与全部 `/api/*` 路由；业务逻辑不要堆在这里 |
| `src/services/*` | 业务层：`playlists` 快照刷新、`sync` 任务队列、`search` 多源合并、`settings`、`lyrics`、`pic` |
| `src/db/*` | `schema.ts` 建表、`index.ts` 打开库 + 迁移 + 回填、`repos.ts` 仓储与默认设置 |
| `src/download/downloader.ts` | Range 续传下载器（`.part` + 末尾 10 字节校验 + 重试） |
| `src/userApi/runtime.ts` | 音源脚本沙箱，LX 与 CeruMusic 双协议；`parseScript.ts` 解析脚本头注释 |
| `src/sdk/*` | `musicSdk/` 是从 lx-music-desktop 抽取的第三方搜索/歌单代码，`load.ts` 做统一包装 |
| `src/lib/*` | 音质选择与文件名生成（`names.ts`）、`MusicInfo` 归一化 |
| `src/cli.ts` | commander 命令，依赖通过 `CliDeps` 注入，便于测试 |
| `bin/lx-sync.mjs` | 生产入口：进程内 `tsx` 的 `register()` 后 import `src/cli.ts` |
| `web/src/*` | Vue 3 前端：`api.ts` 客户端、`router.ts` 五页路由、`themes.ts` 主题 token、`views/`、`components/` |
| `test/*.test.ts` | Vitest 用例，按模块命名 |

## 约定

- **ESM + NodeNext**：所有相对 import 必须带 `.js` 后缀（即使源文件是 `.ts`），例如 `import { openDb } from './db/index.js'`。
- **TypeScript strict**：类型不完整就补类型，不要用 `any` 绕过；`tsconfig.json` 已 `noEmit`，类型检查靠 `npm run build` 和 `npm test` 间接覆盖。
- **依赖注入**：service 与 CLI 都通过参数接收依赖（`SyncDeps` / `AppCtx` / `CliDeps`），新增外部调用时沿用这个模式，方便测试里替换。
- **数据库**：`better-sqlite3` 是同步 API，仓储方法都是同步的；新增表/列要同时改 `schema.ts`，并在 `db/index.ts` 里写幂等迁移（`PRAGMA table_info` 判断后再 `ALTER TABLE`），不要直接改老列。
- **注释与文案**：注释用中文、说清「为什么」；面向用户的文案保持轻音乐感、说人话（见 `docs/superpowers/specs/2026-09-14-copy-and-themes-design.md`）。
- **命名**：`songKey` 统一是 `平台_平台ID`（酷狗为 `songmid_hash`），跨表、跨接口都靠它对齐，不要另造标识。
- **前端数据**：页面数据一律走 `web/src/api.ts`；`web/src/mock/data.ts` 现在只提供类型和平台中文名，不要再往里加假数据。

## 硬性约束（改了会出事）

- **只能单进程**：SQLite 同步单连接 + 单端口，PM2 必须 fork、`instances: 1`；不要引入 cluster、多实例，也不要把生产入口改成 spawn 子进程（会留下占端口的孤儿进程，无法响应 SIGTERM）。
- **不要提交运行期文件**：`config.yaml`、`data/`、`logs/`、`dist/` 都在 `.gitignore` 里；音源脚本、音乐文件、数据库都不进仓库。
- **没有鉴权**：默认 `host: 127.0.0.1` 是刻意的。不要把默认值改成 `0.0.0.0` 或新增无鉴权的对外能力。
- **`src/sdk/musicSdk/` 是拷贝来的第三方代码**：来源与改写范围记在 `src/sdk/COPY.md`。改动前先读它，改动后同步更新该文件；不要顺手重构这一层。
- **用户脚本在 `vm` 沙箱里跑**：加载超时 5 秒、取地址超时 20 秒、`require` 禁用、返回值必须是 `http(s)` 地址。不要为了方便把宿主能力（`fs`、`process`、真实 `require`）暴露进沙箱。
- **同步是增量且不删文件**：曲目已下载且文件存在就跳过下载（只刷新元数据），歌单快照收缩或删除订阅都不删除本地文件。改动同步逻辑时保持这个语义，`test/sync.test.ts`、`test/db.test.ts` 有对应用例。
- **同步任务串行排队**：并发入口通过内部队列排队执行，不要改成并行跑多个任务。

## 测试要求

- 改了行为就补或改用例，测试放在 `test/<模块>.test.ts`，用 Vitest；跑 `npm test` 必须全绿再交付。
- 测 HTTP 用 `createApp(ctx)` 直接打 `app.fetch`（见 `test/http.test.ts`），不要真的监听端口。
- 测同步/下载用假的 `getMusicUrl`、`downloadFile`、`getListDetail` 依赖注入（见 `test/sync.test.ts`、`test/refreshPlaylist.test.ts`），不要访问真实平台。
- 涉及前端改动时，`npm --prefix web run build` 会跑 `vue-tsc`，用它做类型验证。

## 变更流程

- 分支用 `codex/` 前缀，例如 `codex/fix-resume-check`。
- 提交信息沿用现有风格：`feat: …` / `fix: …` / `chore: …`，一行摘要，必要时正文说明动机。
- 提交前确认工作区没有混入 `config.yaml`、`data/`、`web/dist/` 之类的未跟踪产物。
- 不要用破坏性命令（`git reset --hard`、`git checkout --`）处理他人改动。

## CodeGraph

本仓库目前**没有** `.codegraph/` 索引。如果之后在仓库根目录建了索引：

- **MCP 工具**（可用时）：`codegraph_explore` 一次调用就能拿到相关符号的带行号源码与调用链，优先于 grep/逐文件阅读。
- **命令行**（始终可用）：`codegraph explore "<符号名或问题>"` 输出相同内容。

没有 `.codegraph/` 目录时跳过它，直接用搜索和阅读代码即可；是否建索引由用户决定。
