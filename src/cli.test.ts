import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseCli, runCli } from './cli'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
})

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'afx-cli-'))
  temporaryDirectories.push(directory)
  return directory
}

describe('afx CLI', () => {
  it('parses optional API metadata export', () => {
    expect(parseCli(['-a', '492352338', '--include-metadata'])).toMatchObject({ apiIds: ['492352338'], includeMetadata: true })
    expect(parseCli([]).includeMetadata).toBeUndefined()
  })

  it('creates project and global configuration files through init', async () => {
    const directory = await createTemporaryDirectory()
    const globalPath = path.join(directory, 'global.json')
    const write = vi.fn()

    await runCli(['init', '--folder-id', '91292374'], {}, write, directory)
    await expect(readFile(path.join(directory, 'apifox-pull.config.json'), 'utf8')).resolves.toContain('91292374')

    await runCli(['init', '--global', '--global-config', globalPath, '--project-id', '6400879', '--token', 'secret'], {}, write, directory)
    await expect(readFile(globalPath, 'utf8')).resolves.toContain('secret')
  })

  it('shows resolved configuration with a redacted token', async () => {
    const directory = await createTemporaryDirectory()
    const globalPath = path.join(directory, 'global.json')
    await runCli(['init', '--global', '--global-config', globalPath, '--project-id', '6400879', '--token', 'secret-token'], {}, vi.fn(), directory)
    const write = vi.fn()

    await runCli(['config', '--global-config', globalPath, '--json'], {}, write, directory)

    expect(write).toHaveBeenCalledWith(expect.stringContaining('***oken'))
    expect(write).not.toHaveBeenCalledWith(expect.stringContaining('secret-token'))
  })

  it('protects project configuration from token writes and accidental replacement', async () => {
    const directory = await createTemporaryDirectory()
    await runCli(['init', '--project-id', '6400879'], {}, vi.fn(), directory)

    await expect(runCli(['init', '--project-id', 'other'], {}, vi.fn(), directory)).rejects.toThrow('Configuration file already exists')
    await expect(runCli(['init', '--token', 'secret'], {}, vi.fn(), directory)).rejects.toThrow('--token is only allowed with afx init --global')
  })

  it('queries recent API changes by user using the configured project', async () => {
    const directory = await createTemporaryDirectory()
    const globalPath = path.join(directory, 'global.json')
    await runCli(['init', '--global', '--global-config', globalPath, '--project-id', '6400879', '--token', 'secret-token'], {}, vi.fn(), directory)
    const fetcher = globalThis.fetch
    const originalFetch = globalThis.fetch
    const requested: string[] = []
    globalThis.fetch = (async (input) => {
      requested.push(String(input))
      return Response.json({ data: [{ id: 1, name: 'Preview', method: 'post', path: '/preview', folderId: 12, updatedAt: new Date(Date.now() - 1000).toISOString(), editorUserId: 2684381 }], meta: { page: 1, total: 1, nextPage: null } })
    }) as typeof fetch
    const write = vi.fn()
    try {
      await runCli(['history', '--global-config', globalPath, '--user', '2684381', '--days', '1', '--json'], {}, write, directory)
    }
    finally {
      globalThis.fetch = fetcher ?? originalFetch
    }
    expect(requested[0]).toContain('/projects/6400879/http-apis')
    expect(JSON.parse(write.mock.calls[0]![0] as string).records).toHaveLength(1)
  })

  it('exports matching history APIs with metadata', async () => {
    const directory = await createTemporaryDirectory()
    const globalPath = path.join(directory, 'global.json')
    await runCli(['init', '--global', '--global-config', globalPath, '--project-id', '6400879', '--token', 'secret-token'], {}, vi.fn(), directory)
    const output = path.join(directory, 'exported')
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input, options) => {
      if (options?.method === 'POST')
        return Response.json({ openapi: '3.1.0', paths: { '/preview': { post: {} } }, tags: [] })
      if (String(input).includes('/http-apis?'))
        return Response.json({ data: [{ id: 1, name: 'Preview', method: 'post', path: '/preview', folderId: 12, updatedAt: new Date(Date.now() - 1000).toISOString(), editorUserId: 2684381 }], meta: { page: 1, total: 1, nextPage: null } })
      return Response.json({ data: { id: 1, method: 'post', path: '/preview', createdAt: '2026-01-01T00:00:00Z', updatedAt: new Date().toISOString(), creatorId: 1, editorId: 2684381, creatorUserId: 1, editorUserId: 2684381, responsibleId: 0, folderId: 12 } })
    }) as typeof fetch
    try {
      await runCli(['history', '--global-config', globalPath, '--user', '2684381', '--days', '1', '--export', '--output', output], {}, vi.fn(), directory)
    }
    finally {
      globalThis.fetch = originalFetch
    }
    const document = JSON.parse(await readFile(path.join(output, '1.openapi.json'), 'utf8'))
    expect(document.paths['/preview'].post['x-apifox-metadata'].editorUserId).toBe(2684381)
  })

  it('does not export the whole project when no history records match', async () => {
    const directory = await createTemporaryDirectory()
    const globalPath = path.join(directory, 'global.json')
    await runCli(['init', '--global', '--global-config', globalPath, '--project-id', '6400879', '--token', 'test'], {}, vi.fn(), directory)
    const originalFetch = globalThis.fetch
    const fetcher = vi.fn(async () => Response.json({ data: [], meta: { page: 1, total: 0, nextPage: null } }))
    globalThis.fetch = fetcher
    const write = vi.fn()
    try {
      await runCli(['history', '--global-config', globalPath, '--export', '--json'], {}, write, directory)
    }
    finally {
      globalThis.fetch = originalFetch
    }
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledTimes(1)
    expect(JSON.parse(write.mock.calls[0]![0])).toMatchObject({ records: [], exported: null })
  })

  it('reports field-level configuration precedence', async () => {
    const directory = await createTemporaryDirectory()
    const globalPath = path.join(directory, 'global.json')
    await runCli(['init', '--global', '--global-config', globalPath, '--project-id', 'global', '--token', 'global-token'], {}, vi.fn(), directory)
    await runCli(['init', '--folder-id', '12', '--output', 'project-output'], {}, vi.fn(), directory)
    const write = vi.fn()

    await runCli(['config', '--global-config', globalPath, '--api-id', '78', '--json'], { APIFOX_PROJECT_ID: 'environment' }, write, directory)

    expect(JSON.parse(write.mock.calls[0]![0] as string)).toMatchObject({
      sources: { apiIds: 'cli', folderIds: 'project', output: 'project', projectId: 'environment', token: 'global' },
      values: { apiIds: ['78'], folderIds: ['12'], output: 'project-output', projectId: 'environment', token: '***oken' },
    })
  })
})
