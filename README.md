# apifox-pull

[English](./README.md) | [简体中文](./README.zh-CN.md)

Export an [Apifox](https://apifox.com/) project as OpenAPI 3.1 JSON. The package is named `apifox-pull`; its one command is `afx`.

## Install, configure, export

```bash
pnpm add -g apifox-pull
afx init --global --project-id 6400879 --token 'your-access-token'
```

Export the whole project:

```bash
afx
```

Export a folder or an individual API:

```bash
afx -f 123456
afx -a 78
```

Node.js 18 or newer is required. The access token needs read permission for the Apifox project.

## Configuration

`afx init` creates `apifox-pull.config.json` in the current directory. It stores non-secret project defaults only:

```bash
afx init --project-id 6400879 --folder-id 123456 --output docs/apifox
```

```json
{
  "folderIds": ["123456"],
  "output": "docs/apifox",
  "projectId": "6400879"
}
```

Project config rejects a `token` key. Use a user config for credentials and shared defaults instead:

```bash
afx init --global --project-id 6400879 --token 'your-access-token'
```

The default user config location is `~/.config/apifox-pull/apifox-pull.config.json`. `XDG_CONFIG_HOME` is respected. Use `APIFOX_PULL_GLOBAL_CONFIG` or `--global-config <file>` to select another path. Global configuration files are written with `0600` permissions; keep them private:

```bash
chmod 600 ~/.config/apifox-pull/apifox-pull.config.json
```

Inspect the effective settings and where every value came from:

```bash
afx config
afx config --json
```

The token is always redacted in this output. Values resolve independently in this order:

1. CLI options
2. Environment variables
3. Project `apifox-pull.config.json`
4. User configuration
5. Built-in defaults for `baseUrl`, `output`, `exportFormat`, and `fileNameTemplate`

This means a project can set `folderIds` while `projectId` and `token` come from user configuration. The supported environment variables are `APIFOX_API_IDS`, `APIFOX_FOLDER_IDS`, `APIFOX_PROJECT_ID`, `APIFOX_TOKEN`, `APIFOX_OUTPUT`, `APIFOX_BASE_URL`, `APIFOX_EXPORT_FORMAT`, `APIFOX_EXPORT_URL_TEMPLATE`, and `APIFOX_FILE_NAME_TEMPLATE`.

## Usage

`afx` exports the whole project to `docs/apifox/openapi.json` by default. Selected targets remain independent files:

```bash
afx -f 12,34
afx -a 56 -a 78
afx -f 12 -a 78
```

Exports **OpenAPI JSON** by default. Set `exportFormat`, `APIFOX_EXPORT_FORMAT`, or `--export-format` to `YAML` for YAML output.

Folders and APIs default to `<id>.openapi.json` (or `<id>.openapi.yaml` when the format is YAML). Customize with `fileNameTemplate` (config), `APIFOX_FILE_NAME_TEMPLATE`, or `--file-name-template`. Supported placeholders: `{id}`, `{name}`, `{type}`. Example: `{name}-{id}.openapi.json`. When a name is unavailable, `{name}` falls back to `folder` or `api`.

Useful export options:

| Option | Description |
| --- | --- |
| `-f, --folder-id <ids>` | Folder IDs, repeated or comma-separated |
| `-a, --api-id <ids>` | API IDs, repeated or comma-separated |
| `-p, --project-id <id>` | Apifox project ID |
| `-t, --token <token>` | Access token for this export |
| `-o, --output <dir>` | Output directory |
| `--export-format <format>` | Export format: `JSON` or `YAML` (default: `JSON`) |
| `--file-name-template <tpl>` | Selected export file name (default follows format: `{id}.openapi.json` / `{id}.openapi.yaml`) |
| `--check` | Fail when generated files differ; never write |
| `--dry-run` | Report pending changes; never write |
| `--config <file>` | Project config path |
| `--global-config <file>` | User config path |
| `--export-url-template <url>` | Override the export URL; supports `{baseUrl}` and `{projectId}` |

The default request is `POST https://api.apifox.com/v1/projects/{projectId}/export-openapi` with `X-Apifox-Api-Version: 2024-03-28`. Folder exports call this OpenAPI export endpoint directly; there is no API-tree request.

Use `--check` in CI to ensure committed output is current:

```bash
APIFOX_TOKEN="$APIFOX_TOKEN" afx --check
```

## Export recent updates by module and editor

```bash
afx history --module-id 4304445 --user 2684381 --days 3 --export
```

Filters the module's APIs by their latest editor and update time, then exports each matching API with metadata. Omit `--user` for all editors; combine with `--folder-id` for a narrower scope.

## Export an entire module

```bash
afx --project-id 6400879 --module-id 4304445 --output docs/apifox
```

The CLI-only `--module-id` option exports every API in the module to `module-4304445.openapi.json` (or `.yaml`). Supports `--check` and `--dry-run`. It cannot be combined with API/folder IDs (including configured IDs), or `--include-metadata`. No recent-update filter is applied in this mode; use `history` above to filter by editor.

## Include API metadata

```bash
afx -a 492352338 --include-metadata
```

This CLI-only flag requires API IDs (one or more); folder and whole-project exports are not supported yet. It additionally requests `/api/v1/projects/{projectId}/http-apis/{apiId}` and adds returned `createdAt`, `updatedAt`, `creatorId`, `editorId`, `creatorUserId`, `editorUserId`, `responsibleId`, and `folderId` fields to each operation's `x-apifox-metadata`, in both JSON and YAML.

Timestamps retain their original ISO format. People and folders remain IDs, not inferred names; `responsibleId: 0` means unassigned, and missing fields are omitted. Requests use the existing Bearer token. This is an internal browser endpoint; system access-token compatibility is not verified. Authorization failures or mismatched details fail the command without writing that API file. Omit the flag to retain the original export behavior. Browser cookies are neither used nor stored.

## Query recently changed APIs

List HTTP APIs updated in the last 24 hours (default) or 72 hours:

```bash
afx history --days 3
afx history --user 2684381 --days 3
afx history --user 2684381 --days 1 --folder-id 91839624 --json

# Query and export matching OpenAPI details
# Uses the configured output directory
afx history --user 2684381 --days 3 --export
```

`--export` writes each matching API as an OpenAPI file with confirmed creation/update times, creator/editor IDs, responsible ID and folder ID metadata. Empty results write no files. The optional `--user` filter accepts a numeric `editorUserId`, not a name. Results include API ID, name, method, path, folder ID, update time and latest editor ID. This reads the API list, not audit logs: only the current latest editor is reported, not every historical edit. All pages are fetched and totals checked; incomplete responses fail rather than silently omitting records. `projectId` and `token` come from the existing configuration or environment variables; `--folder-id` limits results to the exact folder ID.

## Development

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm pack --dry-run
```

## License

[MIT](./LICENSE)
