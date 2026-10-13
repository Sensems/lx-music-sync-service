import type { Pool } from 'pg'

export type JobKind = 'refresh-subscription' | 'scan' | 'cache-song' | 'cache-playlist' | 'recache'

type JobRun = (payload: Record<string, unknown>) => Promise<Record<string, unknown>>

type QueuedWork = {
  jobId: string
  payload: Record<string, unknown>
  run: JobRun
}

/**
 * 曲库后台任务同一时间只跑一个：刷新订阅、扫描、缓存会改同一批歌和文件。
 * 点播取地址不进这条队列，否则一次播放会排在扫描后面。
 */
export function createJobQueue(pool: Pool): {
  enqueue(
    kind: JobKind,
    payload: Record<string, unknown>,
    run: JobRun,
  ): Promise<{ jobId: string }>
} {
  // 上一段如果拒绝，下一段仍然要跑。不能让一次写库失败把整条链停住。
  let tail: Promise<void> = Promise.resolve()

  async function execute(work: QueuedWork): Promise<void> {
    // 每条状态各自借连接。扫描和缓存自己也要用池子，不能把连接占到 run 结束。
    try {
      await pool.query(
        `UPDATE jobs
         SET status = 'running', started_at = now()
         WHERE id = $1::bigint`,
        [work.jobId],
      )
      const result = await work.run(work.payload)
      await pool.query(
        `UPDATE jobs
         SET status = 'success', result = $2::jsonb, finished_at = now()
         WHERE id = $1::bigint`,
        [work.jobId, JSON.stringify(result ?? {})],
      )
    } catch (err) {
      // run 抛错，或状态写到一半失败，都要把行收成 failed。
      // 否则它会一直停在 queued / running，调用方也看不出已经结束。
      try {
        await pool.query(
          `UPDATE jobs
           SET status = 'failed', error_summary = $2, finished_at = now()
           WHERE id = $1::bigint`,
          [work.jobId, errorSummary(err)],
        )
      } catch {
        // 失败状态也写不进去。吞掉这一次，后面的任务才能继续。
      }
    }
  }

  async function enqueue(
    kind: JobKind,
    payload: Record<string, unknown>,
    run: JobRun,
  ): Promise<{ jobId: string }> {
    // 占位必须发生在第一个 await 之前。
    // 两个 enqueue 同时进来时，如果等插入完成再往链上挂，
    // 两边都会挂在同一段 tail 后面，两个 run 就会并行。
    const gate = defer<QueuedWork | null>()
    tail = tail
      .catch(() => undefined)
      .then(async () => {
        const work = await gate.promise
        if (!work) return
        try {
          await execute(work)
        } catch {
          // running / failed 写不回去也不能把链弄断，后面的任务还要继续。
        }
      })

    try {
      const inserted = await pool.query<{ id: string }>(
        `INSERT INTO jobs (kind, status, payload)
         VALUES ($1, 'queued', $2::jsonb)
         RETURNING id::text AS id`,
        [kind, JSON.stringify(payload)],
      )
      const jobId = inserted.rows[0]?.id
      if (!jobId) throw new Error('job insert did not return id')
      gate.resolve({ jobId, payload, run })
      return { jobId }
    } catch (err) {
      // 插入失败时放空这一格，否则链会一直等这个 gate。
      gate.resolve(null)
      throw err
    }
  }

  return { enqueue }
}

/**
 * 队列只活在这个进程里。重启后库里还会留着 queued / running，
 * 网页会一直轮询。启动时收成失败，调用方才能停下来。
 * 不要在 search 这类只借库的命令里调用：那会把正在跑的扫描标死。
 */
export async function failInterruptedJobs(pool: Pool): Promise<void> {
  await pool.query(
    `UPDATE jobs
     SET status = 'failed',
         error_summary = '进程重启，这次没有做完',
         finished_at = now()
     WHERE status IN ('queued', 'running')`,
  )
}

function defer<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

/** 任务抛错时只记 Error.message。不是 Error 的抛出也要留一句，避免摘要是空的。 */
function errorSummary(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
