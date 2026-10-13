# 听柜 · lx-music-sync-service

自托管的单用户曲库。歌手、专辑、歌曲存在一份 Postgres 里，三条入口写入同一套表：订阅在线歌单、
搜索点歌、扫描本地目录。对外提供 Subsonic（`/rest`），对内是没有登录的管理接口；播放优先用本地文件，
没有文件时按音源顺序向 **LX 音源脚本** 要地址。Vue 3 网页和 CLI 仍在，镜像一次构建、单进程跑在 PM2 里。

> 本项目不提供任何音乐内容，也不内置任何音源脚本。

## 致谢

这个项目的一大半能力，建立在 [lx-music-desktop](https://github.com/lyswhut/lx-music-desktop)
之上：`src/sdk/musicSdk/` 下各平台的搜索与歌单详情代码（含酷狗的 infSign 等）是从该项目抽取并改写的；
`src/userApi/` 的音源脚本协议也刻意与它保持一致——`lx.on('request', …)` / `lx.send('inited', …)` 的事件约定、
`lx.utils` 工具集、脚本头部 `@name` / `@version` 注释格式，都对齐桌面端，所以社区里现成的 LX 音源脚本
可以直接拿来在本服务里跑。感谢作者 [lyswhut](https://github.com/lyswhut) 和所有贡献者的长期维护，
没有这样一个高质量的开源项目，「把歌单归档到本地」这件事不会这么快做成。

顺便说一句：LX Music 本身是功能完整的桌面播放器，本服务只借了它的音源与解析能力、专做同步下载。
如果你要的是一个能听歌的播放器，请直接用原项目：
[https://github.com/lyswhut/lx-music-desktop](https://github.com/lyswhut/lx-music-desktop)。

## 目录

- [致谢](#致谢)
- [特性](#特性)
- [它是怎么工作的](#它是怎么工作的)
- [技术栈](#技术栈)
- [目录结构](#目录结构)
- [快速开始](#快速开始)
- [配置文件](#配置文件)
- [音源脚本](#音源脚本)
- [CLI 用法](#cli-用法)
- [HTTP API](#http-api)
- [设置项](#设置项)
- [数据、文件名与音质](#数据文件名与音质)
- [部署到服务器](#部署到服务器)
- [开发与测试](#开发与测试)
- [故障排查](#故障排查)
- [已知限制](#已知限制)

## 特性

- **一份曲库**：歌手 / 专辑 / 歌曲在 Postgres，订阅、搜索点歌、目录扫描走同一套入库。
- **删订阅不删歌**：去掉订阅或歌单变短，只动这份歌单的成员，歌曲行和缓存文件都留着。
- **Subsonic**：同一进程的 `/rest`，浏览、播放、封面、歌词、用户歌单、收藏、scrobble。
- **音源脚本沙箱**：用户脚本跑在 Node `vm` 里，同时兼容 LX Music 的 `lx.on/lx.send` 脚本和 CeruMusic（澜音）的 `module.exports` 插件。
- **多平台搜索**：`source=all` 时并发搜索全部平台，按 `id` 去重合并，单个平台报错不影响整体结果。
- **定时刷新**：内置 cron（每 6 小时 / 每天固定时刻 / 自定义 cron 表达式），默认关闭；可选顺带扫目录。
- **播放与缓存**：有本地文件就按文件送；没有文件就按音源顺序取地址。缓存是单独动作，不在定时里跑。
- **Web 界面**：歌单 / 唱片墙（已下载）/ 搜索 / 任务 / 设置五个页面，12 套主题（默认 `nightwood` 夜木），偏好存在 `localStorage`。

## 它是怎么工作的

```
  浏览器 / Subsonic 客户端 / curl
      │
      ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  Hono                                                       │
  │  /api/* 管理接口（src/http/manage.ts、src/http/app.ts）        │
  │  /rest  Subsonic（src/subsonic/）                            │
  └───────┬───────────────────┬───────────────────┬─────────────┘
          │                   │                   │
   订阅 / 搜索入库 / 扫描      │            播放 / 缓存
          ▼                   ▼                   ▼
   musicSdk 刮削         进程内任务队列         openSong
   + upsertTrack        （同一时间只跑一个）    本地文件或音源地址
          │                                       │
          └──────────────┬────────────────────────┘
                         ▼
              Postgres（artists / albums / songs）
              data/cache + data/user-api
```

三条入库都进同一套表，订阅和搜索不自动下载音频：

1. **订阅**：按页刮完整份在线歌单，成功后整表替换该订阅的 `playlist_items`，并拨 `updated_at`。中途失败不改旧成员。
2. **搜索点歌**：`GET /api/search` 仍走多源合并；选中的一首 `POST /api/library/tracks` 当场入库，不进队列。
3. **扫描目录**：`library_roots` 里的路径逐个走音频文件。对不上就新建只有文件的歌；文件不见了只标缺失，不删歌曲行。

播放（`src/library/openSong.ts`，Subsonic 的 `stream` / `download` 共用）：有未缺失的本地文件就按原样送；否则按设置里的音源顺序逐条身份取地址，一条平台两次都废了再试下一档。没有文件也没有可用身份则 404。

后台任务（刷新订阅、扫描、缓存）在进程内**串行排队**。点播取地址不进这条队列。进度看 `GET /api/jobs/:id`。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 运行时 | Node.js 20+（开发机为 22），ESM，TypeScript `strict` |
| HTTP | [Hono](https://hono.dev) + `@hono/node-server` |
| 存储 | Postgres（`pg`，迁移在 `src/db/sql/`） |
| 调度 | `node-cron` |
| 下载 / 网络 | 原生 `http`/`https` 流式下载、`needle` + `tunnel`（代理） |
| CLI | `commander` |
| 配置 | YAML（`yaml`） |
| 测试 | Vitest |
| 前端 | Vue 3 + Vue Router + Ant Design Vue + UnoCSS + Vite |

`src/sdk/musicSdk/` 是从 lx-music-desktop 抽取的搜索 / 歌单详情代码，改动前请看 [`src/sdk/COPY.md`](src/sdk/COPY.md)。

## 目录结构

```
.
├── src/
│   ├── cli.ts                # CLI：search / serve 可用；playlist / sync / download 抛 not available
│   ├── serve.ts              # 组装依赖、启动 HTTP + 静态资源 + cron、优雅退出
│   ├── config.ts             # config.yaml / 环境变量，含 databaseUrl
│   ├── http/
│   │   ├── app.ts            # 音源脚本 / 歌词等少量 /api
│   │   └── manage.ts         # 订阅、入库、扫描、缓存、任务、设置
│   ├── library/              # 入库、订阅刷新、扫描、缓存、openSong 播放
│   ├── subsonic/             # /rest 鉴权与浏览 / 播放 / 歌单
│   ├── jobs/queue.ts         # 进程内串行任务队列
│   ├── db/
│   │   ├── pg.ts             # 打开 Postgres、按 src/db/sql/ 跑迁移
│   │   └── sql/              # 曲库表结构
│   ├── services/
│   │   ├── playlists.ts      # GetListDetail：在线歌单分页刮削
│   │   ├── search.ts         # 单平台 / 全平台合并搜索
│   │   ├── lyrics.ts         # 歌词（含翻译）
│   │   └── pic.ts            # 封面获取
│   ├── userApi/              # 音源脚本沙箱（LX + CeruMusic）
│   ├── sdk/                  # musicSdk 包装与各平台刮削
│   └── lib/                  # 音质、MusicInfo 归一化、cron 表达式
├── web/                      # 「听柜」前端（Vue 3 + Vite）
│   ├── src/api.ts            # 后端 API 客户端
│   ├── src/router.ts         # /shelf /wall /search /tape /cabinet /now
│   ├── src/themes.ts         # 12 套主题 token
│   └── src/views/            # 五个页面
├── test/                     # 已有 Vitest 用例；不要为新改动补测
├── bin/lx-sync.mjs           # 生产入口：进程内注册 tsx，直接跑 TS
├── scripts/deploy.sh         # 一键部署 / 更新（PM2）
├── ecosystem.config.cjs      # PM2 配置（fork 单实例）
├── config.example.yaml       # 配置模板，复制成 config.yaml 后改
├── docs/deploy.md            # 部署与运维细节
└── data/                     # 运行期数据（不入库）：缓存、音源脚本、口令密钥
```

## 快速开始

### 环境要求

- Node.js **20+**（建议 22，与生产一致）
- 单独安装的 **Postgres**，并在 `config.yaml` 里写上 `databaseUrl`
- 一个可用的**音源脚本**（仓库不含，见[音源脚本](#音源脚本)）

### 安装与启动

```bash
npm install

# 1) 生成配置，并补上 databaseUrl
cp config.example.yaml config.yaml      # Windows: copy config.example.yaml config.yaml

# 2) 放音源脚本（必须，否则搜索和下载都拿不到地址）
mkdir -p data/user-api
cp /path/to/current.js data/user-api/current.js

# 3) 构建前端（serve 只从 web/dist 托管静态资源）
npm --prefix web install
npm --prefix web run build

# 4) 启动
npm start            # 等价于 node bin/lx-sync.mjs serve
```

默认监听 `http://127.0.0.1:8787`，浏览器打开就是「听柜」界面，`/api/settings` 可用作健康检查。

### 开发模式

```bash
# 后端：tsx watch，改代码自动重启
npm run dev

# 前端：Vite dev server，/api 已代理到 127.0.0.1:8787
npm --prefix web run dev        # http://localhost:5173
```

`npm run build` 只做类型检查（`tsc` 配了 `noEmit: true`）——生产入口
[`bin/lx-sync.mjs`](bin/lx-sync.mjs) 在进程内注册 `tsx`，直接执行 TypeScript，不需要编译产物。

## 配置文件

启动时按环境变量 `TINGGUI_CONFIG` → 当前工作目录下的 `config.yaml` 的顺序查找，都找不到就用内置默认值。
`config.yaml` 已被 `.gitignore` 忽略。

```yaml
host: 127.0.0.1   # 默认只有本机能访问；改成 0.0.0.0 即对外暴露（管理接口没有登录鉴权！）
port: 8787
dataDir: ./data   # 缓存、音源脚本、口令密钥；相对路径按启动时的工作目录解析
logLevel: info    # debug | info | warn | error
# databaseUrl: postgresql://USER:PASSWORD@HOST:5432/tinggui
```

### 环境变量

| 变量 | 作用 |
| --- | --- |
| `TINGGUI_CONFIG` | 指定配置文件路径，优先于 `./config.yaml` |
| `LX_SDK_PROXY_HOST` / `LX_SDK_PROXY_PORT` | 未在设置里配代理时的兜底代理 |
| `HTTP_PROXY_HOST` / `HTTP_PROXY_PORT` | 同上，优先级更低 |

> `dataDir` 是相对路径时按**启动时的工作目录**解析，所以请在仓库根目录启动服务
> （`bin/lx-sync.mjs` 和 `ecosystem.config.cjs` 都已经处理了 `chdir`）。

## 音源脚本

服务**不自带**音源脚本：`data/` 被 git 忽略，脚本也不会随仓库分发。没有脚本时
`GET /api/source/status` 返回 `ok: false`，搜索能出结果但点播和缓存拿不到播放地址。

脚本可以放在 `data/user-api/current.js`，也可以通过接口上传或从 URL 导入：

```bash
# 上传本地文件（Web「设置」页也能传）
curl -F file=@current.js http://127.0.0.1:8787/api/settings/user-api

# 从 URL 导入
curl -X POST http://127.0.0.1:8787/api/settings/user-api/url \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com/current.js"}'
```

运行时同时兼容两类脚本：

| 类型 | 识别特征 | 约定 |
| --- | --- | --- |
| LX Music 脚本 | 使用 `lx.on('request', …)` / `lx.send('inited', …)` | 从 `inited` 读平台与音质，`request` 事件里返回 `musicUrl` |
| CeruMusic（澜音）插件 | 使用 `cerumusic` + `module.exports` | 导出 `pluginInfo` / `sources` / `musicUrl()` |

脚本跑在 `vm` 沙箱里：只有 `lx`/`cerumusic`、`console` 等白名单能力，`require` 被禁用，加载超时 5 秒，
取地址超时 20 秒，返回的必须是 `http(s)` 地址。执行期脚本还可以调用 `stopRequests()` 让服务在指定秒数内停止取地址。

## CLI 用法

生产入口是 `node bin/lx-sync.mjs <命令>`；开发时直接用 `npx tsx src/cli.ts <命令>`（`npm run dev` 固定跑 `serve`）。

| 命令 | 说明 |
| --- | --- |
| `lx-sync search --source <source\|all> --q <text>` | 搜索曲目，输出 JSON |
| `lx-sync serve` | 启动 HTTP 服务（管理接口、Subsonic、静态资源、定时任务） |
| `lx-sync playlist …` | 命令还在，默认实现抛 `not available` |
| `lx-sync sync` | 同上，抛 `not available` |
| `lx-sync download …` | 同上，抛 `not available` |

订阅、入库、扫描、缓存请走 HTTP 管理接口或 Subsonic，不要用 CLI 的 playlist / sync / download。

```bash
node bin/lx-sync.mjs search --source all --q '起风了'
node bin/lx-sync.mjs serve
```

命令失败时进程以非零码退出，错误写到 stderr。

## HTTP API

管理接口在 `/api` 下，请求与响应均为 JSON（上传音源脚本用 multipart，删除接口返回 `204` 无内容）。
**没有登录鉴权**，默认只监听回环地址。Subsonic 在同一端口的 `/rest/*.view`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/subscriptions` | 新增订阅：`{ platform, sourceUrl }` |
| `GET` | `/api/subscriptions` | 订阅列表 |
| `POST` | `/api/subscriptions/:id/refresh` | 排队刷新该订阅，返回 `{ jobId }` |
| `DELETE` | `/api/subscriptions/:id` | 删除订阅，返回 `204`（不删歌曲和缓存） |
| `GET` | `/api/search` | 搜索：`?q=&source=kw\|kg\|tx\|wy\|mg\|all&page=`（默认 `all`、`1`） |
| `POST` | `/api/library/tracks` | 搜索点歌入库：一篇 `MusicInfo` |
| `POST` | `/api/library/roots` | 添加扫描根：`{ path }` |
| `DELETE` | `/api/library/roots/:id` | 去掉扫描根，不删已入库的歌 |
| `POST` | `/api/library/scan` | 排队扫描全部根目录 |
| `POST` | `/api/cache/songs/:id` | 排队缓存一首歌 |
| `POST` | `/api/cache/playlists/:id` | 排队缓存一份歌单 |
| `POST` | `/api/cache/songs/:id/recache` | 按当前音质重新缓存并替换文件 |
| `GET` | `/api/jobs/:id` | 一条任务的状态 / 结果 / 错误摘要 |
| `GET` | `/api/source/status` | 音源脚本状态 |
| `POST` | `/api/lyrics` | 按 `musicInfo` 或 `songKey` 取歌词 |
| `GET` | `/api/settings` | 设置项 + 音源状态（不回传口令） |
| `PUT` | `/api/settings` | 保存设置，仅接受[白名单字段](#设置项) |
| `POST` | `/api/settings/user-api` | 上传音源脚本，`multipart/form-data`，字段名 `file` |
| `POST` | `/api/settings/user-api/url` | 从 `http(s)` URL 导入音源脚本：`{ url }` |

没有 `/api/playlists`、`/api/sync`、`/api/downloads`。浏览曲库和改用户歌单走 Subsonic。
找不到资源返回 `404 { error: 'not found' }`；参数不对返回 `400`。非法 cron 或未知 `schedule` 的
`PUT /api/settings` 返回 `400 { "error": "invalid cron" }`，什么都不写。
静态资源由同一个端口托管：命中 `web/dist` 里的文件就直接返回，其余路径回落到 `web/dist/index.html`。

## 设置项

`PUT /api/settings` 只写入下面这些键，其余字段忽略。`schedule` 只能是 `every-6h` / `daily` / `cron`；
自定义 cron 会先和当前快照合并，再校验**真正会拿去调度**的表达式。

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `quality` | `128k` | 期望音质；脚本不支持时沿 `flac24bit → flac → 320k → 192k → 128k` 往下退 |
| `sourceOrder` | `kw,kg,tx,wy,mg` | 五个平台各出现一次，播放和缓存按这个顺序试身份 |
| `scheduleOn` | `0` | `1` 打开定时（刷新订阅；`scanWithSchedule=1` 时再扫目录） |
| `schedule` | `every-6h` | `every-6h` / `daily` / `cron` |
| `scheduleTime` | `03:00` | `daily` 时的执行时刻（`HH:mm`，非法值回落到 03:00） |
| `cron` | 空 | 只在 `schedule=cron` 时使用；能通过 `node-cron` 校验的自定义表达式可以保存 |
| `scanWithSchedule` | `0` | `1` 时定时一并扫描目录；定时里不缓存 |
| `subsonicUser` | `tinggui` | Subsonic 用户名 |
| `subsonicPassword` | （不回传） | 写入后只存摘要；响应里不会带出口令 |

```bash
curl -X PUT http://127.0.0.1:8787/api/settings \
  -H 'Content-Type: application/json' \
  -d '{"quality":"flac","sourceOrder":"kw,kg,tx,wy,mg","scheduleOn":"1","schedule":"daily","scheduleTime":"04:30"}'
```

## 数据、文件名与音质

曲库在 Postgres。运行期文件仍在 `dataDir`（默认 `./data`）：

| 路径 | 内容 |
| --- | --- |
| Postgres | 歌手、专辑、歌曲、歌单、任务、设置；表结构在 `src/db/sql/` |
| `data/cache/` | 按歌曲缓存的音频，`media_files` 指向这些路径 |
| `data/user-api/current.js` | 当前音源脚本 |
| `data/subsonic.key` | 还原 Subsonic 口令的密钥 |

歌曲身份是 **平台 + 平台歌曲 id**（酷狗为 `songmid_hash`）。Subsonic 目录 id 是歌手 `ar-<id>`、专辑 `al-<id>`，歌曲 id 是 bigint 的十进制文本。

`data/lx-sync.db` 是旧版 SQLite，新曲库不会读它。备份要同时带上 Postgres 和整个 `data/`。

## 部署到服务器

一键脚本（Linux / WSL / Git Bash，需已装 Node 20+ 与 `pm2`）：

```bash
git clone <repo> lx-music-sync-service
cd lx-music-sync-service
npm i -g pm2
./scripts/deploy.sh
```

脚本依次：`git pull --ff-only` → 装依赖（有 `pnpm-lock.yaml` 和 pnpm 就用 pnpm，否则 `npm ci`）→
`npm --prefix web run build` → 缺 `config.yaml` 就从模板生成 → 建 `data/user-api`、`logs` →
`pm2 startOrReload ecosystem.config.cjs` + `pm2 save` → 打一次健康检查。更新时重跑同一条命令即可。

可用参数与环境变量：

| 参数 / 变量 | 作用 |
| --- | --- |
| `--no-pull` / `--skip-install` / `--skip-build` | 跳过对应步骤 |
| `HOST=0.0.0.0` / `PORT=9000` | 覆盖 `config.yaml` 的监听地址 / 端口 |
| `USER_API_SCRIPT=/tmp/current.js` | 复制成 `data/user-api/current.js` |

PM2 配置固定 **fork 模式、`instances: 1`**：后台任务在进程内排队，服务也只听一个端口，
不要改成 cluster 或多实例。前端由服务自身托管，nginx 反代到本机端口即可，`proxy_read_timeout` 建议放大
（扫描和缓存耗时长）。备份要同时带上 Postgres 和整个 `data/`。

完整的部署、nginx、开机自启与排错见 [`docs/deploy.md`](docs/deploy.md)。

## 开发与测试

```bash
npm test                     # Vitest，test/ 下全部用例
npm run build                # 类型检查（tsc --noEmit）
npm --prefix web run build   # 前端类型检查 + 构建
```

仓库里已有一批 Vitest 用例，改曲库 / Subsonic 时**不要**新增或扩写 `test/*.test.ts`，
也不要把新行为接到 `test/sync.test.ts`、`test/db.test.ts` 上。约定见 [`AGENTS.md`](AGENTS.md)。

## 故障排查

| 现象 | 原因与处理 |
| --- | --- |
| 页面 404 / 空白，接口正常 | `web/dist` 不存在。跑 `npm --prefix web run build` |
| 搜索有结果但点播没声 | 没放音源脚本，或脚本 init 失败。看 `GET /api/source/status` 的 `message`，补 `data/user-api/current.js` 后重启 |
| 日志提示 `web/dist missing at …` | 同上，服务启动时发现静态目录缺失 |
| 启动时报数据库连不上 | 本机 Postgres 未启动，或 `config.yaml` 的 `databaseUrl` 指错了 |
| 端口被占（EADDRINUSE） | `pm2 delete lx-music-sync && ./scripts/deploy.sh --no-pull` |
| 定时刷新没触发 | 设置里 `scheduleOn` 必须为 `1`，表达式要能通过校验；保存设置后服务会立即重排 |
| 重启后残留占端口的孤儿进程 | 生产入口要在同一进程内跑 TS（`bin/lx-sync.mjs` 用 `tsx` 的 `register()`），不要改成 spawn 子进程 |

## 已知限制

- **管理接口没有鉴权**：任何能访问端口的人都能改订阅、扫目录、上传音源脚本。默认只监听 `127.0.0.1`，
  要对外请自己加 nginx Basic Auth、内网访问控制或反向代理层的鉴权。没设 Subsonic 口令时，非回环请求过不了 `/rest`。
- **单实例**：进程内任务队列 + 单端口，只能 fork 单进程。
- **后台任务串行**：刷新、扫描、缓存同一时刻只跑一个，其余排队。点播不进这条队列。
- **不做音频元数据写入**：封面 / 歌词不回写到音频文件的 ID3/Vorbis 标签。
- **`data/` 不入库**：音源脚本、缓存文件、口令密钥都需要自己在服务器上准备和备份。
- 前端 `web/src/mock/data.ts` 现在只提供类型与平台中文名（页面数据全部走 `/api`），
  平台图标存放在 `web/public/images/`。

## 说明

本项目只负责歌单归档与本地整理。请自行确认所使用音源脚本与下载内容的合规性，仅用于个人合法用途。
