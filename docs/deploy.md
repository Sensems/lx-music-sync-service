# 部署与运维（PM2）

日期：2026-10-11  
状态：已实现

## 前置条件

- Linux 服务器（WSL / Git Bash 也可以），Node.js 20+，建议与开发机一致的 22
- PM2：`npm i -g pm2`
- **单独安装的 Postgres**。曲库不在 SQLite 里。`config.yaml` 必须写上 `databaseUrl`
- 服务器能访问各音乐平台，必要时用环境变量给 SDK 配代理

## 一键部署

```bash
git clone <repo> lx-music-sync-service
cd lx-music-sync-service
npm i -g pm2
./scripts/deploy.sh
```

脚本按顺序做这些事：

1. `git pull --ff-only`（工作区有未提交改动或没配远程就跳过）
2. 装后端依赖：有 `pnpm-lock.yaml` 且装了 pnpm 用 `pnpm install --frozen-lockfile`，否则 `npm ci`
3. 装前端依赖并 `npm --prefix web run build` 生成 `web/dist`
4. 没有 `config.yaml` 就从 `config.example.yaml` 生成一份，并检查是否写了 `databaseUrl`
5. 建好 `data/user-api`、`logs`
6. `pm2 startOrReload ecosystem.config.cjs` + `pm2 save`，最后打一次健康检查

以后每次更新，同样跑 `./scripts/deploy.sh` 就行。

把 `config.example.yaml` 复制成 `config.yaml` 之后，补上 `databaseUrl`。不要把真实连接串写进仓库。

### 参数与环境变量

| 参数 / 变量 | 作用 |
| --- | --- |
| `--no-pull` | 不执行 `git pull` |
| `--skip-install` | 跳过依赖安装 |
| `--skip-build` | 跳过前端构建（仍会装前端依赖） |
| `--skip-frontend` | 跳过前端部署：不装前端依赖、不构建，沿用已有的 `web/dist` |
| `HOST=0.0.0.0` | 覆盖 `config.yaml` 的 host |
| `PORT=9000` | 覆盖 `config.yaml` 的 port |
| `USER_API_SCRIPT=/tmp/current.js` | 复制成 `data/user-api/current.js` |

例如把服务直接暴露到公网并指定音源脚本：

```bash
HOST=0.0.0.0 USER_API_SCRIPT=/tmp/current.js ./scripts/deploy.sh
```

默认仍只听 `127.0.0.1`。改成对外监听之前，先在设置里写上 Subsonic 口令。没设口令时，非回环请求鉴权失败。

## 两样必须自己准备的东西

- **音源脚本 `data/user-api/current.js`**：`data/` 被 git 忽略，脚本不会随仓库走。没有它接口返回
  `sourceOk=false`，搜索和点播都拿不到播放地址。
- **`config.yaml`**：默认 `host: 127.0.0.1`，只有本机能访问。要么改成 `0.0.0.0`，要么用 nginx 反代。
  注意管理接口**没有登录鉴权**，直接暴露到公网等于把曲库管理开放给所有人。Subsonic 靠口令挡住非回环请求。

## nginx 反向代理

```nginx
server {
    listen 80;
    server_name music.example.com;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 300s;   # 扫描、缓存接口耗时长
    }
}
```

前端由服务自身从 `web/dist` 托管，nginx 不需要额外配静态目录。

## Subsonic 歌单（已实现的子集）

客户端走 `/rest/*.view`。这次落地的是计划里的子集，不是完整的 1.16.1 歌单编辑：

- `createPlaylist` 一律新建用户歌单。请求里的 `playlistId` 会被忽略，不会改已有歌单。
- `updatePlaylist` 打在订阅歌单上返回错误码 50。
- 用户歌单：`name` 用来改名；重复传 `songId` 会整表替换成员。
- `songIdToAdd`、`songIndexToRemove` 没有实现，不要按官方参数去补。

## 开机自启

```bash
pm2 startup     # 按提示执行它输出的那条 sudo 命令
pm2 save
```

## 日志与排错

```bash
pm2 status
pm2 logs lx-music-sync --lines 100
pm2 restart lx-music-sync
```

- **EADDRINUSE（端口被占）**：`pm2 delete lx-music-sync && ./scripts/deploy.sh --no-pull`
- **页面 404 但接口正常**：`web/dist` 不存在，跑 `--skip-install` 补一次构建
- **搜索/点播报音源未加载**：补 `data/user-api/current.js` 后 `pm2 restart lx-music-sync`
- **启动时报数据库连不上**：确认本机 Postgres 已启动，且 `config.yaml` 的 `databaseUrl` 指向那份库

## 数据与备份

曲库在 Postgres。运行期文件仍在 `data/`：

| 路径 | 内容 |
| --- | --- |
| Postgres | 歌手、专辑、歌曲、歌单、任务、设置 |
| `data/cache/` | 按歌曲缓存的音频 |
| `data/user-api/current.js` | 音源脚本 |
| `data/subsonic.key` | 还原 Subsonic 口令的密钥 |

备份要同时带上 Postgres 和整个 `data/`。`data/lx-sync.db` 是旧版 SQLite，新曲库不会读它。

清空曲库、缓存、封面和口令密钥，回到刚建好空表的状态（保留 `config.yaml` 和音源脚本）：

```bash
node scripts/reset.mjs --yes
```

不带 `--yes` 只打印将要删什么。脚本会断开正在使用这份库的连接，跑完后重启服务。

## 单进程约束

服务只监听一个端口，曲库任务也是进程内串行排队，所以 PM2 必须 fork 模式、`instances: 1`
（`ecosystem.config.cjs` 里已经固定）。不要改成 cluster 或多实例。
