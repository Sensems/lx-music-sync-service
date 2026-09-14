import { describe, expect, it } from 'vitest'
import { startCron } from '../src/serve.js'

describe('startCron', () => {
  it('does not schedule when scheduleOn is 0', () => {
    const scheduled: string[] = []
    startCron({
      getSettings: () => ({ scheduleOn: '0', cron: '* * * * *' }),
      schedule(expr, _fn) {
        scheduled.push(expr)
        return { stop() {} }
      },
      syncAll: async () => {},
    })
    expect(scheduled).toEqual([])
  })

  it('uses 0 */6 * * * for every-6h', () => {
    const scheduled: string[] = []
    startCron({
      getSettings: () => ({ scheduleOn: '1', schedule: 'every-6h', cron: '' }),
      schedule(expr) {
        scheduled.push(expr)
        return { stop() {} }
      },
      syncAll: async () => {},
    })
    expect(scheduled).toEqual(['0 */6 * * *'])
  })

  it('uses 0 3 * * * for daily and user cron string for cron', () => {
    const scheduled: string[] = []
    startCron({
      getSettings: () => ({ scheduleOn: '1', schedule: 'daily', cron: 'ignored' }),
      schedule(expr) {
        scheduled.push(expr)
        return { stop() {} }
      },
      syncAll: async () => {},
    })
    expect(scheduled).toEqual(['0 3 * * *'])

    scheduled.length = 0
    startCron({
      getSettings: () => ({ scheduleOn: '1', schedule: 'daily', scheduleTime: '14:30', cron: '' }),
      schedule(expr) {
        scheduled.push(expr)
        return { stop() {} }
      },
      syncAll: async () => {},
    })
    expect(scheduled).toEqual(['30 14 * * *'])

    scheduled.length = 0
    const handle = startCron({
      getSettings: () => ({ scheduleOn: '1', schedule: 'cron', cron: '15 4 * * *' }),
      schedule(expr) {
        scheduled.push(expr)
        return { stop() {} }
      },
      syncAll: async () => {},
    })
    expect(scheduled).toEqual(['15 4 * * *'])

    scheduled.length = 0
    let on = '1'
    const reschedulable = startCron({
      getSettings: () => ({ scheduleOn: on, schedule: 'every-6h', cron: '' }),
      schedule(expr) {
        scheduled.push(expr)
        return { stop() {} }
      },
      syncAll: async () => {},
    })
    expect(scheduled).toEqual(['0 */6 * * *'])
    on = '0'
    reschedulable.reschedule()
    expect(scheduled).toEqual(['0 */6 * * *'])
    handle.stop()
    reschedulable.stop()
  })
})
