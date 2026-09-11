import type { ConfigField, ConfigurationSource, ConfigValues, ExportFormat, ResolvedConfiguration } from './types'
// @env node
import { access, chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import {
  DEFAULT_BASE_URL,
  DEFAULT_EXPORT_FORMAT,
  DEFAULT_FILE_NAME_TEMPLATE,
  DEFAULT_FILE_NAME_TEMPLATE_YAML,
  DEFAULT_OUTPUT_DIRECTORY,
  GLOBAL_CONFIG_DIRECTORY,
  GLOBAL_CONFIG_FILE,
} from './constants'

export type Environment = Readonly<Record<string, string | undefined>>

const projectConfigKeys = new Set<ConfigField>([
  'apiIds',
  'baseUrl',
  'exportFormat',
  'exportUrlTemplate',
  'fileNameTemplate',
  'folderIds',
  'output',
  'projectId',
])

const globalConfigKeys = new Set<ConfigField>([...projectConfigKeys, 'token'])

const configurationFields: ConfigField[] = [
  'apiIds',
  'folderIds',
  'projectId',
  'token',
  'output',
  'baseUrl',
  'exportFormat',
  'exportUrlTemplate',
  'fileNameTemplate',
]

function asConfigRecord(value: unknown, configPath: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Configuration file must contain a JSON object: ${configPath}`)
  }
  return value as Record<string, unknown>
}

function readConfigString(value: unknown, key: string, configPath: string): string | undefined {
  if (value === undefined) {
    return undefined
  }
  if (typeof value !== 'string' || !value) {
    throw new Error(`Configuration value "${key}" must be a non-empty string: ${configPath}`)
  }
  return value
}

function readConfigStrings(value: unknown, key: string, configPath: string): string[] | undefined {
  if (value === undefined) {
    return undefined
  }
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item)) {
    throw new Error(`Configuration value "${key}" must be an array of non-empty strings: ${configPath}`)
  }
  return value
}

export function parseExportFormat(value: string, label = 'exportFormat'): ExportFormat {
  const normalized = value.trim().toUpperCase()
  if (normalized === 'JSON' || normalized === 'YAML') {
    return normalized
  }
  throw new Error(`${label} must be JSON or YAML.`)
}

function readExportFormat(value: unknown, key: string, configPath: string): ExportFormat | undefined {
  if (value === undefined) {
    return undefined
  }
  if (typeof value !== 'string' || !value) {
    throw new Error(`Configuration value "${key}" must be a non-empty string: ${configPath}`)
  }
  try {
    return parseExportFormat(value, `Configuration value "${key}"`)
  }
  catch {
    throw new Error(`Configuration value "${key}" must be JSON or YAML: ${configPath}`)
  }
}

function readEnvironmentValues(environment: Environment): ConfigValues {
  const split = (value: string | undefined): string[] | undefined => value?.split(',').map(item => item.trim()).filter(Boolean)
  const text = (value: string | undefined): string | undefined => value || undefined
  return {
    apiIds: split(environment.APIFOX_API_IDS),
    baseUrl: text(environment.APIFOX_BASE_URL),
    exportFormat: environment.APIFOX_EXPORT_FORMAT
      ? parseExportFormat(environment.APIFOX_EXPORT_FORMAT, 'APIFOX_EXPORT_FORMAT')
      : undefined,
    exportUrlTemplate: text(environment.APIFOX_EXPORT_URL_TEMPLATE),
    fileNameTemplate: text(environment.APIFOX_FILE_NAME_TEMPLATE),
    folderIds: split(environment.APIFOX_FOLDER_IDS),
    output: text(environment.APIFOX_OUTPUT),
    projectId: text(environment.APIFOX_PROJECT_ID),
    token: text(environment.APIFOX_TOKEN),
  }
}

export function getGlobalConfigPath(environment: Environment = process.env): string {
  if (environment.APIFOX_PULL_GLOBAL_CONFIG) {
    return environment.APIFOX_PULL_GLOBAL_CONFIG
  }
  const configHome = environment.XDG_CONFIG_HOME ?? path.join(homedir(), '.config')
  return path.join(configHome, GLOBAL_CONFIG_DIRECTORY, GLOBAL_CONFIG_FILE)
}

export async function loadConfig(
  configPath: string,
  optional = false,
  allowToken = false,
): Promise<ConfigValues> {
  let source: string
  try {
    source = await readFile(configPath, 'utf8')
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && optional) {
      return {}
    }
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Configuration file not found: ${configPath}`)
    }
    throw error
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  }
  catch {
    throw new Error(`Configuration file contains invalid JSON: ${configPath}`)
  }

  const config = asConfigRecord(parsed, configPath)
  for (const key of Object.keys(config)) {
    if (key === 'token' && !allowToken) {
      throw new Error(`Project configuration cannot contain token: ${configPath}`)
    }
    if (!(allowToken ? globalConfigKeys : projectConfigKeys).has(key as ConfigField)) {
      throw new Error(`Unknown configuration key "${key}": ${configPath}`)
    }
  }

  return {
    apiIds: readConfigStrings(config.apiIds, 'apiIds', configPath),
    baseUrl: readConfigString(config.baseUrl, 'baseUrl', configPath),
    exportFormat: readExportFormat(config.exportFormat, 'exportFormat', configPath),
    exportUrlTemplate: readConfigString(config.exportUrlTemplate, 'exportUrlTemplate', configPath),
    fileNameTemplate: readConfigString(config.fileNameTemplate, 'fileNameTemplate', configPath),
    folderIds: readConfigStrings(config.folderIds, 'folderIds', configPath),
    output: readConfigString(config.output, 'output', configPath),
    projectId: readConfigString(config.projectId, 'projectId', configPath),
    token: allowToken ? readConfigString(config.token, 'token', configPath) : undefined,
  }
}

export function resolveConfiguration(
  cliValues: ConfigValues,
  environment: Environment,
  projectConfig: ConfigValues,
  globalConfig: ConfigValues,
): ResolvedConfiguration {
  const environmentValues = readEnvironmentValues(environment)
  const values: ConfigValues = {}
  const sources: Partial<Record<ConfigField, ConfigurationSource>> = {}

  for (const field of configurationFields) {
    const candidates: Array<[ConfigValues, ConfigurationSource]> = [
      [cliValues, 'cli'],
      [environmentValues, 'environment'],
      [projectConfig, 'project'],
      [globalConfig, 'global'],
    ]
    for (const [candidate, source] of candidates) {
      if (candidate[field] !== undefined) {
        Object.assign(values, { [field]: candidate[field] })
        sources[field] = source
        break
      }
    }
  }

  if (values.baseUrl === undefined) {
    values.baseUrl = DEFAULT_BASE_URL
    sources.baseUrl = 'default'
  }
  if (values.exportFormat === undefined) {
    values.exportFormat = DEFAULT_EXPORT_FORMAT
    sources.exportFormat = 'default'
  }
  if (values.fileNameTemplate === undefined) {
    values.fileNameTemplate = values.exportFormat === 'YAML'
      ? DEFAULT_FILE_NAME_TEMPLATE_YAML
      : DEFAULT_FILE_NAME_TEMPLATE
    sources.fileNameTemplate = 'default'
  }
  if (values.output === undefined) {
    values.output = DEFAULT_OUTPUT_DIRECTORY
    sources.output = 'default'
  }

  return { sources, values }
}

export async function initializeConfig(
  values: ConfigValues,
  configPath: string,
  isGlobal: boolean,
  force = false,
): Promise<void> {
  if (!isGlobal && values.token !== undefined) {
    throw new Error('Project configuration cannot contain token.')
  }

  try {
    await access(configPath)
    if (!force) {
      throw new Error(`Configuration file already exists: ${configPath}. Use --force to replace it.`)
    }
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }

  const allowedKeys = isGlobal ? globalConfigKeys : projectConfigKeys
  const serialized = Object.fromEntries(
    configurationFields
      .filter(key => allowedKeys.has(key) && values[key] !== undefined)
      .map(key => [key, values[key]]),
  )
  await mkdir(path.dirname(configPath), { recursive: true })
  await writeFile(configPath, `${JSON.stringify(serialized, null, 2)}\n`, { mode: isGlobal ? 0o600 : undefined })
  if (isGlobal) {
    await chmod(configPath, 0o600)
  }
}
