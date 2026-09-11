import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { exportOpenApi, getOpenApiOutputFile, planExportTargets } from './index'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
})

async function createOutputDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'apifox-pull-'))
  temporaryDirectories.push(directory)
  return directory
}

describe('export planning', () => {
  it('deduplicates export targets and preserves folder-first order', () => {
    expect(planExportTargets(['78', '78'], ['123', '123'])).toEqual([
      { id: '123', type: 'FOLDER' },
      { id: '78', type: 'API' },
    ])
  })

  it('uses id-based names by default and supports custom templates', () => {
    expect(getOpenApiOutputFile({ id: '12', type: 'FOLDER' }, { tags: [{ name: 'Orders / EU' }] })).toBe('12.openapi.json')
    expect(getOpenApiOutputFile({ id: '78', type: 'API' }, { paths: {} })).toBe('78.openapi.json')
    expect(getOpenApiOutputFile({ id: '12', type: 'FOLDER' }, { tags: [{ name: 'Orders / EU' }] }, '{name}-{id}.openapi.json')).toBe('Orders-EU-12.openapi.json')
    expect(getOpenApiOutputFile({ id: '78', type: 'API' }, { paths: {} }, '{type}-{id}.json')).toBe('api-78.json')
    expect(getOpenApiOutputFile({ type: 'ALL' }, {}, '{id}.openapi.json', 'YAML')).toBe('openapi.yaml')
    expect(getOpenApiOutputFile({ id: '12', type: 'FOLDER' }, { tags: [{ name: 'Orders' }] }, '{id}.openapi.yaml', 'YAML')).toBe('12.openapi.yaml')
  })
})

describe('exportOpenApi', () => {
  it('does not rewrite an unchanged OpenAPI snapshot', async () => {
    const output = await createOutputDirectory()
    const openapi = { openapi: '3.1.0', paths: {}, tags: [] }
    const content = `${JSON.stringify(openapi, null, 2)}\n`
    await writeFile(path.join(output, 'openapi.json'), content)

    const result = await exportOpenApi({
      fetcher: async () => Response.json(openapi),
      output,
      projectId: 'project',
      token: 'secret-token',
    })

    expect(result).toMatchObject({
      changed: false,
      operations: 0,
      tags: 0,
    })
    await expect(readFile(path.join(output, 'openapi.json'), 'utf8')).resolves.toBe(content)
  })

  it('reports a pending snapshot during a dry run without creating the output directory', async () => {
    const parent = await createOutputDirectory()
    const output = path.join(parent, 'nested', 'snapshot')

    const result = await exportOpenApi({
      dryRun: true,
      fetcher: async () => Response.json({
        openapi: '3.1.0',
        paths: { '/users': { get: {}, post: {} } },
        tags: [{ name: 'Users' }],
      }),
      output,
      projectId: 'project',
      token: 'secret-token',
    })

    expect(result).toMatchObject({
      changed: true,
      operations: 2,
      tags: 1,
    })
    await expect(access(output)).rejects.toThrow()
  })

  it('plans all selected targets in dry-run mode without writing any files', async () => {
    const parent = await createOutputDirectory()
    const output = path.join(parent, 'nested', 'snapshot')
    const result = await exportOpenApi({
      apiIds: ['78'],
      dryRun: true,
      fetcher: async () => Response.json({ openapi: '3.1.0', paths: {}, tags: [{ name: 'Orders' }] }),
      folderIds: ['12'],
      output,
      projectId: 'project',
      token: 'secret-token',
    })

    expect(result.documents).toHaveLength(2)
    expect(result.changed).toBe(true)
    await expect(access(output)).rejects.toThrow()
  })

  it('fails check mode when the local snapshot is outdated without writing it', async () => {
    const output = await createOutputDirectory()
    const file = path.join(output, 'openapi.json')
    await writeFile(file, '{"openapi":"3.0.0"}\n')

    await expect(exportOpenApi({
      check: true,
      fetcher: async () => Response.json({ openapi: '3.1.0', paths: {} }),
      output,
      projectId: 'project',
      token: 'secret-token',
    })).rejects.toThrow('OpenAPI snapshot is out of date')
    await expect(readFile(file, 'utf8')).resolves.toBe('{"openapi":"3.0.0"}\n')
  })

  it('exports the project as OpenAPI JSON by default', async () => {
    const output = await createOutputDirectory()
    const requested: Array<{ body?: unknown, headers: Record<string, string>, method?: string, url: string }> = []
    const openapi = {
      info: { title: 'Demo', version: '1.0.0' },
      openapi: '3.1.0',
      paths: { '/users': { get: { summary: 'List users' } } },
    }
    const fetcher: typeof fetch = async (input, init) => {
      requested.push({
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
        headers: init?.headers as Record<string, string>,
        method: init?.method,
        url: String(input),
      })
      return Response.json(openapi)
    }

    const result = await exportOpenApi({
      fetcher,
      output,
      projectId: 'project id',
      token: 'secret-token',
    })

    expect(requested).toEqual([{
      body: {
        exportFormat: 'JSON',
        oasVersion: '3.1',
        options: {
          addFoldersToTags: true,
          includeApifoxExtensionProperties: false,
        },
        scope: { type: 'ALL' },
      },
      headers: {
        'Authorization': 'Bearer secret-token',
        'Content-Type': 'application/json',
        'X-Apifox-Api-Version': '2024-03-28',
      },
      method: 'POST',
      url: 'https://api.apifox.com/v1/projects/project%20id/export-openapi',
    }])
    expect(result).toMatchObject({
      changed: true,
      file: 'openapi.json',
      operations: 1,
      output,
      tags: 0,
    })
    await expect(readFile(path.join(output, 'openapi.json'), 'utf8')).resolves.toBe(`${JSON.stringify(openapi, null, 2)}\n`)
  })

  it('exports selected folders without reading the API tree', async () => {
    const output = await createOutputDirectory()
    const requested: Array<{ body?: unknown, method?: string, url: string }> = []
    const fetcher: typeof fetch = async (input, init) => {
      requested.push({
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
        method: init?.method,
        url: String(input),
      })

      return Response.json({
        info: { title: 'Selected folder', version: '1.0.0' },
        openapi: '3.1.0',
        paths: {},
        tags: [{ name: 'New logistics bill' }],
      })
    }

    await exportOpenApi({
      fetcher,
      folderIds: ['91292374'],
      output,
      projectId: 'project id',
      token: 'secret-token',
    })

    expect(requested).toEqual([
      {
        body: {
          exportFormat: 'JSON',
          oasVersion: '3.1',
          options: {
            addFoldersToTags: true,
            includeApifoxExtensionProperties: false,
          },
          scope: {
            selectedFolderIds: [91292374],
            type: 'SELECTED_FOLDERS',
          },
        },
        method: 'POST',
        url: 'https://api.apifox.com/v1/projects/project%20id/export-openapi',
      },
    ])
    await expect(readFile(path.join(output, '91292374.openapi.json'), 'utf8')).resolves.toContain('Selected folder')
  })

  it('writes one named OpenAPI file for each selected folder and API', async () => {
    const output = await createOutputDirectory()
    const scopes: unknown[] = []
    const fetcher: typeof fetch = async (_, init) => {
      const request = JSON.parse(String(init?.body)) as { scope: { type: string } }
      scopes.push(request.scope)

      if (request.scope.type === 'SELECTED_FOLDERS') {
        return Response.json({
          info: { title: 'Project', version: '1.0.0' },
          openapi: '3.1.0',
          paths: {},
          tags: [{ name: 'Invoices' }],
        })
      }

      return Response.json({
        info: { title: 'Project', version: '1.0.0' },
        openapi: '3.1.0',
        paths: {
          '/exports': {
            post: { summary: 'Create async export' },
          },
        },
      })
    }

    await exportOpenApi({
      apiIds: ['303505478'],
      fetcher,
      folderIds: ['91292374'],
      output,
      projectId: 'project',
      token: 'secret-token',
    })

    expect(scopes).toEqual([
      { selectedFolderIds: [91292374], type: 'SELECTED_FOLDERS' },
      { selectedEndpointIds: [303505478], type: 'SELECTED_ENDPOINTS' },
    ])
    await expect(readFile(path.join(output, '91292374.openapi.json'), 'utf8')).resolves.toContain('Invoices')
    await expect(readFile(path.join(output, '303505478.openapi.json'), 'utf8')).resolves.toContain('Create async export')
  })

  it('keeps colliding selected target names in independent files', async () => {
    const output = await createOutputDirectory()

    const result = await exportOpenApi({
      apiIds: ['12'],
      fetcher: async () => Response.json({ info: { title: 'Shared' }, openapi: '3.1.0', paths: {}, tags: [{ name: 'Shared' }] }),
      folderIds: ['12'],
      output,
      projectId: 'project',
      token: 'secret-token',
    })

    expect(result.documents.map(document => document.file)).toEqual([
      '12.openapi.json',
      '12-api.openapi.json',
    ])
  })

  it('applies a custom file name template for selected exports', async () => {
    const output = await createOutputDirectory()

    await exportOpenApi({
      fetcher: async () => Response.json({
        info: { title: 'Selected folder', version: '1.0.0' },
        openapi: '3.1.0',
        paths: {},
        tags: [{ name: 'New logistics bill' }],
      }),
      fileNameTemplate: '{name}-{id}.openapi.json',
      folderIds: ['91292374'],
      output,
      projectId: 'project',
      token: 'secret-token',
    })

    await expect(readFile(path.join(output, 'New-logistics-bill-91292374.openapi.json'), 'utf8')).resolves.toContain('Selected folder')
  })

  it('writes YAML snapshots when exportFormat is YAML', async () => {
    const output = await createOutputDirectory()
    const openapi = { openapi: '3.1.0', info: { title: 'Demo' }, paths: {}, tags: [] }

    const result = await exportOpenApi({
      exportFormat: 'YAML',
      fetcher: async () => Response.json(openapi),
      fileNameTemplate: '{id}.openapi.yaml',
      folderIds: ['12'],
      output,
      projectId: 'project',
      token: 'secret-token',
    })

    expect(result.file).toBe('12.openapi.yaml')
    const content = await readFile(path.join(output, '12.openapi.yaml'), 'utf8')
    expect(content).toContain('openapi: 3.1.0')
    expect(content).toContain('title: Demo')
    expect(content.trimStart().startsWith('{')).toBe(false)
  })

  it('uses a custom export URL template for folder exports', async () => {
    const output = await createOutputDirectory()
    const requestedUrls: string[] = []
    const fetcher: typeof fetch = async (input, init) => {
      requestedUrls.push(String(input))

      expect(init?.method).toBe('POST')
      return Response.json({ openapi: '3.1.0', paths: {} })
    }

    await exportOpenApi({
      baseUrl: 'https://example.com/open api',
      exportUrlTemplate: '{baseUrl}/projects/{projectId}/export-openapi',
      fetcher,
      folderIds: ['91292374'],
      output,
      projectId: 'project id',
      token: 'secret-token',
    })

    expect(requestedUrls).toEqual([
      'https://example.com/open api/projects/project%20id/export-openapi',
    ])
  })

  it('surfaces an API error without writing files', async () => {
    const output = await createOutputDirectory()
    const fetcher: typeof fetch = async () => new Response(
      JSON.stringify({ message: 'Access denied' }),
      { status: 403 },
    )

    await expect(exportOpenApi({
      fetcher,
      output,
      projectId: 'project',
      token: 'secret-token',
    })).rejects.toThrow('Apifox request failed (403): Access denied')
  })

  it('propagates a failed output write', async () => {
    const parent = await createOutputDirectory()
    const output = path.join(parent, 'not-a-directory')
    await writeFile(output, 'file')

    await expect(exportOpenApi({
      fetcher: async () => Response.json({ openapi: '3.1.0', paths: {} }),
      output,
      projectId: 'project',
      token: 'secret-token',
    })).rejects.toThrow()
  })

  it('rejects an empty success response instead of writing undefined', async () => {
    const output = await createOutputDirectory()
    const fetcher: typeof fetch = async () => new Response('', { status: 200 })

    await expect(exportOpenApi({
      fetcher,
      output,
      projectId: 'project',
      token: 'secret-token',
    })).rejects.toThrow('Apifox request returned an empty JSON response (200) from https://api.apifox.com/v1/projects/project/export-openapi.')
  })

  it('rejects a non-JSON success response with a diagnostic snippet', async () => {
    const output = await createOutputDirectory()
    const fetcher: typeof fetch = async () => new Response('<html>Not JSON</html>', { status: 200 })

    await expect(exportOpenApi({
      fetcher,
      output,
      projectId: 'project',
      token: 'secret-token',
    })).rejects.toThrow('Apifox request returned non-JSON response (200) from https://api.apifox.com/v1/projects/project/export-openapi. Body: <html>Not JSON</html>')
  })
})
