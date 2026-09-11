export type ExportFormat = 'JSON' | 'YAML'

export type ConfigField
  = | 'apiIds'
    | 'baseUrl'
    | 'exportFormat'
    | 'exportUrlTemplate'
    | 'fileNameTemplate'
    | 'folderIds'
    | 'output'
    | 'projectId'
    | 'token'

export type ConfigurationSource = 'cli' | 'default' | 'environment' | 'global' | 'project'

export interface ConfigValues {
  apiIds?: string[]
  baseUrl?: string
  exportFormat?: ExportFormat
  exportUrlTemplate?: string
  fileNameTemplate?: string
  folderIds?: string[]
  output?: string
  projectId?: string
  token?: string
}

export interface ResolvedConfiguration {
  sources: Partial<Record<ConfigField, ConfigurationSource>>
  values: ConfigValues
}

export type ExportTarget
  = | { id?: undefined, type: 'ALL' }
    | { id: string, type: 'API' | 'FOLDER' }

export interface OpenApiExportOptions extends ConfigValues {
  check?: boolean
  dryRun?: boolean
  fetcher?: typeof fetch
  onProgress?: (message: string) => void
  output: string
  projectId: string
  token: string
}

export interface OpenApiDocument {
  bytes: number
  changed: boolean
  file: string
  operations: number
  tags: number
  target: ExportTarget
}

export interface OpenApiExportResult {
  bytes: number
  changed: boolean
  documents: OpenApiDocument[]
  file?: string
  operations: number
  output: string
  tags: number
}
