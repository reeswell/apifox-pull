// @env node
import { DEFAULT_API_VERSION } from './constants'

type JsonRecord = Record<string, unknown>

export interface RequestJsonOptions {
  body?: unknown
  method?: string
}

function asRecord(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonRecord : undefined
}

function unwrapData(payload: unknown): unknown {
  const record = asRecord(payload)
  return record && Object.hasOwn(record, 'data') ? record.data : payload
}

function formatBodySnippet(body: string): string {
  const snippet = body.replaceAll(/\s+/g, ' ').trim().slice(0, 160)
  return snippet ? ` Body: ${snippet}` : ''
}

export async function requestApifoxJson(
  fetcher: typeof fetch,
  url: string,
  token: string,
  options: RequestJsonOptions = {},
): Promise<unknown> {
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
    'X-Apifox-Api-Version': DEFAULT_API_VERSION,
  }
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }

  const response = await fetcher(url, {
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    headers,
    method: options.method,
  })
  const body = await response.text()
  let payload: unknown
  if (body.trim()) {
    try {
      payload = JSON.parse(body)
    }
    catch {
      throw new Error(`Apifox request returned non-JSON response (${response.status}) from ${url}.${formatBodySnippet(body)}`)
    }
  }

  if (!response.ok) {
    const message = asRecord(payload)?.message
    throw new Error(`Apifox request failed (${response.status})${message ? `: ${message}` : ''}`)
  }

  const data = unwrapData(payload)
  if (data === undefined) {
    throw new Error(`Apifox request returned an empty JSON response (${response.status}) from ${url}.`)
  }
  return data
}
