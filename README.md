# 听柜 · lx-music-sync-service

把在线歌单同步到本地硬盘的自托管服务。

订阅各音乐平台（酷我 / 酷狗 / QQ / 网易 / 咪咕）的歌单，手动或定时触发同步：服务拉取歌单曲目快照，通过
**LX 音源脚本**解析出播放地址，再把音频断点续传下载到本地，同时把能搜到的封面、歌词一起存下来。附带一个
Vue 3 写的 Web 界面「听柜」和一套 CLI，镜像一次构建、单进程跑在 PM2 里。

> 本项目只做「歌单 → 本地文件」的搬运和归档，不提供任何音乐内容，也不内置任何音源脚本。

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

- **歌单订阅与增量同步**：每个歌单单独保存曲目快照，同步时只下载本地缺失的曲目；已经下载过的曲目会刷新元数据但不会重复下载。
- **删歌单不删文件**：删除订阅只清掉数据库里的快照，本地音频和下载记录都保留，避免误删已归档的音乐。
- **可恢复下载**：`.part` 临时文件 + Range 请求，续传前校验已有内容的末尾 10 字节，对不上就重下，最多重试 4 次。
- **音源脚本沙箱**：用户脚本跑在 Node `vm` 里，同时兼容 LX Music 的 `lx.on/lx.send` 脚本和 CeruMusic（澜音）的 `module.exports` 插件。
- **多平台搜索**：`source=all` 时并发搜索全部平台，按 `id` 去重合并，单个平台报错不影响整体结果。
- **定时同步**：内置 cron（每 6 小时 / 每天固定时刻 / 自定义 cron 表达式），默认关闭。
- **封面与歌词**：同步时顺带补全封面；`/api/lyrics` 支持按需取歌词和翻译歌词，另有封面回填补齐历史数据。
- **HTTP 代理**：设置里开代理后，音源脚本请求、SDK 请求和下载都走同一个代理。
- **Web 界面**：歌单 / 唱片墙（已下载）/ 搜索 / 任务 / 设置五个页面，12 套主题（默认 `nightwood` 夜木），偏好存在 `localStorage`。

## 它是怎么工作的

```
                 ┌──────────────────────────────────────────────────────────┐
  浏览器 / curl   │  Hono HTTP API  (/api/*)                                 │
      ──────────▶ │                                                          │
                 └───┬───────────────┬────────────────┬─────────────────────┘
                     │               │                │
        歌单快照刷新  │        同步调度 │         搜索 / 下载 │
                     ▼               ▼                ▼
        ┌──────────────────┐  ┌─────────────┐  ┌────────────────────┐
        │ musicSdk (内置)   │  │ sync 服务    │  │ search 服务         │
        │ 搜索 + 歌单详情    │  │ 队列 + 进度  │  │ 多源并发合并        │
        └────────┬─────────┘  └──────┬──────┘  └─────────┬──────────┘
                 │                   │                   │
                 │                   ▼                   │
                 │        ┌──────────────────────┐       │
                 │        │ userApi runtime (vm) │◀──────┘
                 │        │ 音源脚本 → musicUrl   │
                 │        └──────────┬───────────┘
                 │                   ▼
                 │        ┌──────────────────────┐
                 └───────▶│ downloader           │
                          │ Range 续传 → 本地文件  │
                          └──────────┬───────────┘
                                     ▼
                          SQLite (data/lx-sync.db) + data/music/
```

一次同步的流程：

1. `refreshPlaylistSnapshot` 调 `musicSdk` 的平台模块，按页拉全歌单曲目，整表替换该歌单的 `playlist_tracks` 快照。
2. `sync` 服务为这次任务插入一条 `sync_jobs`（`running`），遍历快照里的曲目。
3. 曲目已下载且文件还在 → 只刷新标题 / 封面 / `raw` 元数据，计入 `skipped`。
4. 否则用音质偏好 + 音源能力 + 该曲目实际可用音质挑一档，调音源脚本拿 `musicUrl`，然后下载到
   `savePath/<歌单目录>/<文件名>`，写入 `downloads` 表，计入 `downloaded`。
5. 任务收尾更新 `sync_jobs` 为 `success` / `failed`，失败明细存进 `error_summary`。

同步任务在服务内部**串行排队**：多个请求同时打进来会依次执行，而不是互相打断或直接丢弃。进度通过
`GET /api/jobs` 的 `running` 字段暴露，Web 底部的任务条每 1.5 秒轮询一次。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 运行时 | Node.js 20+（开发机为 22），ESM，TypeScript `strict` |
| HTTP | [Hono](https://hono.dev) + `@hono/node-server` |
| 存储 | SQLite（`better-sqlite3`，WAL，外键开启） |
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
│   ├── cli.ts                # CLI 命令定义（playlist / sync / search / download / serve）
│   ├── serve.ts              # 组装 AppCtx、启动 HTTP + 静态资源 + cron、优雅退出
│   ├── config.ts             # config.yaml / 环境变量加载，带默认值
│   ├── types.ts              # MusicInfo / Quality / OnlineSource
│   ├── http/app.ts           # 全部 /api/* 路由
│   ├── db/
│   │   ├── schema.ts         # 建表 SQL
│   │   ├── index.ts          # openDb：WAL、外键、迁移与历史数据回填
│   │   └── repos.ts          # playlists / tracks / downloads / jobs / settings 仓储 + 默认设置
│   ├── services/
│   │   ├── playlists.ts      # 歌单快照刷新（分页拉全曲目、推封面）
│   │   ├── sync.ts           # 同步任务队列、并发控制、进度
│   │   ├── search.ts         # 单平台 / 全平台合并搜索
│   │   ├── settings.ts       # 设置读取写入、代理生效、cron 重排
│   │   ├── lyrics.ts         # 歌词（含翻译）
│   │   └── pic.ts            # 封面获取与补全
│   ├── download/downloader.ts# Range 续传下载器
│   ├── userApi/
│   │   ├── runtime.ts        # 音源脚本沙箱（LX + CeruMusic 双协议）
│   │   └── parseScript.ts    # 解析脚本头部注释里的 @name/@version 等
│   ├── sdk/
│   │   ├── load.ts           # 包一层 musicSdk，统一 MusicInfo 形状
│   │   ├── request.ts        # 对齐桌面端的 httpFetch
│   │   ├── proxy.ts          # 全局 SDK 代理开关
│   │   ├── common.ts         # 工具函数（时间、大小、歌手名等）
│   │   └── musicSdk/         # 各平台搜索 / 歌单详情（含酷狗 infSign 等）
│   └── lib/
│       ├── names.ts          # 音质选择、扩展名映射、文件名 / 目录名清洗
│       └── toNewMusicInfo.ts # 旧版 musicInfo → 本项目 MusicInfo
├── web/                      # 「听柜」前端（Vue 3 + Vite）
│   ├── src/api.ts            # 后端 API 客户端
│   ├── src/router.ts         # /shelf /wall /search /tape /cabinet
│   ├── src/themes.ts         # 12 套主题 token
│   └── src/views/            # 五个页面
├── test/                     # Vitest 用例（12 个文件 / 39 个用例）
├── bin/lx-sync.mjs           # 生产入口：进程内注册 tsx，直接跑 TS
├── scripts/deploy.sh         # 一键部署 / 更新（PM2）
├── ecosystem.config.cjs      # PM2 配置（fork 单实例）
├── config.example.yaml       # 配置模板，复制成 config.yaml 后改
├── docs/deploy.md            # 部署与运维细节
└── data/                     # 运行期数据（不入库）：SQLite、音乐、音源脚本
```

## 快速开始

### 环境要求

- Node.js **20+**（建议 22，与生产一致）
- 一个可用的**音源脚本**（仓库不含，见[音源脚本](#音源脚本)）
- 编译 `better-sqlite3` 时可能需要 `python3` / `make` / `g++`（有预编译包时不需要）

### 安装与启动

```bash
npm install

# 1) 生成配置
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
host: 127.0.0.1   # 默认只有本机能访问；改成 0.0.0.0 即对外暴露（服务没有登录鉴权！）
port: 8787
dataDir: ./data   # SQLite、音乐文件、音源脚本都放这里；相对路径按启动时的工作目录解析
logLevel: info    # debug | info | warn | error
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
`GET /api/source/status` 返回 `ok: false`，搜索能出结果但取不到播放地址，同步里的曲目会记成「源不可用」。

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
除了 `serve`，其余命令都是执行完即退出，输出 JSON，方便脚本消费。

| 命令 | 说明 |
| --- | --- |
| `lx-sync playlist add --source <kw\|kg\|tx\|wy\|mg> --url <url>` | 新增歌单订阅 |
| `lx-sync playlist list` | 列出歌单 |
| `lx-sync playlist remove <id>` | 删除订阅（保留本地文件与下载记录） |
| `lx-sync sync [--id <n>]` | 同步单个歌单；不带 `--id` 同步全部启用的歌单 |
| `lx-sync search --source <source\|all> --q <text>` | 搜索曲目 |
| `lx-sync download --source <source> --id <platformSongId>` | 下载单曲 |
| `lx-sync serve` | 启动 HTTP 服务（含静态资源与定时任务） |

```bash
node bin/lx-sync.mjs playlist add --source wy --url 'https://music.163.com/playlist?id=123456'
node bin/lx-sync.mjs sync --id 1
node bin/lx-sync.mjs search --source all --q '起风了'
```

命令失败时进程以非零码退出，错误写到 stderr；`download` / `playlist remove` 找不到目标会退出 1，
`serve` 缺少实现会退出 2。

## HTTP API

所有接口都在 `/api` 下，请求与响应均为 JSON（上传音源脚本用 multipart，删除接口返回 `204` 无内容）。
服务没有鉴权，默认只监听回环地址。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/playlists` | 歌单列表，附 `trackCount`、`downloaded`、`coverUrl` |
| `POST` | `/api/playlists` | 新增订阅：`{ source, url }` |
| `PATCH` | `/api/playlists/:id` | 改名（会置 `name_custom`）或启用/停用：`{ name?, enabled? }` |
| `DELETE` | `/api/playlists/:id` | 删除订阅，返回 `204`（曲目快照级联删除） |
| `POST` | `/api/playlists/:id/refresh` | 重新拉取线上歌单曲目快照 |
| `GET` | `/api/playlists/:id/tracks` | 曲目快照，每项带 `downloaded` 标记 |
| `POST` | `/api/playlists/:id/sync` | 同步单个歌单，返回任务行 |
| `POST` | `/api/sync` | 同步全部启用的歌单，返回任务行 |
| `GET` | `/api/jobs` | `{ list: 任务历史, running: 当前进度或 null }` |
| `GET` | `/api/search` | 搜索：`?q=&source=kw\|kg\|tx\|wy\|mg\|all&page=`（默认 `all`、`1`） |
| `POST` | `/api/downloads` | 下载单曲：`{ musicInfo }` 或 `{ source, id }` |
| `GET` | `/api/downloads` | 已下载列表（含封面、来源、`raw` 元数据） |
| `POST` | `/api/downloads/backfill-covers` | 给缺封面的历史下载补图，返回 `{ updated, scanned }` |
| `GET` | `/api/lyrics` | 歌词：`?songKey=`，返回 `lyric` / `tlyric` 及曲目信息 |
| `GET` | `/api/source/status` | 音源脚本状态：`ok`、`message`、`name`、`version`、各平台能力 |
| `GET` | `/api/settings` | 设置项 + 音源状态（`sourceOk` / `sourceMessage`） |
| `PUT` | `/api/settings` | 保存设置，仅接受[白名单字段](#设置项) |
| `POST` | `/api/settings/user-api` | 上传音源脚本，`multipart/form-data`，字段名 `file` |
| `POST` | `/api/settings/user-api/url` | 从 `http(s)` URL 导入音源脚本：`{ url }` |

几个约定：

- 找不到歌单返回 `404 { error: 'not found' }`；参数缺失返回 `400`；同步 / 下载失败返回 `500`。
- `/api/jobs` 的 `running` 形如 `{ trackDone, trackTotal, percent, songKey, downloaded, byteTotal }`，空闲时为 `null`。
- `/api/playlists` 和 `/api/playlists/:id/tracks` 里的 `songKey` 是 `平台_平台ID`（酷狗是 `songmid_hash`），下载记录和快照靠它对齐。
- 静态资源由同一个端口托管：命中 `web/dist` 里的文件就直接返回，其余路径回落到 `web/dist/index.html`（支持前端路由刷新）。

## 设置项

`PUT /api/settings` 只写入下面这些键，其余字段忽略；值统一转成字符串存储。

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `savePath` | `./data/music` | 下载根目录 |
| `quality` | `320k` | 期望音质，取不到时按 `flac24bit > flac > wav > ape > 320k > 192k > 128k` 顺序回退 |
| `concurrency` | `3` | 同时下载数，限制在 1–6 |
| `fileName` | `name-singer` | 文件名模式：`name-singer` / `singer-name` / `name` |
| `scheduleOn` | `0` | `1` 打开定时同步 |
| `schedule` | `every-6h` | `every-6h` / `daily` / `cron` |
| `scheduleTime` | `03:00` | `daily` 时的执行时刻（`HH:mm`，非法值回落到 03:00） |
| `cron` | `0 */6 * * *` | `schedule=cron` 或兜底时使用的 cron 表达式 |
| `proxyOn` | `0` | `1` 打开代理 |
| `proxyHost` / `proxyPort` | 空 | 代理地址，保存后立即对音源脚本与下载生效 |

```bash
curl -X PUT http://127.0.0.1:8787/api/settings \
  -H 'Content-Type: application/json' \
  -d '{"quality":"flac","concurrency":"4","scheduleOn":"1","schedule":"daily","scheduleTime":"04:30"}'
```

## 数据、文件名与音质

运行期数据都在 `dataDir`（默认 `./data`）下：

| 路径 | 内容 |
| --- | --- |
| `data/lx-sync.db` | SQLite：歌单、曲目快照、下载记录、同步任务、设置 |
| `data/music/` | 下载的音频，按歌单目录归档；搜索下载固定落在 `search/` |
| `data/user-api/current.js` | 当前音源脚本 |

表结构（见 [`src/db/schema.ts`](src/db/schema.ts)）：

| 表 | 作用 |
| --- | --- |
| `playlists` | 订阅：来源、URL、名称（是否被手工改过）、启用状态、保存目录、封面 |
| `playlist_tracks` | 歌单曲目快照，主键 `(playlist_id, song_key)`，随歌单删除级联 |
| `downloads` | 已下载曲目，主键 `song_key`，含文件路径、音质、来源、封面与 `raw` 元数据 |
| `sync_jobs` | 同步任务：状态、起止时间、扫描 / 跳过 / 下载 / 失败计数、错误明细 |
| `settings` | 键值设置，读取时与默认值合并 |

打开的库会跑一次轻量迁移与回填：补齐 `downloads` / `playlists` 的后加列，从歌单分享链接的 `cover=`
参数补封面，从曲目快照回填历史下载记录的标题、歌手、封面与元数据。

文件落盘规则：

```
<savePath>/<歌单目录>/<按 fileName 模式生成的名字>.<ext>
```

- 歌单目录优先用 `playlists.save_dir`（首次刷新时取线上歌单名并清洗非法字符），搜索下载固定在 `search/`。
- 扩展名由实际拿到的音质决定：`flac` / `flac24bit` → `.flac`，`wav` → `.wav`，`ape` → `.ape`，其余 → `.mp3`。
- 下载中先写 `<目标文件>.part`，续传前比对末尾 10 字节，完整后才 `rename` 成正式文件。

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

PM2 配置固定 **fork 模式、`instances: 1`**：`better-sqlite3` 是同步单连接、服务也只监听一个端口，
不要改成 cluster 或多实例。前端由服务自身托管，nginx 反代到本机端口即可，`proxy_read_timeout` 建议放大
（同步和下载接口耗时长）。数据备份直接打包整个 `data/`，只备数据库时记得 WAL 的
`lx-sync.db-wal` / `lx-sync.db-shm` 要一起拷。

完整的部署、nginx、开机自启与排错见 [`docs/deploy.md`](docs/deploy.md)。

## 开发与测试

```bash
npm test                     # Vitest，test/ 下全部用例
npm run build                # 类型检查（tsc --noEmit）
npm --prefix web run build   # 前端类型检查 + 构建
```

现有 12 个测试文件覆盖了这些行为，改代码时对号入座：

| 文件 | 覆盖内容 |
| --- | --- |
| `test/db.test.ts` | 仓储读写、级联删除、`name_custom`、历史元数据回填 |
| `test/http.test.ts` | 歌单 CRUD、同步、搜索、任务、设置、配置默认值 |
| `test/sync.test.ts` | 跳过已下载、快照收缩不删文件、任务排队、搜索下载路径 |
| `test/downloader.test.ts` | Range 续传与末尾校验失败重下 |
| `test/runtime.test.ts` | LX / CeruMusic 脚本加载、沙箱行为、`songmid` 扁平化 |
| `test/refreshPlaylist.test.ts` | 快照分页、`save_dir` 与自定义名称保护 |
| `test/searchMerge.test.ts` | 多源并发合并去重、单源报错吞掉 |
| `test/names.test.ts` | 音质回退、扩展名映射、文件名 / 目录名清洗 |
| `test/cron.test.ts` | 定时开关与各调度模式解析 |
| `test/cli.test.ts` / `test/parseScript.test.ts` / `test/sdkLoad.test.ts` | CLI 行为、脚本头解析、SDK 可加载 |

当前基线：`Test Files 12 passed / Tests 39 passed`。

写代码时的约定见 [`AGENTS.md`](AGENTS.md)。

## 故障排查

| 现象 | 原因与处理 |
| --- | --- |
| 页面 404 / 空白，接口正常 | `web/dist` 不存在。跑 `npm --prefix web run build` |
| 搜索有结果但下载报「源不可用」 | 没放音源脚本，或脚本 init 失败。看 `GET /api/source/status` 的 `message`，补 `data/user-api/current.js` 后重启 |
| 日志提示 `web/dist missing at …` | 同上，服务启动时发现静态目录缺失 |
| 下载失败 / 音质不是想要的 | 音源不支持该音质时按 `pickQuality` 回退；看任务 `error_summary` 里的具体报错 |
| 代理不生效 | 设置里 `proxyOn=1` 且 host/port 合法才会生效；否则回落到 `LX_SDK_PROXY_*` / `HTTP_PROXY_*` 环境变量 |
| 端口被占（EADDRINUSE） | `pm2 delete lx-music-sync && ./scripts/deploy.sh --no-pull` |
| `better-sqlite3` 编译失败 | 装 `python3 make g++`，再跑 `./scripts/deploy.sh --no-pull --skip-build` |
| 定时同步没触发 | 设置里 `scheduleOn` 必须为 `1`，保存设置后服务会立即重排 cron |
| 重启后残留占端口的孤儿进程 | 生产入口要在同一进程内跑 TS（`bin/lx-sync.mjs` 用 `tsx` 的 `register()`），不要改成 spawn 子进程 |

## 已知限制

- **没有鉴权**：任何能访问端口的人都能增删歌单、触发下载、上传音源脚本。默认只监听 `127.0.0.1`，
  要对外请自己加 nginx Basic Auth、内网访问控制或反向代理层的鉴权。
- **单实例**：SQLite 单写连接 + 单端口，只能 fork 单进程。
- **同步任务串行**：同一时刻只有一个同步任务在跑，其余排队等待。
- **不做音频元数据写入**：封面 / 歌词存在数据库和接口里，不回写到音频文件的 ID3/Vorbis 标签。
- **`data/` 不入库**：音源脚本、音乐文件、数据库都需要自己在服务器上准备和备份。
- 前端 `web/src/mock/data.ts` 现在只提供类型与平台中文名（页面数据全部走 `/api`），
  平台图标存放在 `web/public/images/`。

## 说明

本项目只负责歌单归档与本地整理。请自行确认所使用音源脚本与下载内容的合规性，仅用于个人合法用途。
