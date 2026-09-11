import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runCli } from './cli'

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
