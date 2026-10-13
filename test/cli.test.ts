import { describe, expect, it } from 'vitest'
import type { CliDeps } from '../src/cli.js'

function fakeDeps(overrides: Partial<CliDeps> = {}): CliDeps {
  const base: CliDeps = {
    search: {
      async searchMusic(_source, q, _page) {
        return {
          list: [
            {
              id: 'wy_1',
              name: q,
              singer: 'Artist',
              source: 'wy',
              interval: null,
              meta: {},
            },
          ],
          total: 1,
        }
      },
    },
    log: () => {},
    error: () => {},
  }

  return { ...base, ...overrides }
}

describe('runCli', () => {
  it('search prints json list', async () => {
    const { runCli } = await import('../src/cli.js')
    const logs: string[] = []
    await runCli(['search', '--source', 'all', '--q', '起风了'], {
      ...fakeDeps(),
      log: s => logs.push(s),
    })
    expect(logs.join('\n')).toMatch(/起风了/)
  })
})
