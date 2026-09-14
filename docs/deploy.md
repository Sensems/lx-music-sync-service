# 部署与运维（PM2）

日期：2026-09-14  
状态：已实现

## 前置条件

- Linux 服务器（WSL / Git Bash 也可以），Node.js 20+，建议与开发机一致的 22
- PM2：`npm i -g pm2`
- 编译 better-sqlite3 需要 `python3`、`make`、`g++`（能命中预编译包就不需要）
- 服务器能访问各音乐平台，必要时在「设置」里打开代理

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
4. 没有 `config.yaml` 就从 `config.example.yaml` 生成一份
5. 建好 `data/user-api`、`logs`
6. `pm2 startOrReload ecosystem.config.cjs` + `pm2 save`，最后打一次健康检查

以后每次更新，同样跑 `./scripts/deploy.sh` 就行。

### 参数与环境变量

| 参数 / 变量 | 作用 |
| --- | --- |
| `--no-pull` | 不执行 `git pull` |
| `--skip-install` | 跳过依赖安装 |
| `--skip-build` | 跳过前端构建 |
| `HOST=0.0.0.0` | 覆盖 `config.yaml` 的 host |
| `PORT=9000` | 覆盖 `config.yaml` 的 port |
| `USER_API_SCRIPT=/tmp/current.js` | 复制成 `data/user-api/current.js` |

例如把服务直接暴露到公网并指定音源脚本：

```bash
HOST=0.0.0.0 USER_API_SCRIPT=/tmp/current.js ./scripts/deploy.sh
```

## 两样必须自己准备的东西

- **音源脚本 `data/user-api/current.js`**：`data/` 被 git 忽略，脚本不会随仓库走。没有它接口返回
  `sourceOk=false`，搜索和下载都拿不到播放地址。
- **`config.yaml`**：默认 `host: 127.0.0.1`，只有本机能访问。要么改成 `0.0.0.0`，要么用 nginx 反代。
  注意本服务**没有登录鉴权**，直接暴露到公网等于把下载能力开放给所有人。

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
        proxy_read_timeout 300s;   # 同步、下载接口耗时长
    }
}
```

前端由服务自身从 `web/dist` 托管，nginx 不需要额外配静态目录。

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
- **better-sqlite3 编译失败**：`apt install -y python3 make g++`，然后
  `./scripts/deploy.sh --no-pull --skip-build`
- **页面 404 但接口正常**：`web/dist` 不存在，跑 `--skip-install` 补一次构建
- **搜索/下载报音源未加载**：补 `data/user-api/current.js` 后 `pm2 restart lx-music-sync`

## 数据与备份

运行期数据都在 `data/`：

| 路径 | 内容 |
| --- | --- |
| `data/lx-sync.db` | SQLite 库（歌单、曲目、下载记录、任务、设置） |
| `data/music/` | 下载的音频文件 |
| `data/user-api/current.js` | 音源脚本 |

备份就是打包整个 `data/`；只备份数据库的话，注意 SQLite 开了 WAL，要连着
`lx-sync.db-wal`、`lx-sync.db-shm` 一起拷，或者先 `pm2 stop lx-music-sync`。

## 单进程约束

better-sqlite3 是同步单连接，服务也只监听一个端口，所以 PM2 必须 fork 模式、`instances: 1`
（`ecosystem.config.cjs` 里已经固定）。不要改成 cluster 或多实例。
