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

## 按模块和修改者筛选并导出

```bash
afx history --module-id 4304445 --user 2684381 --days 3 --export
```

这会读取模块 `4304445` 的接口列表，仅保留最近三天内 `editorUserId=2684381` 的接口，并将每个匹配接口导出到 `output` 目录。也可以省略 `--user` 查看模块内所有最近更新接口。`--module-id` 与 `--folder-id` 可同时使用以进一步缩小范围。

## 导出整个模块

```bash
afx --project-id 6400879 --module-id 4304445 --output docs/apifox
```

`--module-id` 是普通导出命令的 CLI 参数，导出该模块全部接口为 `module-4304445.openapi.json`（YAML 对应 `.yaml`）。支持 `--check` 和 `--dry-run`。不可与接口/目录 ID（包括配置中设置的 ID）或 `--include-metadata` 同用。普通模块导出不应用最近修改时间筛选；按修改者筛选请使用上面的 `history` 命令。

## 拉取接口元数据

```bash
afx -a 492352338 --include-metadata
```

此 CLI 参数仅支持按接口 ID 导出（可指定多个），暂不支持目录或全项目导出。它额外请求 `/api/v1/projects/{projectId}/http-apis/{apiId}`，将返回的 `createdAt`、`updatedAt`、`creatorId`、`editorId`、`creatorUserId`、`editorUserId`、`responsibleId`、`folderId` 写入对应 operation 的 `x-apifox-metadata`。JSON 和 YAML 均保留该字段。

时间保留原始 ISO 格式；人员和目录仅记录 ID，不推测名称。`responsibleId: 0` 表示未设置，未返回的字段不补值。详情使用现有 Bearer Token；这是浏览器内部接口，尚未确认系统级 Access Token 是否具备访问权限。如果鉴权失败或详情与导出接口不匹配，本次接口文件不会写入，命令报错；不加该参数仍按原方式导出。不会使用或存储浏览器 Cookie。

## 查询最近修改的接口

查看项目最近一天（默认）或三天内更新的 HTTP API：

```bash
# 全部最近更新的接口
afx history --days 3

# 只看最后修改者 editorUserId=2684381 的接口
afx history --user 2684381 --days 3

# 限定目录并输出 JSON
afx history --user 2684381 --days 1 --folder-id 91839624 --json

# 查询并导出匹配接口的 OpenAPI 详情
# 输出目录取自 output 配置
afx history --user 2684381 --days 3 --export
```

`--export` 会把匹配结果逐个导出为 OpenAPI 文件，并自动附加已确认的创建/修改时间、创建者/修改者 ID、责任人 ID 和目录 ID 元数据；没有匹配接口时不会写文件。`--user` 只接受数字形式的 `editorUserId`，暂不支持姓名。命令读取项目接口列表（不是审计日志），按 `updatedAt` 筛选时间范围，并展示接口 ID、名称、方法、路径、目录 ID、最后修改时间和最后修改者 ID。它表示“当前最后修改者”，不是完整的历史操作记录。查询会读取所有分页并校验总数；如果响应不完整会报错而不是返回误导性的空结果。`projectId` 和 `token` 默认从现有项目、用户配置或环境变量读取。

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
