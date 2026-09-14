import { describe, expect, it } from 'vitest'
import { createSearchService } from '../src/services/search'

describe('searchMusic all', () => {
  it('merges and dedups by id, swallows one source error', async () => {
    const svc = createSearchService({
      wy: {
        musicSearch: {
          search: async () => ({
            list: [{ id: 'wy_1', name: 'a', singer: 's', source: 'wy', interval: null, meta: {} }],
            total: 1,
            allPage: 1,
            limit: 30,
            source: 'wy',
          }),
        },
      },
      tx: {
        musicSearch: {
          search: async () => {
            throw new Error('down')
          },
        },
      },
    } as any)
    const res = await svc.searchMusic('all', 'a', 1)
    expect(res.list.map(x => x.id)).toEqual(['wy_1'])
  })

  it('dedups duplicate ids across sources', async () => {
    const svc = createSearchService({
      wy: {
        musicSearch: {
          search: async () => ({
            list: [
              { id: 'x_1', name: 'a', singer: 's', source: 'wy', interval: null, meta: {} },
              { id: 'x_2', name: 'b', singer: 's', source: 'wy', interval: null, meta: {} },
            ],
            total: 2,
            allPage: 1,
            limit: 30,
            source: 'wy',
          }),
        },
      },
      kg: {
        musicSearch: {
          search: async () => ({
            list: [{ id: 'x_1', name: 'a2', singer: 's', source: 'kg', interval: null, meta: {} }],
            total: 1,
            allPage: 1,
            limit: 30,
            source: 'kg',
          }),
        },
      },
    } as any)
    const res = await svc.searchMusic('all', 'a', 1)
    expect(res.list.map(x => x.id)).toEqual(['x_1', 'x_2'])
    expect(res.total).toBe(2)
  })
})
