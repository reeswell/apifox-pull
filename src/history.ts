import type { ApiChangeOptions, ApiChangeRecord, ApiChangeResult } from './types'
// @env node
import { requestApifoxJson } from './client'
import { DEFAULT_BASE_URL } from './constants'

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function validateDays(days: number): asserts days is 1 | 3 {
  if (days !== 1 && days !== 3)
    throw new Error('days must be 1 or 3.')
}

// Retained public name for compatibility; history now lists latest API updates, not audit events.
export function buildApiChangeHistoryUrl(
  baseUrl: string,
  projectId: string,
  options: Pick<ApiChangeOptions, 'days' | 'folderId' | 'now' | 'user'>,
): string {
  validateDays(options.days ?? 1)
  const normalized = baseUrl.replace(/\/+$/, '')
  const root = normalized.endsWith('/api/v1') ? normalized : `${normalized.replace(/\/v1$/, '')}/api/v1`
  return `${root}/projects/${encodeURIComponent(projectId)}/http-apis?locale=zh-CN`
}

function parseApi(value: unknown): ApiChangeRecord {
  const record = asRecord(value)
  if (!record || !Number.isSafeInteger(record.id) || typeof record.updatedAt !== 'string'
    || !Number.isFinite(Date.parse(record.updatedAt)) || !Number.isSafeInteger(record.editorUserId)
    || typeof record.name !== 'string' || typeof record.method !== 'string' || typeof record.path !== 'string'
    || !Number.isSafeInteger(record.folderId)) {
    throw new Error('Invalid API list record: expected id, name, method, path, folderId, updatedAt and editorUserId.')
  }
  return {
    id: record.id as number,
    name: record.name,
    method: record.method,
    path: record.path,
    folderId: record.folderId as number,
    updatedAt: record.updatedAt,
    editorUserId: record.editorUserId as number,
  }
}

export async function getApiChanges({
  baseUrl = DEFAULT_BASE_URL,
  days = 1,
  fetcher = fetch,
  folderId,
  moduleId,
  now = new Date(),
  projectId,
  token,
  user,
}: ApiChangeOptions): Promise<ApiChangeResult> {
  validateDays(days)
  if (user !== undefined && !/^\d+$/.test(user))
    throw new Error('user must be a numeric editorUserId; names are not supported.')
  if (moduleId !== undefined && (!/^\d+$/.test(moduleId) || !Number.isSafeInteger(Number(moduleId)) || Number(moduleId) <= 0))
    throw new Error('moduleId must be a positive integer.')
  const to = now.getTime()
  const from = to - days * 24 * 60 * 60 * 1000
  const url = `${buildApiChangeHistoryUrl(baseUrl, projectId, { days })}${moduleId === undefined ? '' : `&moduleId=${encodeURIComponent(moduleId)}`}`
  const all: ApiChangeRecord[] = []
  const seen = new Set<number>()
  let total: number | undefined
  let page = 1
  while (true) {
    // Module pagination can overlap on Apifox; prefer its complete first response, validating totals below.
    const pageUrl = moduleId !== undefined && page === 1 ? url : `${url}&page=${page}&perPage=100`
    const payload = asRecord(await requestApifoxJson(fetcher, pageUrl, token, {
      headers: { 'X-Project-Id': projectId },
      unwrapData: false,
    }))
    const meta = asRecord(payload?.meta)
    if (!Array.isArray(payload?.data) || !meta || meta.page !== page
      || !Number.isSafeInteger(meta.total) || (meta.total as number) < 0
      || (meta.nextPage !== null && meta.nextPage !== page + 1)) {
      throw new Error('Invalid API list pagination; cannot guarantee complete results.')
    }
    if (total !== undefined && total !== meta.total)
      throw new Error('API list changed during pagination; retry the query.')
    total = meta.total as number
    for (const value of payload.data) {
      const record = parseApi(value)
      if (moduleId !== undefined && String(asRecord(value)?.moduleId) !== moduleId)
        throw new Error('API list returned a record outside the requested module; refusing an unscoped export.')
      if (seen.has(record.id))
        throw new Error('Duplicate API across pages; retry the query.')
      seen.add(record.id)
      all.push(record)
    }
    if (meta.nextPage === null)
      break
    if (!payload.data.length || all.length >= total)
      throw new Error('Invalid API list pagination; cannot guarantee complete results.')
    page++
  }
  if (all.length !== total)
    throw new Error('Incomplete API list; retry the query.')
  const records = all.filter(record => Date.parse(record.updatedAt) >= from && Date.parse(record.updatedAt) <= to
    && (user === undefined || String(record.editorUserId) === user)
    && (folderId === undefined || String(record.folderId) === folderId))
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt) || left.id - right.id)
  return { days, folderId, moduleId, from: new Date(from).toISOString(), projectId, records, to: now.toISOString(), user }
}

export function formatApiChange(record: ApiChangeRecord): string {
  return `${record.updatedAt} ${record.id} (${record.name}) ${record.method.toUpperCase()} ${record.path} editorUserId=${record.editorUserId}`
}
