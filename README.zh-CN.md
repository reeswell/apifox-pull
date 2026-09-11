# apifox-pull

[English](./README.md) | 简体中文

将 [Apifox](https://apifox.com/) 项目导出为 OpenAPI 3.1 JSON。包名为 `apifox-pull`，命令行为 `afx`。

## 安装、配置、导出

```bash
pnpm add -g apifox-pull
afx init --global --project-id 6400879 --token 'your-access-token'
```

导出整个项目：

```bash
afx
```

导出某个文件夹或单个接口：

```bash
afx -f 123456
afx -a 78
```

需要 Node.js 18 及以上。Access Token 需要对 Apifox 项目具备读权限。

## 配置

`afx init` 会在当前目录创建 `apifox-pull.config.json`，只保存非敏感的项目默认值：

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

项目配置不允许包含 `token`。凭证和共享默认值请放到用户配置中：

```bash
afx init --global --project-id 6400879 --token 'your-access-token'
```

默认用户配置路径为 `~/.config/apifox-pull/apifox-pull.config.json`，遵循 `XDG_CONFIG_HOME`。也可通过 `APIFOX_PULL_GLOBAL_CONFIG` 或 `--global-config <file>` 指定其他路径。全局配置文件权限为 `0600`，请妥善保管：

```bash
chmod 600 ~/.config/apifox-pull/apifox-pull.config.json
```

查看最终生效配置及各字段来源：

```bash
afx config
afx config --json
```

输出中的 token 始终会被脱敏。各字段按以下优先级独立解析：

1. CLI 参数
2. 环境变量
3. 项目级 `apifox-pull.config.json`
4. 用户配置
5. 内置默认值：`baseUrl`、`output`、`exportFormat`、`fileNameTemplate`

因此可以在项目配置里只写 `folderIds`，而让 `projectId` 与 `token` 来自用户配置。支持的环境变量：`APIFOX_API_IDS`、`APIFOX_FOLDER_IDS`、`APIFOX_PROJECT_ID`、`APIFOX_TOKEN`、`APIFOX_OUTPUT`、`APIFOX_BASE_URL`、`APIFOX_EXPORT_FORMAT`、`APIFOX_EXPORT_URL_TEMPLATE`、`APIFOX_FILE_NAME_TEMPLATE`。

## 用法

默认会把整个项目导出到 `docs/apifox/openapi.json`。指定目标时会各自生成独立文件：

```bash
afx -f 12,34
afx -a 56 -a 78
afx -f 12 -a 78
```

默认导出 **OpenAPI JSON**；可用配置项 `exportFormat`、环境变量 `APIFOX_EXPORT_FORMAT` 或参数 `--export-format` 改为 `YAML`。

文件夹与单个 API 的默认文件名：JSON 为 `<id>.openapi.json`，YAML 为 `<id>.openapi.yaml`。可通过配置项 `fileNameTemplate`、环境变量 `APIFOX_FILE_NAME_TEMPLATE` 或参数 `--file-name-template` 自定义。支持占位符：`{id}`、`{name}`、`{type}`。例如：`{name}-{id}.openapi.json`。名称不可用时，`{name}` 会回退为 `folder` 或 `api`。

常用导出参数：

| 参数 | 说明 |
| --- | --- |
| `-f, --folder-id <ids>` | 文件夹 ID，可重复或逗号分隔 |
| `-a, --api-id <ids>` | 接口 ID，可重复或逗号分隔 |
| `-p, --project-id <id>` | Apifox 项目 ID |
| `-t, --token <token>` | 本次导出使用的 Access Token |
| `-o, --output <dir>` | 输出目录 |
| `--export-format <format>` | 导出格式：`JSON` 或 `YAML`（默认：`JSON`） |
| `--file-name-template <tpl>` | 选定导出的文件名（默认随格式：`{id}.openapi.json` / `{id}.openapi.yaml`） |
| `--check` | 与已有文件不一致时失败，且不写入 |
| `--dry-run` | 仅报告将发生的变更，不写入 |
| `--config <file>` | 项目配置文件路径 |
| `--global-config <file>` | 用户配置文件路径 |
| `--export-url-template <url>` | 覆盖导出 URL；支持 `{baseUrl}`、`{projectId}` |

默认请求为 `POST https://api.apifox.com/v1/projects/{projectId}/export-openapi`，请求头 `X-Apifox-Api-Version: 2024-03-28`。文件夹导出会直接调用该 OpenAPI 导出接口，不会额外请求 API 树。

在 CI 中可用 `--check` 确保已提交的导出结果是最新的：

```bash
APIFOX_TOKEN="$APIFOX_TOKEN" afx --check
```

## 开发

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
