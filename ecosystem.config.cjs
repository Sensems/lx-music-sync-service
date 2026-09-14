/**
 * PM2 配置。用法：
 *   pm2 startOrReload ecosystem.config.cjs --update-env
 * 通常不用手动执行，交给 scripts/deploy.sh 即可。
 */
const path = require('node:path')

const root = __dirname

module.exports = {
  apps: [
    {
      name: 'lx-music-sync',
      cwd: root,
      script: 'bin/lx-sync.mjs',
      args: 'serve',
      interpreter: 'node',
      // better-sqlite3 是单写连接 + 单端口，只能 fork 单实例，不要开 cluster。
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      // HTTP 服务收到信号后要等正在进行的同步请求收尾
      kill_timeout: 8000,
      env: {
        NODE_ENV: 'production',
        TINGGUI_CONFIG: path.join(root, 'config.yaml'),
      },
      out_file: path.join(root, 'logs/pm2-out.log'),
      error_file: path.join(root, 'logs/pm2-error.log'),
      merge_logs: true,
      time: true,
    },
  ],
}
