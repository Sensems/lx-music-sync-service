export type CronSettings = {
  scheduleOn?: string
  schedule?: string
  cron?: string
  /** HH:mm，daily 用；非法值回落到 03:00 */
  scheduleTime?: string
}

export const ALLOWED_SCHEDULES = ['every-6h', 'daily', 'cron'] as const
export type AllowedSchedule = (typeof ALLOWED_SCHEDULES)[number]

export function isAllowedSchedule(value: string | undefined): value is AllowedSchedule {
  return value === 'every-6h' || value === 'daily' || value === 'cron'
}

export function parseScheduleTime(raw: string | undefined): { hour: number; minute: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(raw ?? '').trim())
  if (!m) return { hour: 3, minute: 0 }
  const hour = Number(m[1])
  const minute = Number(m[2])
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return { hour: 3, minute: 0 }
  }
  return { hour, minute }
}

/**
 * 只有 schedule=cron 才用自定义表达式。
 * 残留的 cron 字符串不能盖住 every-6h / daily / 未知取值；未知取值回落到默认。
 */
export function resolveCronExpression(settings: CronSettings): string {
  if (settings.schedule === 'every-6h') return '0 */6 * * *'
  if (settings.schedule === 'daily') {
    const { hour, minute } = parseScheduleTime(settings.scheduleTime)
    return `${minute} ${hour} * * *`
  }
  if (settings.schedule === 'cron' && settings.cron?.trim()) return settings.cron.trim()
  return '0 */6 * * *'
}
