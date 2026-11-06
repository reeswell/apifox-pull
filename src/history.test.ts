import { describe, expect, it } from 'vitest'
import { buildApiChangeHistoryUrl, formatApiChange, getApiChanges } from './history'

const now = new Date('2026-11-06T04:00:00Z')
const api = { id: 1, name: 'Preview', method: 'post', path: '/preview', folderId: 12, editorUserId: 2684381, updatedAt: '2026-11-05T04:00:00Z' }
const options = { projectId: '6400879', token: 'test', now }

describe('recent API updates', () => {
  it('scopes the list to a module and filters by editor', async () => {
    const result = await getApiChanges({
      ...options,
      moduleId: '4304445',
      user: '2684381',
      fetcher: async (input) => {
        expect(new URL(String(input)).searchParams.get('moduleId')).toBe('4304445')
        return Response.json({ data: [{ ...api, moduleId: 4304445 }, { ...api, id: 2, moduleId: 4304445, editorUserId: 99 }], meta: { page: 1, total: 2, nextPage: null } })
      },
    })
    expect(result.moduleId).toBe('4304445')
    expect(result.records.map(record => record.id)).toEqual([1])
  })

  it('refuses results from another module', async () => {
    await expect(getApiChanges({
      ...options,
      moduleId: '4304445',
      fetcher: async () => Response.json({ data: [{ ...api, moduleId: 99 }], meta: { page: 1, total: 1, nextPage: null } }),
    })).rejects.toThrow('outside the requested module')
  })

  it('uses the verified API list endpoint for all supported base URL forms', () => {
    for (const base of ['https://api.apifox.com', 'https://api.apifox.com/v1/', 'https://api.apifox.com/api/v1'])
      expect(buildApiChangeHistoryUrl(base, 'project id', {})).toBe('https://api.apifox.com/api/v1/projects/project%20id/http-apis?locale=zh-CN')
  })

  it('reads every page, filters latest editors and sorts newest first', async () => {
    const requested: string[] = []
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input))
      requested.push(String(input))
      const page = Number(url.searchParams.get('page'))
      expect(url.searchParams.get('perPage')).toBe('100')
      const data = page === 1
        ? [api, { ...api, id: 2, editorUserId: 99 }, { ...api, id: 3, updatedAt: '2026-11-01T00:00:00Z' }]
        : [{ ...api, id: 4, updatedAt: '2026-11-06T03:00:00Z' }, { ...api, id: 5, folderId: 99 }, { ...api, id: 6, updatedAt: '2026-11-07T00:00:00Z' }]
      return Response.json({ success: true, data, meta: { page, total: 6, nextPage: page === 1 ? 2 : null } })
    }
    const result = await getApiChanges({ ...options, fetcher, user: '2684381', folderId: '12' })
    expect(result.records.map(record => record.id)).toEqual([4, 1])
    expect(requested).toHaveLength(2)
    expect(formatApiChange(result.records[0]!)).toContain('POST /preview editorUserId=2684381')
    const all = await getApiChanges({ ...options, fetcher, days: 3 })
    expect(all.records.map(record => record.id)).toEqual([4, 1, 2, 5])
  })

  it('accepts a verified empty project', async () => {
    const fetcher: typeof fetch = async () => Response.json({ data: [], meta: { page: 1, total: 0, nextPage: null } })
    expect((await getApiChanges({ ...options, fetcher })).records).toEqual([])
  })

  it.each([
    { data: [api] },
    { data: [api], meta: { page: 1, total: 2, nextPage: null } },
    { data: [api], meta: { page: 1, total: 2, nextPage: 1 } },
    { data: [{ ...api, editorUserId: undefined }], meta: { page: 1, total: 1, nextPage: null } },
    { data: [api, api], meta: { page: 1, total: 2, nextPage: null } },
    { success: false, data: [] },
  ])('rejects invalid or incomplete responses instead of reporting no updates: %j', async (payload) => {
    await expect(getApiChanges({ ...options, fetcher: async () => Response.json(payload) })).rejects.toThrow()
  })

  it('rejects empty bodies, authentication failures, names and unsupported windows', async () => {
    await expect(getApiChanges({ ...options, fetcher: async () => new Response('') })).rejects.toThrow('empty JSON')
    await expect(getApiChanges({ ...options, fetcher: async () => Response.json({}, { status: 403 }) })).rejects.toThrow('403')
    await expect(getApiChanges({ ...options, user: 'Alice' })).rejects.toThrow('numeric editorUserId')
    await expect(getApiChanges({ ...options, days: 2 as never })).rejects.toThrow('days must be 1 or 3')
  })
})
