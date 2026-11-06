import type { Environment } from './config'
import type { ConfigValues, ResolvedConfiguration } from './types'
// @env node
import path from 'node:path'
import process from 'node:process'
import { getGlobalConfigPath, initializeConfig, loadConfig, parseExportFormat, resolveConfiguration } from './config'
import { DEFAULT_BASE_URL, PROJECT_CONFIG_FILE } from './constants'
import { exportOpenApi } from './export'
import { formatApiChange, getApiChanges } from './history'

type Writer = (message: string) => void
type Command = 'config' | 'export' | 'history' | 'init'

export interface CliOptions extends ConfigValues {
  includeMetadata?: boolean
  moduleId?: string
  exportHistory?: boolean
  check: boolean
  command: Command
  config?: string
  dryRun: boolean
  force: boolean
  global: boolean
  globalConfig?: string
  help: boolean
  days?: 1 | 3
  user?: string
  json: boolean
}

function readOptionValues(value: string): string[] {
  return value.split(',').map(item => item.trim()).filter(Boolean)
}

function readOptionValue(name: string, inlineValue: string | undefined, nextValue: string | undefined): string {
  const value = inlineValue ?? nextValue
  if (!value || value.startsWith('-'))
    throw new Error(`Missing value for ${name}.`)
  return value
}

export function parseCli(argv: string[]): CliOptions {
  const command: Command = argv[0] === 'init' || argv[0] === 'config' || argv[0] === 'history' || argv[0] === 'changes'
    ? (argv[0] === 'changes' ? 'history' : argv[0])
    : 'export'
  const argumentsToParse = command === 'export' ? argv : argv.slice(1)
  const options: CliOptions = { check: false, command, dryRun: false, force: false, global: false, help: false, json: false }

  for (let index = 0; index < argumentsToParse.length; index++) {
    const argument = argumentsToParse[index]!
    if (argument === '--')
      continue
    const separatorIndex = argument.indexOf('=')
    const name = separatorIndex === -1 ? argument : argument.slice(0, separatorIndex)
    const inlineValue = separatorIndex === -1 ? undefined : argument.slice(separatorIndex + 1)
    const consumeValue = (): string => {
      const value = readOptionValue(name, inlineValue, argumentsToParse[index + 1])
      if (inlineValue === undefined)
        index++
      return value
    }

    switch (name) {
      case '--api-id':
      case '-a':
        options.apiIds = [...(options.apiIds ?? []), ...readOptionValues(consumeValue())]
        break
      case '--base-url':
      case '-b':
        options.baseUrl = consumeValue()
        break
      case '--include-metadata':
        options.includeMetadata = true
        break
      case '--module-id':
        options.moduleId = consumeValue()
        break
      case '--export':
        options.exportHistory = true
        break
      case '--check':
        options.check = true
        break
      case '--config':
        options.config = consumeValue()
        break
      case '--dry-run':
        options.dryRun = true
        break
      case '--days': {
        const days = Number(consumeValue())
        if (days !== 1 && days !== 3)
          throw new Error('--days must be 1 or 3.')
        options.days = days
        break
      }
      case '--export-format':
        options.exportFormat = parseExportFormat(consumeValue(), '--export-format')
        break
      case '--export-url-template':
        options.exportUrlTemplate = consumeValue()
        break
      case '--file-name-template':
        options.fileNameTemplate = consumeValue()
        break
      case '--folder-id':
      case '-f':
        options.folderIds = [...(options.folderIds ?? []), ...readOptionValues(consumeValue())]
        break
      case '--force':
        options.force = true
        break
      case '--global':
        options.global = true
        break
      case '--global-config':
        options.globalConfig = consumeValue()
        break
      case '--help':
      case '-h':
        options.help = true
        break
      case '--json':
        options.json = true
        break
      case '--output':
      case '-o':
        options.output = consumeValue()
        break
      case '--project-id':
      case '-p':
        options.projectId = consumeValue()
        break
      case '--token':
      case '-t':
        options.token = consumeValue()
        break
      case '--user':
      case '-u':
        options.user = consumeValue()
        break
      default: throw new Error(`Unknown option: ${argument}`)
    }
  }
  return options
}

function asConfigValues(options: CliOptions): ConfigValues {
  const { apiIds, baseUrl, exportFormat, exportUrlTemplate, fileNameTemplate, folderIds, output, projectId, token } = options
  return { apiIds, baseUrl, exportFormat, exportUrlTemplate, fileNameTemplate, folderIds, output, projectId, token }
}

function getProjectConfigPath(options: CliOptions, cwd: string): string {
  return path.resolve(cwd, options.config ?? PROJECT_CONFIG_FILE)
}

function getConfiguredGlobalPath(options: CliOptions, environment: Environment, cwd: string): string {
  return options.globalConfig ? path.resolve(cwd, options.globalConfig) : getGlobalConfigPath(environment)
}

async function getResolvedConfiguration(options: CliOptions, environment: Environment, cwd: string): Promise<ResolvedConfiguration> {
  const projectPath = getProjectConfigPath(options, cwd)
  const globalPath = getConfiguredGlobalPath(options, environment, cwd)
  const [projectConfig, globalConfig] = await Promise.all([
    loadConfig(projectPath, options.config === undefined, false),
    loadConfig(globalPath, true, true),
  ])
  return resolveConfiguration(asConfigValues(options), environment, projectConfig, globalConfig)
}

function redactToken(token: string | undefined): string | undefined {
  if (!token)
    return undefined
  return `***${token.slice(-4)}`
}

function getDisplayConfiguration(configuration: ResolvedConfiguration): { sources: ResolvedConfiguration['sources'], values: ConfigValues } {
  return { sources: configuration.sources, values: { ...configuration.values, token: redactToken(configuration.values.token) } }
}

async function runInit(options: CliOptions, environment: Environment, write: Writer, cwd: string): Promise<void> {
  if (options.check || options.dryRun || options.json)
    throw new Error('init does not support --check, --dry-run, or --json.')
  if (!options.global && options.token !== undefined)
    throw new Error('--token is only allowed with afx init --global.')
  const configPath = options.global
    ? getConfiguredGlobalPath(options, environment, cwd)
    : getProjectConfigPath(options, cwd)
  await initializeConfig(asConfigValues(options), configPath, options.global, options.force)
  write(`Created ${options.global ? 'global' : 'project'} configuration: ${configPath}`)
}

async function runConfig(options: CliOptions, environment: Environment, write: Writer, cwd: string): Promise<void> {
  if (options.check || options.dryRun || options.force || options.global) {
    throw new Error('config only accepts configuration selection options and --json.')
  }
  const configuration = await getResolvedConfiguration(options, environment, cwd)
  const display = getDisplayConfiguration(configuration)
  if (options.json) {
    write(JSON.stringify(display, null, 2))
    return
  }
  write(['Resolved configuration:', ...Object.entries(display.values).map(([key, value]) => `  ${key}: ${Array.isArray(value) ? value.join(', ') : value} (${display.sources[key as keyof ConfigValues]})`)].join('\n'))
}

async function runHistory(options: CliOptions, environment: Environment, write: Writer, cwd: string): Promise<void> {
  if (options.check || options.dryRun || options.force || options.global)
    throw new Error('history does not support --check, --dry-run, --force, or --global.')
  const configuration = await getResolvedConfiguration(options, environment, cwd)
  const { values } = configuration
  if (!values.projectId || !values.token)
    throw new Error('Set APIFOX_PROJECT_ID and APIFOX_TOKEN, configure afx init --global, or pass --project-id and --token.')
  if (options.user && !/^\d+$/.test(options.user))
    throw new Error('history accepts only numeric --user <editorUserId>.')
  if (options.folderIds && options.folderIds.length > 1)
    throw new Error('history accepts only one --folder-id.')
  const result = await getApiChanges({
    baseUrl: values.baseUrl,
    days: options.days ?? 1,
    folderId: options.folderIds?.[0],
    moduleId: options.moduleId,
    projectId: values.projectId,
    token: values.token,
    user: options.user,
  })
  const exported = options.exportHistory && result.records.length > 0
    ? await exportOpenApi({
        apiIds: result.records.map(record => String(record.id)),
        baseUrl: values.baseUrl,
        exportFormat: values.exportFormat,
        exportUrlTemplate: values.exportUrlTemplate,
        fileNameTemplate: values.fileNameTemplate,
        includeMetadata: true,
        onProgress: options.json ? undefined : write,
        output: values.output!,
        projectId: values.projectId,
        token: values.token,
      })
    : undefined
  if (options.json) {
    write(JSON.stringify(options.exportHistory ? { ...result, exported: exported ?? null } : result, null, 2))
    return
  }
  const scope = result.folderId ? ` in folder ${result.folderId}` : ''
  write(`${result.records.length} recently updated API(s)${result.user ? ` last edited by ${result.user}` : ''} in the last ${result.days} day(s)${scope}. Latest editors only, not a full audit history.`)
  for (const record of result.records)
    write(`- ${formatApiChange(record)}`)
  if (options.exportHistory)
    write(exported ? `Exported ${exported.documents.length} matching API detail file(s) to ${exported.output}.` : 'No matching APIs; no files exported.')
}

async function runExport(options: CliOptions, environment: Environment, write: Writer, cwd: string): Promise<void> {
  if (options.global || options.force || options.json)
    throw new Error('Export does not support --global, --force, or --json.')
  if (options.check && options.dryRun)
    throw new Error('Use either --check or --dry-run, not both.')
  const configuration = await getResolvedConfiguration(options, environment, cwd)
  const { values } = configuration
  if (!values.projectId || !values.token) {
    throw new Error('Set APIFOX_PROJECT_ID and APIFOX_TOKEN, configure afx init --global, or pass --project-id and --token.')
  }
  const result = await exportOpenApi({
    apiIds: values.apiIds,
    baseUrl: values.baseUrl,
    includeMetadata: options.includeMetadata,
    moduleId: options.moduleId,
    check: options.check,
    dryRun: options.dryRun,
    exportFormat: values.exportFormat,
    exportUrlTemplate: values.exportUrlTemplate,
    fileNameTemplate: values.fileNameTemplate,
    folderIds: values.folderIds,
    onProgress: write,
    output: values.output!,
    projectId: values.projectId,
    token: values.token,
  })
  const outputDirectory = result.output.replace(/[/\\]+$/, '')
  const locations = result.documents.map(document => `${outputDirectory}/${document.file}`)
  const formatLabel = (values.exportFormat ?? 'JSON').toLowerCase()
  const summary = `${result.operations} operations, ${result.tags} tags, ${result.bytes} bytes`
  if (options.dryRun)
    write(`Dry run: ${result.documents.length} OpenAPI ${formatLabel} file(s) would be ${result.changed ? 'updated' : 'unchanged'}. ${summary}.`)
  else if (options.check)
    write(`OpenAPI ${formatLabel} is up to date: ${locations.join(', ')}. ${summary}.`)
  else write(`${result.changed ? 'Exported' : `OpenAPI ${formatLabel} is unchanged:`} ${locations.join(', ')}. ${summary}.`)
}

export function getHelpText(): string {
  return `Usage: afx [options]
       afx init [options]
       afx config [options]

Commands:
  init                         Create project configuration
  init --global                Create user configuration, including an optional token
  config                       Show resolved configuration and field sources
  history                      List recent API updates and their latest editor IDs

Export options:
  -a, --api-id <ids>           API IDs, repeated or comma-separated
  -f, --folder-id <ids>        Folder IDs, repeated or comma-separated
  -p, --project-id <id>        Apifox project ID
  -t, --token <token>          Apifox access token
  -o, --output <dir>           Output directory (default: docs/apifox)
  -b, --base-url <url>         Apifox API base URL (default: ${DEFAULT_BASE_URL})
  --days <1|3>                 History window in days (default: 1)
  -u, --user <id>              Optional latest editorUserId filter (no names)
  --config <file>              Project configuration file
  --global-config <file>       User configuration file
  --include-metadata           Include detail metadata (requires API IDs; no folders)
  --export                     Export matching history APIs with metadata
  --module-id <id>              Export a module or filter history by module
  --check                      Fail when output differs; do not write
  --dry-run                    Show changes; do not write
  --export-format <format>     Export format: JSON or YAML (default: JSON)
  --export-url-template <url>  Export URL template
  --file-name-template <tpl>   Selected export file name (default: {id}.openapi.json)
  --force                      Replace a config file during init
  --json                       Machine-readable output from config
  -h, --help                   Show this help
`
}

export async function runCli(
  argv: string[],
  environment: Environment = process.env,
  write: Writer = message => console.log(message),
  cwd: string = process.cwd(),
): Promise<void> {
  const options = parseCli(argv)
  if (options.moduleId !== undefined && options.command !== 'export' && options.command !== 'history')
    throw new Error('--module-id is only supported by export and history.')
  if (options.exportHistory && options.command !== 'history')
    throw new Error('--export is only supported by history.')
  if (options.help) {
    write(getHelpText())
    return
  }
  if (options.command === 'init')
    return runInit(options, environment, write, cwd)
  if (options.command === 'config')
    return runConfig(options, environment, write, cwd)
  if (options.command === 'history')
    return runHistory(options, environment, write, cwd)
  return runExport(options, environment, write, cwd)
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  try {
    await runCli(argv)
  }
  catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}

if (import.meta.url === new URL(process.argv[1] ?? '', 'file:').href)
  void main()
