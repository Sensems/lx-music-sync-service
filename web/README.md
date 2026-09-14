# 听柜 web

Vue 3 + Ant Design Vue + UnoCSS。视觉约定见桌面端仓库 `design-system/lx-sync-desk/MASTER.md`。

页面数据全部走 `src/api.ts`（同步服务的 `/api/*`）：歌单、唱片墙、搜索、任务、设置五个页面都已接线。
`src/mock/data.ts` 现在只提供类型定义和平台中文名，不再提供页面假数据。

```bash
npm install
npm run dev
```

`npm run dev` 起在 5173，`/api` 由 Vite 代理到 `http://127.0.0.1:8787`，所以要先在本机跑起同步服务。
生产构建产物 `web/dist` 由服务自身托管。接口清单见仓库根目录的 [README](../README.md#http-api)。
