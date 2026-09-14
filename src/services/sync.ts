import { existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { createRepos, DownloadRow, JobRow, PlaylistRow, TrackRow } from '../db/repos.js'
import type { DownloadFileOptions } from '../download/downloader.js'
import { formatFileName, getExt, pickQuality, safeDirName } from '../lib/names.js'
import type { MusicInfo, Quality } from '../types.js'
import type { SourceStatus } from '../userApi/runtime.js'

export type SyncProgress = {
  /** Tracks finished (scanned) in the active job. */
  trackDone: number
  /** Tracks expected in the active job (grows as syncAll refreshes playlists). */
  trackTotal: number
  /** 0–100 from trackDone / trackTotal. */
  percent: number
  songKey: string | null
  downloaded: number
  byteTotal: number | null
}

type Repos = ReturnType<typeof createRepos>

export type SyncDeps = {
  repos: Repos
  refreshPlaylistSnapshot: (playlistId: number) => Promise<PlaylistRow>
  getMusicUrl: (
    source: string,
    musicInfo: MusicInfo,
    quality: Quality,
  ) => Promise<{ type: Quality; url: string }>
  getSourceStatus: () => SourceStatus
  downloadFile: (opts: DownloadFileOptions) => Promise<void>
}

type ErrorItem = { song_key: string; message: string }

type Counters = {
  scanned: number
  skipped: number
  downloaded: number
  failed: number
  errors: ErrorItem[]
}

function clampConcurrency(raw: string | undefined): number {
  const n = Number(raw ?? '3')
  if (!Number.isFinite(n)) return 3
  return Math.min(6, Math.max(1, Math.trunc(n)))
}

function parseMusic(track: TrackRow): MusicInfo {
  try {
    return JSON.parse(track.raw) as MusicInfo
  } catch {
    return {
      id: track.song_key,
      name: track.name,
      singer: track.singer,
      source: track.song_key.split('_')[0] as MusicInfo['source'],
      interval: null,
      meta: {},
    }
  }
}

function songQualitiesOf(music: MusicInfo): Partial<Record<Quality, unknown>> {
  const q = music.meta._qualitys
  if (q && typeof q === 'object') return q as Partial<Record<Quality, unknown>>
  return {}
}

function fileNamePattern(settings: Record<string, string>): 'name-singer' | 'singer-name' | 'name' {
  const v = settings.fileName
  if (v === 'singer-name' || v === 'name') return v
  return 'name-singer'
}

function buildFileName(settings: Record<string, string>, name: string, singer: string, quality: Quality): string {
  return `${formatFileName(fileNamePattern(settings), name, singer)}.${getExt(quality)}`
}

function playlistSaveDir(playlist: PlaylistRow): string {
  return playlist.save_dir || safeDirName(playlist.name || 'unnamed')
}

function metaFieldsFromMusic(music: MusicInfo, name?: string, singer?: string) {
  return {
    name: name || music.name || '',
    singer: singer || music.singer || '',
    source: String(music.source || ''),
    pic_url: String(music.meta?.picUrl || ''),
    raw: JSON.stringify(music),
  }
}

async function mapPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  if (items.length === 0) return
  const queue = items.slice()
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift()
      if (item === undefined) return
      await fn(item)
    }
  })
  await Promise.all(workers)
}

export function createSyncService(deps: SyncDeps) {
  const { repos } = deps
  let progress: SyncProgress | null = null
  let jobTrackDone = 0
  let jobTrackTotal = 0
  let draining = false
  const queue: Array<() => Promise<void>> = []

  function emptyCounters(): Counters {
    return { scanned: 0, skipped: 0, downloaded: 0, failed: 0, errors: [] }
  }

  function mergeCounters(into: Counters, from: Counters): void {
    into.scanned += from.scanned
    into.skipped += from.skipped
    into.downloaded += from.downloaded
    into.failed += from.failed
    into.errors.push(...from.errors)
  }

  function calcPercent(done: number, total: number): number {
    if (total <= 0) return 0
    return Math.min(100, Math.round((done / total) * 100))
  }

  function patchProgress(partial: Partial<SyncProgress>): void {
    const base: SyncProgress = progress ?? {
      trackDone: 0,
      trackTotal: 0,
      percent: 0,
      songKey: null,
      downloaded: 0,
      byteTotal: null,
    }
    const next = { ...base, ...partial }
    next.percent = calcPercent(next.trackDone, next.trackTotal)
    progress = next
  }

  function bumpTrackProgress(done: number): void {
    patchProgress({
      trackDone: done,
      songKey: progress?.songKey ?? null,
      downloaded: progress?.downloaded ?? 0,
      byteTotal: progress?.byteTotal ?? null,
    })
  }

  async function processTrack(opts: {
    track: TrackRow
    playlist: PlaylistRow | null
    saveDir: string
    sourceKind: 'playlist' | 'search'
    playlistId: number | null
    settings: Record<string, string>
    sourceOk: boolean
    sourceStatus: SourceStatus
    counters: Counters
    jobId: number
  }): Promise<void> {
    const {
      track,
      playlist,
      saveDir,
      sourceKind,
      playlistId,
      settings,
      sourceOk,
      sourceStatus,
      counters,
      jobId,
    } = opts

    counters.scanned++
    const music = parseMusic(track)
    const savePath = settings.savePath || './data/music'
    const wanted = (settings.quality || '320k') as Quality
    const sourceKey = String(music.source)
    const sourceQualities = (sourceStatus.sources[sourceKey]?.qualitys ?? []) as Quality[]
    const quality = pickQuality(wanted, sourceQualities.length ? sourceQualities : [wanted], songQualitiesOf(music))
    const fileName = buildFileName(settings, track.name || music.name, track.singer || music.singer, quality)
    const destPath = join(savePath, saveDir, fileName)

    const finishTrack = () => {
      jobTrackDone++
      bumpTrackProgress(jobTrackDone)
      bumpJob(jobId, counters)
    }

    const existing = repos.downloads.get(track.song_key)
    if (existing && existsSync(existing.file_path)) {
      // Refresh meta (name/cover/raw) even when the file is already on disk.
      repos.downloads.upsert({
        ...existing,
        ...metaFieldsFromMusic(music, track.name, track.singer),
      })
      counters.skipped++
      finishTrack()
      return
    }

    if (!existing && existsSync(destPath)) {
      try {
        if (statSync(destPath).size > 100) {
          repos.downloads.upsert({
            song_key: track.song_key,
            file_path: destPath,
            quality,
            playlist_id: playlistId,
            source_kind: sourceKind,
            completed_at: Date.now(),
            ...metaFieldsFromMusic(music, track.name, track.singer),
          })
          counters.skipped++
          finishTrack()
          return
        }
      } catch {
        /* fall through to download */
      }
    }

    if (!sourceOk) {
      counters.failed++
      counters.errors.push({ song_key: track.song_key, message: '源不可用' })
      finishTrack()
      return
    }

    try {
      const { url, type } = await deps.getMusicUrl(sourceKey, music, quality)
      const actualQuality = type || quality
      const actualName = buildFileName(
        settings,
        track.name || music.name,
        track.singer || music.singer,
        actualQuality,
      )
      const actualDest = join(savePath, saveDir, actualName)
      mkdirSync(dirname(actualDest), { recursive: true })
      patchProgress({
        songKey: track.song_key,
        downloaded: 0,
        byteTotal: null,
        trackDone: jobTrackDone,
        trackTotal: jobTrackTotal,
      })
      await deps.downloadFile({
        url,
        destPath: actualDest,
        onProgress: p => {
          patchProgress({
            songKey: track.song_key,
            downloaded: p.downloaded,
            byteTotal: p.total,
            trackDone: jobTrackDone,
            trackTotal: jobTrackTotal,
          })
        },
      })
      repos.downloads.upsert({
        song_key: track.song_key,
        file_path: actualDest,
        quality: actualQuality,
        playlist_id: playlistId ?? playlist?.id ?? null,
        source_kind: sourceKind,
        completed_at: Date.now(),
        ...metaFieldsFromMusic(music, track.name, track.singer),
      })
      counters.downloaded++
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      counters.failed++
      counters.errors.push({ song_key: track.song_key, message })
    }
    finishTrack()
  }

  function bumpJob(jobId: number, counters: Counters): void {
    repos.jobs.update({
      id: jobId,
      scanned: counters.scanned,
      skipped: counters.skipped,
      downloaded: counters.downloaded,
      failed: counters.failed,
      error_summary: counters.errors.length ? JSON.stringify(counters.errors) : null,
    })
  }

  async function syncOnePlaylist(
    playlistId: number,
    jobId: number,
    counters: Counters,
  ): Promise<void> {
    const settings = repos.settings.getAll()
    const sourceStatus = deps.getSourceStatus()

    let playlist: PlaylistRow
    try {
      playlist = await deps.refreshPlaylistSnapshot(playlistId)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      counters.failed++
      counters.errors.push({ song_key: `playlist:${playlistId}`, message })
      bumpJob(jobId, counters)
      throw err
    }

    playlist = repos.playlists.get(playlistId) ?? playlist
    const saveDir = playlistSaveDir(playlist)
    const tracks = repos.tracks.list(playlistId)
    const concurrency = clampConcurrency(settings.concurrency)

    jobTrackTotal += tracks.length
    patchProgress({
      trackTotal: jobTrackTotal,
      trackDone: jobTrackDone,
      songKey: null,
      downloaded: 0,
      byteTotal: null,
    })

    await mapPool(tracks, concurrency, async track => {
      await processTrack({
        track,
        playlist,
        saveDir,
        sourceKind: 'playlist',
        playlistId: playlist.id,
        settings,
        sourceOk: sourceStatus.ok,
        sourceStatus,
        counters,
        jobId,
      })
    })
  }

  async function runJob(
    kind: JobRow['kind'],
    playlistId: number | null,
    work: (job: JobRow, counters: Counters) => Promise<'success' | 'failed'>,
  ): Promise<JobRow> {
    jobTrackDone = 0
    jobTrackTotal = 0
    progress = {
      trackDone: 0,
      trackTotal: 0,
      percent: 0,
      songKey: null,
      downloaded: 0,
      byteTotal: null,
    }
    const now = Date.now()
    const job = repos.jobs.insert({
      kind,
      playlist_id: playlistId,
      status: 'running',
      started_at: now,
      finished_at: null,
      scanned: 0,
      skipped: 0,
      downloaded: 0,
      failed: 0,
      error_summary: null,
    })
    const counters = emptyCounters()
    try {
      const status = await work(job, counters)
      return repos.jobs.update({
        id: job.id,
        status,
        finished_at: Date.now(),
        scanned: counters.scanned,
        skipped: counters.skipped,
        downloaded: counters.downloaded,
        failed: counters.failed,
        error_summary: counters.errors.length ? JSON.stringify(counters.errors) : null,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (!counters.errors.some(e => e.message === message)) {
        counters.errors.push({
          song_key: playlistId != null ? `playlist:${playlistId}` : 'all',
          message,
        })
        counters.failed = Math.max(counters.failed, 1)
      }
      return repos.jobs.update({
        id: job.id,
        status: 'failed',
        finished_at: Date.now(),
        scanned: counters.scanned,
        skipped: counters.skipped,
        downloaded: counters.downloaded,
        failed: counters.failed,
        error_summary: JSON.stringify(counters.errors),
      })
    } finally {
      progress = null
    }
  }

  async function drainQueue(): Promise<void> {
    if (draining) return
    draining = true
    try {
      while (queue.length > 0) {
        const next = queue.shift()
        if (!next) continue
        await next()
      }
    } finally {
      draining = false
      if (queue.length > 0) {
        void drainQueue()
      }
    }
  }

  function enqueueJob(
    kind: JobRow['kind'],
    playlistId: number | null,
    work: (job: JobRow, counters: Counters) => Promise<'success' | 'failed'>,
  ): Promise<JobRow> {
    return new Promise<JobRow>((resolve, reject) => {
      queue.push(async () => {
        try {
          resolve(await runJob(kind, playlistId, work))
        } catch (err) {
          reject(err)
        }
      })
      void drainQueue()
    })
  }

  return {
    async syncPlaylist(id: number): Promise<JobRow> {
      return enqueueJob('playlist', id, async (job, counters) => {
        await syncOnePlaylist(id, job.id, counters)
        return 'success'
      })
    },

    async syncAll(): Promise<JobRow> {
      return enqueueJob('all', null, async (job, counters) => {
        const playlists = repos.playlists.list().filter(p => p.enabled === 1)
        for (const p of playlists) {
          const local = emptyCounters()
          try {
            await syncOnePlaylist(p.id, job.id, local)
            mergeCounters(counters, local)
            bumpJob(job.id, counters)
          } catch {
            mergeCounters(counters, local)
            bumpJob(job.id, counters)
            // continue next playlist
          }
        }
        return 'success'
      })
    },

    async downloadSearch(musicInfo: MusicInfo): Promise<DownloadRow & { alreadyHad?: boolean }> {
      let result: (DownloadRow & { alreadyHad?: boolean }) | undefined

      const job = await enqueueJob('search', null, async (jobRow, counters) => {
        const settings = repos.settings.getAll()
        const sourceStatus = deps.getSourceStatus()
        const savePath = settings.savePath || './data/music'
        const saveDir = 'search'
        const sourceKind = 'search' as const
        const { ensureMusicPic } = await import('./pic.js')
        const music = await ensureMusicPic(musicInfo)
        const meta = metaFieldsFromMusic(music)

        jobTrackDone = 0
        jobTrackTotal = 1
        patchProgress({
          trackDone: 0,
          trackTotal: 1,
          songKey: music.id,
          downloaded: 0,
          byteTotal: null,
        })

        const existing = repos.downloads.get(music.id)
        if (existing && existsSync(existing.file_path)) {
          counters.scanned = 1
          counters.skipped = 1
          bumpJob(jobRow.id, counters)
          jobTrackDone = 1
          bumpTrackProgress(1)
          const row = { ...existing, ...meta }
          repos.downloads.upsert(row)
          result = { ...row, alreadyHad: true }
          return 'success'
        }

        if (!sourceStatus.ok) {
          counters.scanned = 1
          counters.failed = 1
          counters.errors.push({ song_key: music.id, message: '源不可用' })
          bumpJob(jobRow.id, counters)
          throw new Error('源不可用')
        }

        const wanted = (settings.quality || '320k') as Quality
        const sourceKey = String(music.source)
        const sourceQualities = (sourceStatus.sources[sourceKey]?.qualitys ?? []) as Quality[]
        const quality = pickQuality(
          wanted,
          sourceQualities.length ? sourceQualities : [wanted],
          songQualitiesOf(music),
        )

        try {
          const { url, type } = await deps.getMusicUrl(sourceKey, music, quality)
          const actualQuality = type || quality
          const fileName = buildFileName(settings, music.name, music.singer, actualQuality)
          const destPath = join(savePath, saveDir, fileName)

          if (!existing && existsSync(destPath) && statSync(destPath).size > 100) {
            const row: DownloadRow = {
              song_key: music.id,
              file_path: destPath,
              quality: actualQuality,
              playlist_id: null,
              source_kind: sourceKind,
              completed_at: Date.now(),
              ...meta,
            }
            repos.downloads.upsert(row)
            counters.scanned = 1
            counters.skipped = 1
            bumpJob(jobRow.id, counters)
            jobTrackDone = 1
            bumpTrackProgress(1)
            result = { ...row, alreadyHad: true }
            return 'success'
          }

          mkdirSync(dirname(destPath), { recursive: true })
          patchProgress({
            songKey: music.id,
            downloaded: 0,
            byteTotal: null,
            trackDone: 0,
            trackTotal: 1,
          })
          await deps.downloadFile({
            url,
            destPath,
            onProgress: p => {
              patchProgress({
                songKey: music.id,
                downloaded: p.downloaded,
                byteTotal: p.total,
                trackDone: 0,
                trackTotal: 1,
              })
            },
          })

          const row: DownloadRow = {
            song_key: music.id,
            file_path: destPath,
            quality: actualQuality,
            playlist_id: null,
            source_kind: sourceKind,
            completed_at: Date.now(),
            ...meta,
          }
          repos.downloads.upsert(row)
          counters.scanned = 1
          counters.downloaded = 1
          bumpJob(jobRow.id, counters)
          jobTrackDone = 1
          bumpTrackProgress(1)
          result = row
          return 'success'
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          counters.scanned = 1
          counters.failed = 1
          counters.errors.push({ song_key: music.id, message })
          bumpJob(jobRow.id, counters)
          throw err
        }
      })

      if (job.status === 'failed' || !result) {
        let message = '下载失败'
        try {
          const errors = job.error_summary ? (JSON.parse(job.error_summary) as { message?: string }[]) : []
          if (errors[0]?.message) message = errors[0].message
        } catch {
          /* keep */
        }
        throw new Error(message)
      }
      return result
    },

    getRunningProgress(): SyncProgress | null {
      return progress
    },
  }
}
