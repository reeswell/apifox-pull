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
