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
  includeMetadata?: boolean
  moduleId?: string
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

export interface ApiChangeRecord {
  id: number
  name: string
  method: string
  path: string
  folderId: number
  updatedAt: string
  editorUserId: number
}

export interface ApiChangeOptions {
  baseUrl?: string
  days?: 1 | 3
  fetcher?: typeof fetch
  folderId?: string
  moduleId?: string
  now?: Date
  projectId: string
  token: string
  user?: string
}

export interface ApiChangeResult {
  days: 1 | 3
  folderId?: string
  moduleId?: string
  from: string
  projectId: string
  records: ApiChangeRecord[]
  to: string
  user?: string
}
