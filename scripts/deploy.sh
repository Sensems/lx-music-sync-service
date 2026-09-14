#!/usr/bin/env bash
#
# 一键部署 / 更新 lx-music-sync-service（PM2 托管）
#
#   ./scripts/deploy.sh                 # 拉代码 + 装依赖 + 构建前端 + 重载 PM2
#   ./scripts/deploy.sh --no-pull       # 不拉代码（已在本地更新过代码时）
#   ./scripts/deploy.sh --skip-install  # 跳过依赖安装
#   ./scripts/deploy.sh --skip-build    # 跳过前端构建
#
# 可选环境变量：
#   HOST=0.0.0.0                         覆盖 config.yaml 的 host
#   PORT=9000                            覆盖 config.yaml 的 port
#   USER_API_SCRIPT=/tmp/current.js      复制成 data/user-api/current.js
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

APP_NAME="lx-music-sync"
PM2_CONFIG="ecosystem.config.cjs"
PULL=1
INSTALL=1
BUILD=1

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  awk 'NR > 1 { if ($0 !~ /^#/) exit; sub(/^# ?/, ""); print }' "${BASH_SOURCE[0]}"
}

for arg in "$@"; do
  case "$arg" in
    --no-pull) PULL=0 ;;
    --skip-install) INSTALL=0 ;;
    --skip-build) BUILD=0 ;;
    -h | --help)
      usage
      exit 0
      ;;
    *) die "未知参数：$arg（用 -h 查看用法）" ;;
  esac
done

command -v node >/dev/null 2>&1 || die '找不到 node，请先安装 Node.js 20+（建议与开发机一致的 22）'
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || die "Node 版本过低：$(node -v)，需要 >= 20"

command -v pm2 >/dev/null 2>&1 || die '找不到 pm2，请先执行：npm i -g pm2'

# 1) 拉取代码
if [ "$PULL" = 1 ]; then
  if [ -d .git ] && [ -n "$(git remote 2>/dev/null)" ]; then
    if [ -n "$(git status --porcelain)" ]; then
      warn '工作区有未提交改动，跳过 git pull'
    else
      log '拉取最新代码'
      git pull --ff-only
    fi
  else
    warn '不是带远程仓库的 git 仓库，跳过 git pull'
  fi
fi

# 2) 安装依赖
if [ "$INSTALL" = 1 ]; then
  if [ -f pnpm-lock.yaml ] && command -v pnpm >/dev/null 2>&1; then
    log '安装后端依赖（pnpm）'
    pnpm install --frozen-lockfile
  elif [ -f package-lock.json ]; then
    log '安装后端依赖（npm ci）'
    npm ci
  else
    log '安装后端依赖（npm install）'
    npm install
  fi

  log '安装前端依赖（npm ci）'
  npm --prefix web ci
fi

# 3) 构建前端 —— 服务端只从 web/dist 托管静态资源，产物不入库
if [ "$BUILD" = 1 ]; then
  log '构建前端'
  npm --prefix web run build
fi

# 4) 配置：config.yaml 不入库，首次部署自动生成
if [ ! -f config.yaml ]; then
  log '生成 config.yaml（来自 config.example.yaml）'
  cp config.example.yaml config.yaml
fi

if [ -n "${HOST:-}" ]; then
  case "$HOST" in
    *[!0-9a-zA-Z.:_-]*) die "HOST 含有非法字符：$HOST" ;;
  esac
  log "覆盖 config.yaml 的 host = $HOST"
  sed -i.bak -E "s/^host:.*/host: $HOST/" config.yaml && rm -f config.yaml.bak
fi

if [ -n "${PORT:-}" ]; then
  case "$PORT" in
    *[!0-9]*) die "PORT 必须是数字：$PORT" ;;
  esac
  log "覆盖 config.yaml 的 port = $PORT"
  sed -i.bak -E "s/^port:.*/port: $PORT/" config.yaml && rm -f config.yaml.bak
fi

# 5) 运行期目录与音源脚本
mkdir -p data/user-api logs

if [ -n "${USER_API_SCRIPT:-}" ]; then
  [ -f "$USER_API_SCRIPT" ] || die "音源脚本不存在：$USER_API_SCRIPT"
  log '复制音源脚本到 data/user-api/current.js'
  cp "$USER_API_SCRIPT" data/user-api/current.js
fi

if [ ! -f data/user-api/current.js ]; then
  warn 'data/user-api/current.js 不存在 —— 音源脚本不入库，必须手动放一份'
  warn "否则 /api/settings 会返回 sourceOk=false，搜索与下载都不可用"
  warn "放好后重跑：USER_API_SCRIPT=/path/to/current.js $0 --no-pull --skip-install --skip-build"
fi

# 6) 交给 PM2
if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  log "重载 PM2 应用 $APP_NAME"
  pm2 startOrReload "$PM2_CONFIG" --update-env
else
  log "启动 PM2 应用 $APP_NAME"
  pm2 start "$PM2_CONFIG" --update-env
fi
pm2 save >/dev/null

# 7) 健康检查（服务监听 127.0.0.1 时也能测到）
CHECK_PORT="$(sed -nE 's/^port:[[:space:]]*([0-9]+).*/\1/p' config.yaml | head -n 1)"
CHECK_PORT="${PORT:-${CHECK_PORT:-8787}}"

if command -v curl >/dev/null 2>&1; then
  HEALTHY=0
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    sleep 1
    if curl -fsS "http://127.0.0.1:${CHECK_PORT}/api/settings" >/dev/null 2>&1; then
      HEALTHY=1
      break
    fi
  done
  if [ "$HEALTHY" = 1 ]; then
    log "健康检查通过：http://127.0.0.1:${CHECK_PORT}/api/settings"
  else
    warn "健康检查失败（127.0.0.1:${CHECK_PORT} 无响应），看看日志：pm2 logs $APP_NAME --lines 50"
  fi
else
  log "没有 curl，跳过健康检查；可以手动验证 http://127.0.0.1:${CHECK_PORT}/api/settings"
fi

log "完成。常用命令：pm2 status / pm2 logs $APP_NAME / pm2 restart $APP_NAME"
log "开机自启（只需一次）：pm2 startup 然后 pm2 save"
