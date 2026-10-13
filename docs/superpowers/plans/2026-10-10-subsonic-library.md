# Postgres 曲库与 Subsonic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 PostgreSQL 上的歌手 / 专辑 / 歌曲曲库替换歌单快照同步，并在同一进程提供 Subsonic 1.16.1 与 `getLyricsBySongId`。

**Architecture:** 新代码放在 `src/library` 与 `src/subsonic`，通过 `databaseUrl` 连 Postgres。三条入库都调用 `upsertTrack`。播放、扫描、缓存走曲库 id。旧的 SQLite 与 `/api/playlists` 一直留到最后一项再删，这样中途 `npm test` 仍能跑现有用例。Subsonic 的 salt+token 必须能还原口令，口令用 `dataDir/subsonic.key` 做 AES-256-GCM 保存，接口响应里不出现口令。

**Tech Stack:** Node 22、TypeScript ESM、Hono、`pg`、现有 `musicSdk` / 音源沙箱 / `downloadFile`、`music-metadata` 只用于读本地标签。

## Global Constraints

- 不新增、不扩写 `test/*.test.ts`。验收是 `npm run build` 加上每项里的手动请求。
- ESM + NodeNext：相对 import 必须带 `.js` 后缀。
- 默认 `host` 仍是 `127.0.0.1`。PM2 `instances: 1`。不要 cluster。
- 音源沙箱不变：加载超时 5 秒、取地址超时 20 秒、禁用 `require`、只要 http(s)、不把 `fs` / `process` / 真实 `require` 放进沙箱。
- 不把旧 SQLite 迁进 Postgres。`data/` 里的旧库留着。
- 不改 Vue 页面。
- 不实现用户管理、播客、电台、分享、点唱机、聊天、转码。
- 订阅和搜索入库不自动下载。
- 连接串只从 `config.yaml` 的 `databaseUrl` 读取。计划里不写主机、用户名、密码。
- 注释用中文，说明为什么。

## File map

| 文件 | 职责 |
| --- | --- |
| `src/config.ts` | `AppConfig.databaseUrl` |
| `src/db/pg.ts` | 连接池、启动迁移 |
| `src/db/sql/001_library.sql` | 曲库表 |
| `src/library/normalize.ts` | 空白、歌手拆分、时长毫秒 |
| `src/library/types.ts` | `IngestTrack` 等类型 |
| `src/library/upsert.ts` | 强匹配 / 中等匹配 / 新建 |
| `src/library/subscribe.ts` | 刮完才替换订阅歌单成员 |
| `src/library/scan.ts` | 扫描根目录，跳过缓存目录 |
| `src/library/openSong.ts` | 文件优先，否则音源 |
| `src/library/cache.ts` | 缓存一首或一份歌单 |
| `src/library/artwork.ts` | 封面与歌词落盘 |
| `src/library/password.ts` | Subsonic 口令的加密保存 |
| `src/jobs/queue.ts` | 刷新、扫描、缓存串行 |
| `src/subsonic/respond.ts` | JSON / XML 信封 |
| `src/subsonic/auth.ts` | 口令、token、回环 |
| `src/subsonic/routes.ts` | `/rest/*.view` |
| `src/http/manage.ts` | 订阅、搜索入库、目录、缓存、设置 |
| `src/serve.ts` | 装配新上下文；最后一项再拆掉旧同步路由 |
| `config.example.yaml` | 注释掉的 `databaseUrl` 示例，不含真实口令 |
| `docs/deploy.md` | 写明需要单独的 Postgres |

旧文件 `src/db/schema.ts`、`src/db/repos.ts`、`src/services/sync.ts`、`src/services/stream.ts` 在 Task 17 之前不要改签名，现有 Vitest 还依赖它们。

---

### Task 1: 连接串与迁移

**Files:**
- Modify: `src/config.ts`
- Modify: `config.example.yaml`
- Create: `src/db/pg.ts`
- Create: `src/db/sql/001_library.sql`
- Modify: `package.json`（依赖 `pg`、`@types/pg`）

**Interfaces:**
- Consumes: `loadConfig(): AppConfig`
- Produces:
  - `AppConfig.databaseUrl: string`（缺了就是 `''`）
  - `openPool(databaseUrl: string): pg.Pool`
  - `migrate(pool: pg.Pool): Promise<void>` 执行 `src/db/sql/*.sql`，用 `schema_migrations(id text primary key)` 记已执行的文件名

- [ ] **Step 1: 安装依赖并读出连接串**

`npm install pg` 与 `npm install -D @types/pg`。

`loadConfig` 在返回对象里增加：

```ts
databaseUrl: String(fileCfg.databaseUrl ?? ''),
```

`AppConfig` 与 `DEFAULTS` 都加上 `databaseUrl: ''`。`config.example.yaml` 末尾加注释，不要写真实地址：

```yaml
# Postgres 连接串。config.yaml 已被 gitignore。
# databaseUrl: postgresql://USER:PASSWORD@HOST:5432/tinggui
```

- [ ] **Step 2: 写入迁移**

`src/db/sql/001_library.sql` 使用下面的表。艺术家名、专辑名的唯一约束用已经规范化的文本，规范化在 Task 2 做，不在 SQL 里做。

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS artists (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS albums (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title text NOT NULL,
  album_artist_id bigint NOT NULL REFERENCES artists (id),
  cover_url text NOT NULL DEFAULT '',
  cover_path text NOT NULL DEFAULT '',
  UNIQUE (album_artist_id, title)
);

CREATE TABLE IF NOT EXISTS album_sources (
  platform text NOT NULL,
  platform_album_id text NOT NULL,
  album_id bigint NOT NULL REFERENCES albums (id),
  PRIMARY KEY (platform, platform_album_id)
);

CREATE TABLE IF NOT EXISTS songs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title text NOT NULL,
  album_id bigint NOT NULL REFERENCES albums (id),
  duration_ms integer,
  track_no integer,
  disc_no integer,
  lyric text NOT NULL DEFAULT '',
  tlyric text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS song_artists (
  song_id bigint NOT NULL REFERENCES songs (id) ON DELETE CASCADE,
  artist_id bigint NOT NULL REFERENCES artists (id),
  position integer NOT NULL,
  PRIMARY KEY (song_id, position)
);

CREATE TABLE IF NOT EXISTS song_sources (
  platform text NOT NULL,
  platform_song_id text NOT NULL,
  song_id bigint NOT NULL REFERENCES songs (id) ON DELETE CASCADE,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (platform, platform_song_id)
);

CREATE INDEX IF NOT EXISTS song_sources_song_id_idx ON song_sources (song_id);

CREATE TABLE IF NOT EXISTS media_files (
  song_id bigint PRIMARY KEY REFERENCES songs (id) ON DELETE CASCADE,
  path text NOT NULL,
  size bigint NOT NULL,
  mtime_ms bigint NOT NULL,
  quality text NOT NULL DEFAULT '',
  missing boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS library_roots (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  path text NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS playlists (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('subscription', 'user')),
  name text NOT NULL DEFAULT '',
  source_url text NOT NULL DEFAULT '',
  platform text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS playlist_items (
  playlist_id bigint NOT NULL REFERENCES playlists (id) ON DELETE CASCADE,
  position integer NOT NULL,
  song_id bigint NOT NULL REFERENCES songs (id),
  PRIMARY KEY (playlist_id, position)
);

CREATE TABLE IF NOT EXISTS stars (
  target_type text NOT NULL CHECK (target_type IN ('song', 'album', 'artist')),
  target_id bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (target_type, target_id)
);

CREATE TABLE IF NOT EXISTS scrobbles (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  song_id bigint NOT NULL REFERENCES songs (id),
  played_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scrobbles_song_idx ON scrobbles (song_id);
CREATE INDEX IF NOT EXISTS scrobbles_played_idx ON scrobbles (played_at);

CREATE TABLE IF NOT EXISTS jobs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'success', 'failed')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_summary text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY,
  value text NOT NULL
);
```

`migrate` 读 `src/db/sql` 下按文件名排序的 `.sql`。文件名已在 `schema_migrations` 里就跳过。执行用一条 `pool.query(sql)`，成功后插入文件名。`001_library.sql` 本身含 `schema_migrations` 的创建语句，第一次执行时表还不存在，所以先执行 SQL，再 `INSERT INTO schema_migrations`。

- [ ] **Step 3: 核对**

Run: `npm run build`  
Expected: 退出码 0。

再跑一次迁移（`databaseUrl` 来自本地 `config.yaml`，命令里不要打印连接串）：

```ts
import { loadConfig } from './src/config.ts'
import { openPool, migrate } from './src/db/pg.ts'
const pool = openPool(loadConfig().databaseUrl)
await migrate(pool)
const r = await pool.query(`SELECT to_regclass('public.songs') AS songs`)
console.log(r.rows[0].songs)
await pool.end()
```

Expected: 打印 `songs`。

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/config.ts src/db/pg.ts src/db/sql/001_library.sql config.example.yaml
git commit -m "feat: add Postgres pool and library schema"
```

不要把 `config.yaml` 加进去。

---

### Task 2: 规范化与入库类型

**Files:**
- Create: `src/library/normalize.ts`
- Create: `src/library/types.ts`

**Interfaces:**
- Consumes: `MusicInfo`（`src/types.ts`）、`toNewMusicInfo`（`src/lib/toNewMusicInfo.ts`）
- Produces:

```ts
export function collapseSpace(value: string): string

export function splitSingers(singer: string): string[]

export function durationMs(interval: unknown): number | null

export type IngestTrack = {
  platform: 'kw' | 'kg' | 'tx' | 'wy' | 'mg'
  platformSongId: string
  title: string
  singers: string[]
  albumTitle: string
  albumPlatformId: string | null
  durationMs: number | null
  trackNo: number | null
  discNo: number | null
  coverUrl: string | null
  raw: unknown
}

export function ingestTrackFromMusic(music: MusicInfo): IngestTrack
```

- [ ] **Step 1: 实现规则**

`collapseSpace`：`trim`，连续空白收成一个空格。空结果用调用方的默认名，不在这里填「未知歌手」。

`splitSingers`：按 `/`、`、`、`,` 切开，每段再 `collapseSpace`，丢掉空段。

`durationMs`：

- `null`、`undefined`、`''`、`'--/--'` → `null`
- `"m:ss"` 或 `"mm:ss"` → 毫秒
- 有限数字 → 当作秒再乘 1000（`formatPlayTime` 的输入是秒；刮削进 `MusicInfo.interval` 后经常变成 `"03:21"` 这种字符串）
- 其他 → `null`

`ingestTrackFromMusic`：

- `platform` 取 `music.source`，不是这五个平台就抛 `Error('unsupported source')`
- 酷狗的 `music.id` 已是 `songmid_hash`，`platformSongId = music.id`
- 其他平台的 `music.id` 是 `平台_songmid`，去掉第一个 `平台_` 前缀得到 `platformSongId`
- `title` 用 `collapseSpace(music.name)`，空则 `未知歌曲`
- `singers` 用 `splitSingers(music.singer)`，空数组时调用方再换成 `['未知歌手']`，这个函数保持空数组
- `albumTitle` 取 `collapseSpace(String(music.meta.albumName ?? ''))`
- `albumPlatformId` 取 `meta.albumId` 或 `meta.albumMid` 的非空字符串，否则 `null`
- `coverUrl` 取 `meta.picUrl` 的 http(s) 字符串，否则 `null`
- `raw` 就是整份 `music`

- [ ] **Step 2: 核对**

Run: `npm run build`  
Expected: 退出码 0。

- [ ] **Step 3: Commit**

```bash
git add src/library/normalize.ts src/library/types.ts
git commit -m "feat: normalize scraped tracks before library ingest"
```

---

### Task 3: upsertTrack

**Files:**
- Create: `src/library/upsert.ts`

**Interfaces:**
- Consumes: `IngestTrack`、`pg.PoolClient`
- Produces:

```ts
export type UpsertHit = 'strong' | 'medium' | 'created'

export async function upsertTrack(
  client: pg.PoolClient,
  track: IngestTrack,
): Promise<{ songId: string; hit: UpsertHit }>

export async function findMediumMatch(
  client: pg.PoolClient,
  input: { title: string; albumTitle: string; albumArtist: string; durationMs: number },
): Promise<string | null>
```

`songId` 是 `bigint` 的十进制字符串。`findMediumMatch` 使用下面的 SQL，正好一行时返回 `id`，零行或多行返回 `null`。调用方负责 `BEGIN` / `COMMIT`。

- [ ] **Step 1: 按这个顺序写入**

1. 歌手名：`singers` 为空则用 `['未知歌手']`。每个名字 `collapseSpace`。专辑歌手是第一位。
2. 专辑名：`collapseSpace(albumTitle)`，空则 `未知专辑`。
3. 强匹配：`SELECT song_id FROM song_sources WHERE platform = $1 AND platform_song_id = $2`。命中则更新该行的 `raw`，不再新建歌曲。
4. 没有强匹配、且 `durationMs != null`、专辑名不是空、专辑歌手不是空：中等匹配

```sql
SELECT s.id::text AS id
FROM songs s
JOIN albums a ON a.id = s.album_id
JOIN artists ar ON ar.id = a.album_artist_id
WHERE s.title = $1
  AND a.title = $2
  AND ar.name = $3
  AND s.duration_ms IS NOT NULL
  AND abs(s.duration_ms - $4) <= 2000
```

正好一行才合并，并 `INSERT INTO song_sources ... ON CONFLICT DO NOTHING`。多于一行就当作没合并，走新建。
5. 新建：`INSERT artists ON CONFLICT (name) DO NOTHING` 后按名字取回 id。专辑按 `(album_artist_id, title)` 同样先插入再取回。若这次带了 `albumPlatformId`，`INSERT INTO album_sources ... ON CONFLICT DO NOTHING`，不要把已有行改指到另一张专辑。然后插入 `songs`、按顺序插入 `song_artists`、插入 `song_sources`。
6. `coverUrl` 只在专辑当前 `cover_url = ''` 时写入，不覆盖已有封面地址。
7. 强匹配或中等匹配合并时，若新的 `durationMs` 有值而歌曲上原来是 `NULL`，补上时长。已有时长不改。

全程使用同一 `client`。

- [ ] **Step 2: 核对**

Run: `npm run build`  
Expected: 退出码 0。

用同一个 `client` 手动调用两次 `upsertTrack`：同一 `platform + platformSongId` 两次，`songId` 相同，`hit` 第一次是 `created`、第二次是 `strong`。再调用一次不同平台、相同标题 / 专辑歌手 / 专辑名 / 相差 1 秒的时长，`hit` 为 `medium` 且 `songId` 与第一首相同。事务最后 `ROLLBACK`，不要把试数据留在库里。

- [ ] **Step 3: Commit**

```bash
git add src/library/upsert.ts
git commit -m "feat: upsert songs by platform id or album metadata"
```

---

### Task 4: 订阅刷新

**Files:**
- Create: `src/library/subscribe.ts`

**Interfaces:**
- Consumes: `upsertTrack`、`toNewMusicInfo`、`GetListDetail`（`src/services/playlists.ts` 已导出）、`fetchAllTracks` 的分页行为要在本文件重写一份，不要调用会写 SQLite 的 `refreshPlaylistSnapshot`
- Produces:

```ts
export async function createSubscription(
  pool: pg.Pool,
  input: { platform: IngestTrack['platform']; sourceUrl: string },
): Promise<{ playlistId: string }>

export async function refreshSubscription(
  pool: pg.Pool,
  playlistId: string,
  getListDetail: GetListDetail,
): Promise<{ playlistId: string; count: number }>
```

- [ ] **Step 1: 整份成功才替换成员**

`createSubscription` 插入 `playlists(kind='subscription', platform, source_url)`，`name` 先空着。

`refreshSubscription`：

1. 读出 `kind='subscription'` 的行，否则抛错。
2. 在事务外分页把歌单刮完。某一页抛错就立刻失败，不要开始事务。`getListDetail(platform, sourceUrl, page)`，`page` 从 1 递增到 `ceil(total / limit)`。这与 `src/services/playlists.ts` 的 `fetchAllTracks` 相同。
3. 每一条用 `toNewMusicInfo` 再 `ingestTrackFromMusic`。任一条转换抛错，整次刷新失败。
4. 然后 `BEGIN`。对每条 `upsertTrack`。全部成功后 `DELETE FROM playlist_items WHERE playlist_id = $1`，再按刮削顺序从 0 插入。`name` 仍为空时写入在线歌单名。`cover_url` 用歌单 `info.img` 或第一条曲目封面，只在专辑封面还空时由 `upsertTrack` 写入；歌单自己不另存封面列。
5. `COMMIT`。中途任何 SQL 失败就 `ROLLBACK`，旧的 `playlist_items` 还在。
6. 在线歌单少了的歌只是不再出现在这份 `playlist_items` 里。不要删除 `songs` 或 `media_files`。

- [ ] **Step 2: 核对**

Run: `npm run build`  
Expected: 退出码 0。

用一个会在第二页抛错的假 `getListDetail` 调用 `refreshSubscription`。事先插入一条 `playlist_items`。结束后那一行还在，`count` 不会被返回（函数抛错）。

- [ ] **Step 3: Commit**

```bash
git add src/library/subscribe.ts
git commit -m "feat: replace subscription members only after a full scrape"
```

---

### Task 5: 扫描本地目录

**Files:**
- Create: `src/library/scan.ts`
- Modify: `package.json`（依赖 `music-metadata`）
- Modify: `src/library/upsert.ts`

**Interfaces:**
- Consumes: `findMediumMatch`、`durationMs`、`splitSingers`、`collapseSpace`
- Produces:

```ts
export const AUDIO_EXT = new Set(['.mp3', '.flac', '.wav', '.ape', '.m4a', '.ogg', '.aac'])

export async function scanRoot(
  client: pg.PoolClient,
  rootPath: string,
  cacheDir: string,
): Promise<{ added: number; updated: number; unmerged: string[]; unreadable: string[] }>

export async function insertSongWithoutSource(
  client: pg.PoolClient,
  input: {
    title: string
    singers: string[]
    albumTitle: string
    durationMs: number | null
    trackNo: number | null
    discNo: number | null
  },
): Promise<{ songId: string }>
```

- [ ] **Step 1: 扫描规则**

`npm install music-metadata`。

用 `fs.readdir` 递归。跳过扩展名不在 `AUDIO_EXT` 的文件。`realpath` 落在 `cacheDir` 里面的文件跳过，不入库。

读标签失败：路径推进 `unreadable`，继续下一个，不改其他行。

标签里的注释若匹配 `^tinggui:(kw|kg|tx|wy|mg):(.+)$`，用那个平台和平台歌曲 id 做强匹配（直接查 `song_sources`，命中则准备挂文件）。否则组装一条 `IngestTrack`：平台固定用 `wy` 会污染平台身份，所以没有这条注释时不要写 `song_sources`。没有注释的文件：

- 有标题、专辑歌手、专辑名、时长：调用 `findMediumMatch`。返回 id 就挂文件。
- 返回 `null`：调用本任务加在 `upsert.ts` 里的 `insertSongWithoutSource(client, { title, singers, albumTitle, durationMs, trackNo, discNo })`。它只插艺术家、专辑、歌曲、`song_artists`，不写 `song_sources`。歌手空则「未知歌手」，专辑空则「未知专辑」。返回 `{ songId: string }`。

一首歌已经有 `media_files` 且 `missing = false` 并且 `stat` 得到的路径还在：新文件推进 `unmerged`，不改原路径。原文件 `missing = true` 或路径已经不存在：把 `path`、`size`、`mtime_ms` 更新成新文件，`missing = false`。

扫完这个根之后，把 `media_files.path` 位于该根下、这次没见到、且不在 `cacheDir` 下的行标成 `missing = true`。不删 `songs`。

`quality` 用扩展名：`flac→flac`，`wav→wav`，`ape→ape`，其余 `mp3`。

- [ ] **Step 2: 核对**

Run: `npm run build`  
Expected: 退出码 0。

- [ ] **Step 3: Commit**

```bash
git add src/library/scan.ts package.json package-lock.json
git commit -m "feat: scan library roots into songs without touching the cache dir"
```

---

### Task 6: 串行任务队列

**Files:**
- Create: `src/jobs/queue.ts`

**Interfaces:**
- Consumes: `jobs` 表
- Produces:

```ts
export type JobKind = 'refresh-subscription' | 'scan' | 'cache-song' | 'cache-playlist' | 'recache'

export function createJobQueue(pool: pg.Pool): {
  enqueue(kind: JobKind, payload: Record<string, unknown>, run: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>): Promise<{ jobId: string }>
}
```

- [ ] **Step 1: 同一时间只跑一个**

`enqueue` 插入 `status='queued'`，返回 `jobId`。进程内用一条 Promise 链把 `run` 串起来。开始时把该行改成 `running` 并写 `started_at`。成功写 `success`、`result`、`finished_at`。抛错写 `failed`、`error_summary`（`Error.message`）、`finished_at`。不要并行跑两个 `run`。点播不调用 `enqueue`。

- [ ] **Step 2: 核对**

Run: `npm run build`  
Expected: 退出码 0。

- [ ] **Step 3: Commit**

```bash
git add src/jobs/queue.ts
git commit -m "feat: run library jobs one at a time"
```

---

### Task 7: 打开歌曲

**Files:**
- Create: `src/library/openSong.ts`

**Interfaces:**
- Consumes: `pickQuality` 与 `QUALITYS`（`src/lib/names.ts`）、`runtime.getMusicUrl`、`Quality`
- Produces:

```ts
export type OpenDeps = {
  pool: pg.Pool
  getMusicUrl: (source: string, musicInfo: MusicInfo, quality: Quality) => Promise<{ type: Quality; url: string }>
  sourceOrder: () => Array<'kw' | 'kg' | 'tx' | 'wy' | 'mg'>
  wantedQuality: () => Quality
  fetchRemote?: (url: string, headers: Record<string, string>) => Promise<{ status: number; headers: Headers; body: ReadableStream<Uint8Array> | null }>
  now?: () => number
}

export function createOpenSong(deps: OpenDeps): {
  open(songId: string, rangeHeader: string | undefined): Promise<Response>
}
```

不要改 `src/services/stream.ts`。

- [ ] **Step 1: 文件优先，地址只放内存**

1. 查 `media_files`。`missing = false` 且 `existsSync(path)`：`stat` 取长度。没有 `Range` 时状态码 200，`Content-Length` 为文件长度。`Range: bytes=start-end` 时状态码 206，`Content-Range: bytes start-end/length`，流只含这一段。两种都设 `Accept-Ranges: bytes` 和按扩展名的 `Content-Type`。不转码。
2. 没有可用文件：读 `song_sources`，按 `sourceOrder()` 挑第一条。默认顺序 `['kw','kg','tx','wy','mg']`。用 `raw` 里的 JSON 作为 `MusicInfo`。没有 `raw.id` 时，用 `platformSongId` 拼出 Task 2 的 id（酷狗用 `platformSongId` 本身，其他用 `` `${platform}_${platformSongId}` ``）。
3. 音质从 `wantedQuality()` 在 `QUALITYS` 里的位置往更低找。歌曲 `raw.meta._qualitys` 与音源脚本 `getStatus().sources[platform].qualitys` 都支持的第一档才去取地址。取地址失败或不是 http(s)：试下一个平台身份。全部失败返回 404，正文 `{ "error": "暂时没有可播放的地址" }`。不要改歌曲行。
4. 成功的地址按 `songId + quality` 放进 `Map`，8 分钟过期。过期或远端失败就删掉再取一次。远端请求带上原来的 `Range` 头，把状态码和 `Content-Type` / `Content-Range` / `Content-Length` 转回去。

- [ ] **Step 2: 核对**

Run: `npm run build`  
Expected: 退出码 0。

- [ ] **Step 3: Commit**

```bash
git add src/library/openSong.ts
git commit -m "feat: stream a library song from disk or the audio script"
```

---

### Task 8: 缓存、封面、歌词

**Files:**
- Create: `src/library/cache.ts`
- Create: `src/library/artwork.ts`

**Interfaces:**
- Consumes: `downloadFile`（`src/download/downloader.ts`）、`getLyricForMusic`、`getPicForMusic`、`createOpenSong` 使用的同一套平台选择
- Produces:

```ts
export async function cacheSong(opts: {
  pool: pg.Pool
  songId: string
  cacheDir: string
  replace: boolean
  resolveUrl: (songId: string) => Promise<{ url: string; quality: Quality } | null>
}): Promise<{ path: string } | { skipped: 'has-file' }>

export async function cachePlaylist(opts: {
  pool: pg.Pool
  playlistId: string
  cacheDir: string
  replace: boolean
  resolveUrl: (songId: string) => Promise<{ url: string; quality: Quality } | null>
}): Promise<{ cached: number; skipped: number; failed: number }>

export async function coverFile(opts: {
  pool: pg.Pool
  albumId: string
  dataDir: string
  fetchPic: (music: MusicInfo) => Promise<string | null>
}): Promise<{ path: string } | null>

export async function lyricText(opts: {
  pool: pg.Pool
  songId: string
  fetchLyric: (music: MusicInfo) => Promise<{ lyric: string; tlyric: string }>
}): Promise<{ lyric: string; tlyric: string }>
```

- [ ] **Step 1: 缓存不进扫描根**

`cacheSong`：已有未缺失文件且 `replace === false` 时返回 `{ skipped: 'has-file' }`。否则 `resolveUrl`，`downloadFile` 写到 `cacheDir/<songId>.<ext>`，`ext` 用 `getExt(quality)`。写完后 `INSERT INTO media_files ... ON CONFLICT (song_id) DO UPDATE`，`missing = false`。不要删除别的歌的文件。`cachePlaylist` 按 `playlist_items.position` 逐首调用，一首失败计 `failed` 并继续。

`coverFile`：`albums.cover_path` 已有且文件在，直接返回。否则用该专辑第一首的 `song_sources.raw` 调 `fetchPic`。得到 http(s) 后下载到 `dataDir/covers/<albumId>`，写入 `cover_path`。失败返回 `null`，不改歌曲。

`lyricText`：`songs.lyric` 非空就直接返回。否则刮一次，成功则写入 `lyric` 与 `tlyric`。失败返回空字符串，不改行。

- [ ] **Step 2: 核对**

Run: `npm run build`  
Expected: 退出码 0。

- [ ] **Step 3: Commit**

```bash
git add src/library/cache.ts src/library/artwork.ts
git commit -m "feat: cache audio and store cover art and lyrics"
```

---

### Task 9: Subsonic 信封与鉴权

**Files:**
- Create: `src/library/password.ts`
- Create: `src/subsonic/respond.ts`
- Create: `src/subsonic/auth.ts`

**Interfaces:**
- Consumes: `settings` 表、`getConnInfo`（`@hono/node-server/conninfo`）
- Produces:

```ts
export async function setSubsonicPassword(dataDir: string, pool: pg.Pool, password: string): Promise<void>
export async function readSubsonicPassword(dataDir: string, pool: pg.Pool): Promise<string | null>

export function sendOk(c: Context, body: Record<string, unknown>, format: 'json' | 'xml'): Response
export function sendErr(c: Context, code: number, message: string, format: 'json' | 'xml'): Response

export async function requireSubsonic(c: Context, deps: { dataDir: string; pool: pg.Pool }): Promise<{ format: 'json' | 'xml' } | Response>
```

- [ ] **Step 1: 口令可还原，响应里不出现**

`dataDir/subsonic.key` 不存在就 `randomBytes(32)` 写进去，权限只给当前用户。`setSubsonicPassword` 用 AES-256-GCM 加密，`settings` 键 `subsonicPassword` 存 `iv.tag.ciphertext` 的 base64。`subsonicUser` 缺省时当作 `tinggui`。不要做单向哈希：客户端的 `t` 是 `md5(口令 + salt)`，校验时必须拿回口令。

`requireSubsonic` 读查询参数 `f`，`xml` 用 XML，其余用 JSON。版本固定 `1.16.1`，`type` 为 `tinggui`，`serverVersion` 为 `0.1.0`。

失败体：

```json
{ "subsonic-response": { "status": "failed", "version": "1.16.1", "type": "tinggui", "serverVersion": "0.1.0", "error": { "code": 40, "message": "Wrong username or password" } } }
```

XML 用同名元素和属性。文本做 XML 转义。

鉴权：

- 有 `x-forwarded-for` 或 `forwarded` 头时，不算回环。
- 否则 `getConnInfo(c).remote.address` 是 `127.0.0.1` 或 `::1` 才算回环。
- `readSubsonicPassword` 为 `null`：只有回环通过，不检查 `u` / `p` / `t`。非回环返回码 40。
- 有口令：`u` 必须等于 `subsonicUser`。`t` 与 `s` 都在时，用 `md5(password + s)` 的十六进制小写比对 `t`。否则 `p` 以 `enc:` 开头就按 hex 解码，其余当明文，必须与口令一致。失败返回码 40。

`ping` 不在这一项注册，下一项用 `requireSubsonic`。

- [ ] **Step 2: 核对**

Run: `npm run build`  
Expected: 退出码 0。

- [ ] **Step 3: Commit**

```bash
git add src/library/password.ts src/subsonic/respond.ts src/subsonic/auth.ts
git commit -m "feat: add Subsonic auth and response envelope"
```

---

### Task 10: 浏览与播放接口

**Files:**
- Create: `src/subsonic/routes.ts`
- Modify: `src/serve.ts`（`createAppContext` 在 SQLite 之外 `openPool` + `migrate`，把 `mountSubsonic` 挂到 Hono；旧路由先留着）

**Interfaces:**
- Consumes: `requireSubsonic`、`sendOk`、`sendErr`、`createOpenSong`、`coverFile`、`lyricText`
- Produces: `mountSubsonic(app: Hono, deps): void`，路径前缀 `/rest`

- [ ] **Step 1: 注册这些 `.view`**

查询参数走 GET。每个处理函数先 `requireSubsonic`。

| 路径 | 行为 |
| --- | --- |
| `ping` | 空的成功信封 |
| `getLicense` | `license.valid=true`，`email=tinggui@localhost`，`licenseExpires=2099-12-31T00:00:00.000Z` |
| `getOpenSubsonicExtensions` | 只返回一项，名字 `songLyrics` |
| `getUser` | 用户名 `tinggui`（或设置里的 `subsonicUser`），`adminRole=true`，其余角色 false |
| `getMusicFolders` | 一个文件夹，`id=1`，`name=听柜` |
| `getIndexes` | 歌手按首字符分组。ASCII 字母大写，其他字符用原字符，对不上的进 `#`。目录 id 用 `ar-<艺术家 id>` |
| `getMusicDirectory` | `id=1` 时子项是歌手，id 为 `ar-<id>`；`ar-<id>` 时子项是专辑，id 为 `al-<专辑 id>`；`al-<id>` 时子项是歌曲，歌曲 `id` 仍是十进制数字。三种表的 bigint 会重复，所以目录 id 必须带前缀 |
| `getArtists` | 与索引同一批歌手，带 `albumCount` |
| `getArtist` | 查询 `id`，专辑列表 |
| `getAlbum` | 查询 `id`，歌曲列表，`songCount`、`duration`（秒） |
| `getSong` | 一首歌 |
| `getAlbumList2` | 见下表 |
| `getStarred2` | 收藏的歌手、专辑、歌曲 |
| `getRandomSongs` | `size` 默认 10，最大 50 |
| `stream` 与 `download` | 都调用 `openSong.open(id, Range)` |
| `getCoverArt` | `id` 当专辑 id。没有文件就 `coverFile`。仍没有则 404 |
| `getLyrics` | 查询 `artist` + `title`，没有则空 `lyrics` |
| `getLyricsBySongId` | 查询 `id`。有歌词则 `structuredLyrics` 里放原文；`tlyric` 非空再放一条译文。没有歌词则空数组 |

`getAlbumList2` 的 `type`：

| type | 数据 |
| --- | --- |
| `alphabeticalByName` | 专辑名 |
| `alphabeticalByArtist` | 专辑歌手名，再专辑名 |
| `newest` | `songs.created_at` 最新的专辑 |
| `recent` | 最近一条 `scrobbles` 涉及的专辑 |
| `frequent` | 按 `scrobbles` 条数 |
| `random` | 随机专辑 |
| `starred` | `stars.target_type='album'` |
| `byYear`、`byGenre`、`highest` | 成功，`albumList2` 为空 |

歌曲对象字段：`id`、`parent`（专辑 id）、`title`、`album`、`artist`（多歌手用 `、` 接回）、`duration`（秒，时长空则 0）、`isDir=false`、`type=music`、`coverArt`（专辑 id）。不要编造年份、风格、评分。

- [ ] **Step 2: 核对**

Run: `npm run build`  
Expected: 退出码 0。

启动 `npm run dev` 后，本机：

```text
GET /rest/ping.view?f=json
GET /rest/getLicense.view?f=json
```

Expected: `status` 为 `ok`，`license.valid` 为 `true`。未设置口令时，这两个请求从本机发出就能通过。

- [ ] **Step 3: Commit**

```bash
git add src/subsonic/routes.ts src/serve.ts
git commit -m "feat: serve Subsonic browse, stream, cover, and lyrics"
```

---

### Task 11: 歌单、搜索、收藏、播放记录

**Files:**
- Modify: `src/subsonic/routes.ts`

**Interfaces:**
- Consumes: Task 10 的 `mountSubsonic`
- Produces: 同一文件里再注册下面的路径

- [ ] **Step 1: 订阅歌单只读**

| 路径 | 行为 |
| --- | --- |
| `getPlaylists` | 两种 `kind` 都返回。订阅歌单带 `comment=subscription` |
| `getPlaylist` | 按 `playlist_items.position` 返回歌曲 |
| `createPlaylist` | 插入 `kind=user`。查询参数 `songId` 可重复，按出现顺序写入 `playlist_items`。`name` 缺省时用 `新建歌单` |
| `updatePlaylist` | `playlistId` 对应 `kind=subscription` 时 `sendErr(..., 50, 'subscription playlist is read-only')`。用户歌单：有 `name` 就改名；带了 `songId` 就按新列表替换成员；没带 `songId` 就只改名 |
| `deletePlaylist` | 订阅歌单同样返回码 50。用户歌单删除行，级联删 `playlist_items`，不删歌曲和文件 |
| `search2` 与 `search3` | 只查库。`query` 用 `ILIKE '%' \|\| query \|\| '%'` 匹配歌曲标题、专辑名、歌手名。`artistCount` / `albumCount` / `songCount` 默认 20。不要调用 `createSearchService` |
| `star` | `id` → song，`albumId` → album，`artistId` → artist。可同时有多个。`INSERT ... ON CONFLICT DO NOTHING` |
| `unstar` | 删除对应 `stars` 行 |
| `scrobble` | `submission` 不是 `false` 时插入 `scrobbles`。`submission=false` 时成功返回、不插入 |

- [ ] **Step 2: 核对**

Run: `npm run build`  
Expected: 退出码 0。

插入一条 `kind=subscription` 的歌单后：

```text
GET /rest/deletePlaylist.view?id=<id>&f=json
```

Expected: `status=failed` 且 `error.code=50`，该歌单行还在。

- [ ] **Step 3: Commit**

```bash
git add src/subsonic/routes.ts
git commit -m "feat: add Subsonic playlists, library search, stars, and scrobbles"
```

---

### Task 12: 管理接口、定时、拆掉旧同步

**Files:**
- Create: `src/http/manage.ts`
- Modify: `src/serve.ts`
- Modify: `src/http/app.ts`（去掉 `/api/playlists`、`/api/sync`、`/api/jobs`、`/api/downloads` 以及只为这些路由服务的辅助函数）
- Modify: `docs/deploy.md`
- Delete: `test/sync.test.ts`、`test/db.test.ts`、`test/refreshPlaylist.test.ts`
- Modify: `test/http.test.ts`、`test/stream.test.ts`、`test/cli.test.ts`、`test/cron.test.ts`：只删除已不存在路由或已删除 SQLite 入口的用例，不要为曲库新写用例

**Interfaces:**
- Consumes: `createSubscription`、`refreshSubscription`、`scanRoot`、`cacheSong`、`cachePlaylist`、`createJobQueue`、`createSearchService`、`setSubsonicPassword`、`startCron`
- Produces: `mountManage(app, deps): void`

- [ ] **Step 1: 管理路由**

全部 JSON。

| 方法与路径 | 行为 |
| --- | --- |
| `POST /api/subscriptions` | body `{ platform, sourceUrl }`，调用 `createSubscription` |
| `GET /api/subscriptions` | 列出 `kind=subscription` |
| `POST /api/subscriptions/:id/refresh` | `enqueue('refresh-subscription', ...)` |
| `DELETE /api/subscriptions/:id` | 删除歌单行。不删歌曲，不删缓存文件 |
| `GET /api/search` | 沿用现在的刮削搜索参数 `q`、`source`、`page` |
| `POST /api/library/tracks` | body 是一条 `MusicInfo`。`ingestTrackFromMusic` + `upsertTrack` 在请求里做完，不 `enqueue` |
| `POST /api/library/roots` | body `{ path }`，插入 `library_roots` |
| `DELETE /api/library/roots/:id` | 只删根 |
| `POST /api/library/scan` | `enqueue('scan')`，对每个根调用 `scanRoot`。`result` 汇总 `unmerged` 与 `unreadable` |
| `POST /api/cache/songs/:id` | `enqueue('cache-song')` |
| `POST /api/cache/playlists/:id` | `enqueue('cache-playlist')` |
| `POST /api/cache/songs/:id/recache` | `enqueue('recache')`，`replace: true` |
| `GET /api/jobs/:id` | 返回 `jobs` 行 |
| `PUT /api/settings` | 接受 `quality`、`sourceOrder`（逗号分隔的五个平台）、`scheduleOn`、`schedule`、`scheduleTime`、`cron`、`scanWithSchedule`（`'0'` 或 `'1'`）、`subsonicUser`、`subsonicPassword`。口令走 `setSubsonicPassword`，响应里不回传口令 |
| 音源脚本上传与 URL 安装 | 保持现在的 `/api/settings/user-api` 与 `/api/settings/user-api/url` |

`startCron` 的回调从 `syncAll` 改成：定时开启时，把每份订阅 `enqueue('refresh-subscription')`；`scanWithSchedule==='1'` 时再 `enqueue('scan')`。不要在定时里缓存。

`createAppContext` 不再 `openDb`。`src/services/sync.ts` 若已无引用就删文件。`src/services/stream.ts` 若只被删掉的 `/api/stream` 使用，也删掉，Subsonic 继续用 `openSong`。播放器网页会暂时失去 `/api/stream`，这是规格里「网页另写」的结果，不要在这项里补一个兼容层。

`docs/deploy.md` 写上：服务器要单独安装 Postgres；`config.yaml` 要有 `databaseUrl`；默认仍只听 `127.0.0.1`；对外监听前先设 Subsonic 口令，没设口令时非回环请求鉴权失败。删掉「编译 better-sqlite3」这条前置条件。PM2 仍是单实例。

- [ ] **Step 2: 核对**

Run: `npm run build`  
Expected: 退出码 0。

Run: `npm test`  
Expected: 退出码 0。失败的只应是还在引用已删模块的旧用例；把那些用例删掉，不要改成曲库用例。然后再跑到退出码 0。

手动：

1. `GET /rest/ping.view?f=json` 本机成功。
2. 插入歌手、专辑、歌曲后，`getArtists` / `getArtist` / `getAlbum` 能看见这首歌。
3. 给这首歌写入一个真实小文件的 `media_files`，`stream.view?id=` 返回文件字节。
4. 删掉该文件行、留下 `song_sources`，在音源脚本可用时 `stream.view` 能返回音频响应；脚本不可用时是 404，歌曲行还在。
5. 订阅刷新用会抛错的 `getListDetail` 时，`playlist_items` 条数不变。

- [ ] **Step 3: Commit**

```bash
git add src/http/manage.ts src/serve.ts src/http/app.ts docs/deploy.md test
git commit -m "feat: add library management API and drop SQLite sync routes"
```

提交前再看 `git status`，确认没有 `config.yaml`、`data/`、`web/dist/`。
