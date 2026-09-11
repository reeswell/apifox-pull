import type { ExportFormat, ExportTarget, OpenApiDocument, OpenApiExportOptions, OpenApiExportResult } from './types'
// @env node
import { Buffer } from 'node:buffer'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { stringify as stringifyYaml } from 'yaml'
import { requestApifoxJson } from './client'
import {
  DEFAULT_BASE_URL,
  DEFAULT_EXPORT_FORMAT,
  DEFAULT_FILE_NAME_TEMPLATE,
  DEFAULT_OAS_VERSION,
  DEFAULT_OUTPUT_FILE,
  DEFAULT_OUTPUT_FILE_YAML,
} from './constants'

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonRecord : undefined
}

function formatUrlTemplate(template: string, values: Record<string, string>): string {
  return template.replaceAll(/\{(\w+)\}/g, (_: string, key: string) => {
    const value = values[key]
    if (value === undefined) {
      throw new Error(`Unknown URL template placeholder: {${key}}`)
    }
    return key === 'baseUrl' ? value : encodeURIComponent(value)
  })
}

function formatFileNameTemplate(template: string, values: Record<string, string>): string {
  const file = template.replaceAll(/\{(\w+)\}/g, (_: string, key: string) => {
    const value = values[key]
    if (value === undefined) {
      throw new Error(`Unknown file name template placeholder: {${key}}`)
    }
    return value
  })
  if (!file || file === '.' || file === '..' || file.includes('/') || file.includes('\\')) {
    throw new Error(`Invalid output file name from template: ${file || '(empty)'}`)
  }
  return file
}

export function getOpenApiExportUrl(baseUrl: string, projectId: string, template?: string): string {
  if (template) {
    return formatUrlTemplate(template, { baseUrl, projectId })
  }
  return `${baseUrl}/projects/${encodeURIComponent(projectId)}/export-openapi`
}

function toNumericIds(ids: Iterable<string>, label: string): number[] {
  return [...ids].map((id) => {
    const numericId = Number(id)
    if (!Number.isInteger(numericId)) {
      throw new TypeError(`Invalid ${label} ID (expected integer): ${id}`)
    }
    return numericId
  })
}

export function planExportTargets(apiIds: string[] = [], folderIds: string[] = []): ExportTarget[] {
  const targets: ExportTarget[] = [
    ...[...new Set(folderIds)].map(id => ({ id, type: 'FOLDER' as const })),
    ...[...new Set(apiIds)].map(id => ({ id, type: 'API' as const })),
  ]
  return targets.length > 0 ? targets : [{ type: 'ALL' }]
}

function getExportScope(target: ExportTarget): JsonRecord {
  if (target.type === 'FOLDER') {
    return { selectedFolderIds: toNumericIds([target.id], 'folder'), type: 'SELECTED_FOLDERS' }
  }
  if (target.type === 'API') {
    return { selectedEndpointIds: toNumericIds([target.id], 'API'), type: 'SELECTED_ENDPOINTS' }
  }
  return { type: 'ALL' }
}

function countOperations(document: unknown): number {
  const paths = asRecord(asRecord(document)?.paths)
  if (!paths)
    return 0
  const names = new Set(['delete', 'get', 'head', 'options', 'patch', 'post', 'put', 'trace'])
  return Object.values(paths).reduce<number>(
    (count, item) => count + Object.keys(asRecord(item) ?? {}).filter(name => names.has(name.toLowerCase())).length,
    0,
  )
}

function countTags(document: unknown): number {
  const tags = asRecord(document)?.tags
  return Array.isArray(tags) ? tags.length : 0
}

function getFolderName(document: unknown): string | undefined {
  const tags = asRecord(document)?.tags
  const tag = Array.isArray(tags) ? asRecord(tags[0]) : undefined
  return typeof tag?.name === 'string' && tag.name.trim() ? tag.name.trim() : undefined
}

function getOperationName(document: unknown): string | undefined {
  const paths = asRecord(asRecord(document)?.paths)
  for (const item of Object.values(paths ?? {})) {
    for (const operation of Object.values(asRecord(item) ?? {})) {
      const record = asRecord(operation)
      const name = record?.summary ?? record?.operationId
      if (typeof name === 'string' && name.trim())
        return name.trim()
    }
  }
}

function getDocumentTitle(document: unknown): string | undefined {
  const title = asRecord(asRecord(document)?.info)?.title
  return typeof title === 'string' && title.trim() ? title.trim() : undefined
}

export function toSafeFileSegment(value: string): string {
  return [...value]
    .map(character => character.charCodeAt(0) < 32 ? '-' : character)
    .join('')
    .replaceAll(/[<>:"/\\|?*]/g, '-')
    .replaceAll(/\s+/g, '-')
    .replaceAll(/-+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 80)
}

export function serializeOpenApiDocument(document: unknown, exportFormat: ExportFormat = DEFAULT_EXPORT_FORMAT): string {
  if (exportFormat === 'YAML')
    return stringifyYaml(document)
  return `${JSON.stringify(document, null, 2)}\n`
}

export function getOpenApiOutputFile(
  target: ExportTarget,
  document: unknown,
  fileNameTemplate: string = DEFAULT_FILE_NAME_TEMPLATE,
  exportFormat: ExportFormat = DEFAULT_EXPORT_FORMAT,
): string {
  if (target.type === 'ALL')
    return exportFormat === 'YAML' ? DEFAULT_OUTPUT_FILE_YAML : DEFAULT_OUTPUT_FILE
  const label = target.type === 'FOLDER'
    ? getFolderName(document) ?? getDocumentTitle(document) ?? 'folder'
    : getOperationName(document) ?? getDocumentTitle(document) ?? 'api'
  const name = toSafeFileSegment(label) || target.type.toLowerCase()
  return formatFileNameTemplate(fileNameTemplate, {
    id: target.id,
    name,
    type: target.type.toLowerCase(),
  })
}

function getUniqueOutputFile(file: string, target: ExportTarget, usedFiles: Set<string>): string {
  if (!usedFiles.has(file))
    return file

  const kind = target.type.toLowerCase()
  const insertBeforeFinalName = (name: string, insert: string): string => {
    for (const extension of ['.openapi.json', '.openapi.yaml', '.openapi.yml']) {
      if (name.endsWith(extension))
        return `${name.slice(0, -extension.length)}${insert}${extension}`
    }
    const lastDot = name.lastIndexOf('.')
    if (lastDot <= 0)
      return `${name}${insert}`
    return `${name.slice(0, lastDot)}${insert}${name.slice(lastDot)}`
  }

  let candidate = insertBeforeFinalName(file, `-${kind}`)
  let index = 2
  while (usedFiles.has(candidate)) {
    candidate = insertBeforeFinalName(file, `-${kind}-${index}`)
    index++
  }
  return candidate
}

async function readExistingSnapshot(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8')
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return undefined
    throw error
  }
}

export async function exportOpenApi({
  apiIds = [],
  baseUrl = DEFAULT_BASE_URL,
  check = false,
  dryRun = false,
  exportFormat = DEFAULT_EXPORT_FORMAT,
  exportUrlTemplate,
  fetcher = fetch,
  fileNameTemplate = DEFAULT_FILE_NAME_TEMPLATE,
  folderIds = [],
  onProgress,
  output,
  projectId,
  token,
}: OpenApiExportOptions): Promise<OpenApiExportResult> {
  if (check && dryRun)
    throw new Error('Use either check mode or dry-run mode, not both.')
  const documents: OpenApiDocument[] = []
  const usedFiles = new Set<string>()
  const url = getOpenApiExportUrl(baseUrl.replace(/\/+$/, ''), projectId, exportUrlTemplate)
  const formatLabel = exportFormat.toLowerCase()

  for (const target of planExportTargets(apiIds, folderIds)) {
    onProgress?.(target.type === 'ALL' ? `Exporting OpenAPI ${formatLabel}...` : `Exporting ${target.type.toLowerCase()} ${target.id}...`)
    const document = await requestApifoxJson(fetcher, url, token, {
      body: {
        exportFormat,
        oasVersion: DEFAULT_OAS_VERSION,
        options: { addFoldersToTags: true, includeApifoxExtensionProperties: false },
        scope: getExportScope(target),
      },
      method: 'POST',
    })
    const file = getUniqueOutputFile(getOpenApiOutputFile(target, document, fileNameTemplate, exportFormat), target, usedFiles)
    usedFiles.add(file)
    const content = serializeOpenApiDocument(document, exportFormat)
    const changed = await readExistingSnapshot(path.join(output, file)) !== content
    const exported: OpenApiDocument = {
      bytes: Buffer.byteLength(content),
      changed,
      file,
      operations: countOperations(document),
      tags: countTags(document),
      target,
    }
    documents.push(exported)

    if (check && changed)
      throw new Error(`OpenAPI snapshot is out of date: ${path.join(output, file)}. Run afx to update it.`)
    if (!check && !dryRun && changed) {
      await mkdir(output, { recursive: true })
      await writeFile(path.join(output, file), content)
    }
  }

  const result: OpenApiExportResult = {
    bytes: documents.reduce((total, document) => total + document.bytes, 0),
    changed: documents.some(document => document.changed),
    documents,
    file: documents.length === 1 ? documents[0]?.file : undefined,
    operations: documents.reduce((total, document) => total + document.operations, 0),
    output,
    tags: documents.reduce((total, document) => total + document.tags, 0),
  }
  if (dryRun)
    onProgress?.(result.changed ? 'Dry run complete; snapshots would be updated.' : 'Dry run complete; snapshots are unchanged.')
  else if (check)
    onProgress?.('Snapshots are up to date.')
  else onProgress?.(result.changed ? `OpenAPI ${formatLabel} snapshots written.` : `OpenAPI ${formatLabel} snapshots are unchanged.`)
  return result
}
