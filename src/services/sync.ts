import { existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { createRepos, DownloadRow, JobRow, PlaylistRow, TrackRow } from '../db/repos.js'
import type { DownloadFileOptions } from '../download/downloader.js'
import { formatFileName, getExt, pickQuality, safeDirName } from '../lib/names.js'
import type { MusicInfo, Quality } from '../types.js'
import type { SourceStatus } from '../userApi/runtime.js'

export type SyncProgress = {
  songKey: string
  downloaded: number
  total: number | null
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
  let locked = false
  let progress: SyncProgress | null = null

  function insertSkippedJob(kind: JobRow['kind'], playlistId: number | null): JobRow {
    const now = Date.now()
    return repos.jobs.insert({
      kind,
      playlist_id: playlistId,
      status: 'skipped',
      started_at: now,
      finished_at: now,
      scanned: 0,
      skipped: 0,
      downloaded: 0,
      failed: 0,
      error_summary: null,
    })
  }

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

    const existing = repos.downloads.get(track.song_key)
    if (existing && existsSync(existing.file_path)) {
      counters.skipped++
      bumpJob(jobId, counters)
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
          })
          counters.skipped++
          bumpJob(jobId, counters)
          return
        }
      } catch {
        /* fall through to download */
      }
    }

    if (!sourceOk) {
      counters.failed++
      counters.errors.push({ song_key: track.song_key, message: '源不可用' })
      bumpJob(jobId, counters)
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
      progress = { songKey: track.song_key, downloaded: 0, total: null }
      await deps.downloadFile({
        url,
        destPath: actualDest,
        onProgress: p => {
          progress = { songKey: track.song_key, downloaded: p.downloaded, total: p.total }
        },
      })
      repos.downloads.upsert({
        song_key: track.song_key,
        file_path: actualDest,
        quality: actualQuality,
        playlist_id: playlistId ?? playlist?.id ?? null,
        source_kind: sourceKind,
        completed_at: Date.now(),
      })
      counters.downloaded++
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      counters.failed++
      counters.errors.push({ song_key: track.song_key, message })
    }
    bumpJob(jobId, counters)
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

  async function runLocked(
    kind: JobRow['kind'],
    playlistId: number | null,
    work: (job: JobRow, counters: Counters) => Promise<'success' | 'failed'>,
  ): Promise<JobRow> {
    if (locked) {
      return insertSkippedJob(kind, playlistId)
    }
    locked = true
    progress = null
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
        counters.errors.push({ song_key: playlistId != null ? `playlist:${playlistId}` : 'all', message })
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
      locked = false
      progress = null
    }
  }

  return {
    async syncPlaylist(id: number): Promise<JobRow> {
      return runLocked('playlist', id, async (job, counters) => {
        await syncOnePlaylist(id, job.id, counters)
        return 'success'
      })
    },

    async syncAll(): Promise<JobRow> {
      return runLocked('all', null, async (job, counters) => {
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

    async downloadSearch(musicInfo: MusicInfo): Promise<DownloadRow> {
      const settings = repos.settings.getAll()
      const sourceStatus = deps.getSourceStatus()
      const savePath = settings.savePath || './data/music'
      const saveDir = 'search'
      const sourceKind = 'search' as const

      const existing = repos.downloads.get(musicInfo.id)
      if (existing && existsSync(existing.file_path)) {
        return existing
      }

      if (!sourceStatus.ok) {
        throw new Error('源不可用')
      }

      const wanted = (settings.quality || '320k') as Quality
      const sourceKey = String(musicInfo.source)
      const sourceQualities = (sourceStatus.sources[sourceKey]?.qualitys ?? []) as Quality[]
      const quality = pickQuality(
        wanted,
        sourceQualities.length ? sourceQualities : [wanted],
        songQualitiesOf(musicInfo),
      )

      const { url, type } = await deps.getMusicUrl(sourceKey, musicInfo, quality)
      const actualQuality = type || quality
      const fileName = buildFileName(settings, musicInfo.name, musicInfo.singer, actualQuality)
      const destPath = join(savePath, saveDir, fileName)

      if (!existing && existsSync(destPath) && statSync(destPath).size > 100) {
        const row: DownloadRow = {
          song_key: musicInfo.id,
          file_path: destPath,
          quality: actualQuality,
          playlist_id: null,
          source_kind: sourceKind,
          completed_at: Date.now(),
        }
        repos.downloads.upsert(row)
        return row
      }

      mkdirSync(dirname(destPath), { recursive: true })
      progress = { songKey: musicInfo.id, downloaded: 0, total: null }
      try {
        await deps.downloadFile({
          url,
          destPath,
          onProgress: p => {
            progress = { songKey: musicInfo.id, downloaded: p.downloaded, total: p.total }
          },
        })
      } finally {
        progress = null
      }

      const row: DownloadRow = {
        song_key: musicInfo.id,
        file_path: destPath,
        quality: actualQuality,
        playlist_id: null,
        source_kind: sourceKind,
        completed_at: Date.now(),
      }
      repos.downloads.upsert(row)
      return row
    },

    getRunningProgress(): SyncProgress | null {
      return progress
    },
  }
}
