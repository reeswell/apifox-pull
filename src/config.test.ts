import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  getGlobalConfigPath,
  initializeConfig,
  loadConfig,
  resolveConfiguration,
} from './config'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
})

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'afx-config-'))
  temporaryDirectories.push(directory)
  return directory
}

describe('configuration', () => {
  it('merges project and global values field by field without allowing project tokens', async () => {
    const directory = await createTemporaryDirectory()
    const projectPath = path.join(directory, 'apifox-pull.config.json')
    const globalPath = path.join(directory, 'global.json')
    await initializeConfig({ folderIds: ['91292374'], output: 'docs/project' }, projectPath, false)
    await initializeConfig({ projectId: '6400879', token: 'global-secret' }, globalPath, true)
    expect((await stat(globalPath)).mode & 0o777).toBe(0o600)

    const resolved = resolveConfiguration(
      {},
      {},
      await loadConfig(projectPath, false, false),
      await loadConfig(globalPath, false, true),
    )

    expect(resolved.values).toMatchObject({
      folderIds: ['91292374'],
      output: 'docs/project',
      projectId: '6400879',
      token: 'global-secret',
    })
    expect(resolved.sources).toMatchObject({
      folderIds: 'project',
      projectId: 'global',
      token: 'global',
    })
    await expect(initializeConfig({ token: 'forbidden' }, projectPath, false, true)).rejects.toThrow(
      'Project configuration cannot contain token.',
    )
  })

  it('requires force before replacing a configuration file', async () => {
    const directory = await createTemporaryDirectory()
    const configPath = path.join(directory, 'apifox-pull.config.json')
    await initializeConfig({ projectId: 'first' }, configPath, false)

    await expect(initializeConfig({ projectId: 'second' }, configPath, false)).rejects.toThrow(
      'Configuration file already exists',
    )
    await initializeConfig({ projectId: 'second' }, configPath, false, true)
    await expect(readFile(configPath, 'utf8')).resolves.toContain('second')
  })

  it('uses XDG_CONFIG_HOME or an explicit global configuration path', () => {
    expect(getGlobalConfigPath({ XDG_CONFIG_HOME: '/tmp/config' })).toBe(
      '/tmp/config/apifox-pull/apifox-pull.config.json',
    )
    expect(getGlobalConfigPath({ APIFOX_PULL_GLOBAL_CONFIG: '/tmp/afx.json' })).toBe('/tmp/afx.json')
  })

  it('applies CLI, environment, project, and global precedence for each field', () => {
    const resolved = resolveConfiguration(
      { apiIds: ['78'], output: 'cli-output' },
      { APIFOX_PROJECT_ID: 'environment-project', APIFOX_TOKEN: 'environment-token' },
      { folderIds: ['12'], output: 'project-output' },
      { apiIds: ['56'], folderIds: ['34'], output: 'global-output', projectId: 'global-project', token: 'global-token' },
    )

    expect(resolved).toMatchObject({
      sources: { apiIds: 'cli', folderIds: 'project', output: 'cli', projectId: 'environment', token: 'environment' },
      values: {
        apiIds: ['78'],
        exportFormat: 'JSON',
        fileNameTemplate: '{id}.openapi.json',
        folderIds: ['12'],
        output: 'cli-output',
        projectId: 'environment-project',
        token: 'environment-token',
      },
    })
    expect(resolved.sources.fileNameTemplate).toBe('default')
    expect(resolved.sources.exportFormat).toBe('default')
  })

  it('defaults file name template to yaml when exportFormat is YAML', () => {
    const resolved = resolveConfiguration(
      { exportFormat: 'YAML' },
      {},
      {},
      {},
    )

    expect(resolved.values.exportFormat).toBe('YAML')
    expect(resolved.values.fileNameTemplate).toBe('{id}.openapi.yaml')
    expect(resolved.sources.exportFormat).toBe('cli')
    expect(resolved.sources.fileNameTemplate).toBe('default')
  })

  it('resolves a custom file name template from environment', () => {
    const resolved = resolveConfiguration(
      {},
      { APIFOX_FILE_NAME_TEMPLATE: '{name}-{id}.openapi.json' },
      {},
      {},
    )

    expect(resolved.values.fileNameTemplate).toBe('{name}-{id}.openapi.json')
    expect(resolved.sources.fileNameTemplate).toBe('environment')
  })

  it('resolves exportFormat from environment', () => {
    const resolved = resolveConfiguration(
      {},
      { APIFOX_EXPORT_FORMAT: 'yaml' },
      {},
      {},
    )

    expect(resolved.values.exportFormat).toBe('YAML')
    expect(resolved.values.fileNameTemplate).toBe('{id}.openapi.yaml')
    expect(resolved.sources.exportFormat).toBe('environment')
  })
})
