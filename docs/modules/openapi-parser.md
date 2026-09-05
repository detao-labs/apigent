# OpenAPI Parser Service

> **类型：Platform Service**（确定性逻辑，不需要 LLM）

## 定位

知识构建层的入口模块。负责将外部 API 规范（OpenAPI/Swagger）解析为 Apigent 内部统一的 API Model。纯解析和校验逻辑，不涉及 AI 推理。

**粒度：Repository 级。** 解析对象是某个 Organization 下的一个 Repository 所持有的单份 OpenAPI 文件，输出的是该仓库的技术模型（method/path/schema）；业务知识不在此层产生。

## 输入

| 字段      | 类型                      | 说明                         |
| --------- | ------------------------- | ---------------------------- |
| `source`  | `file` \| `url` \| `text` | 输入来源类型                 |
| `content` | `string`                  | OpenAPI JSON/YAML 内容或 URL |
| `repo_id` | `string`                  | 所属 Repository ID           |

## 输出

```typescript
interface ParsedAPIModel {
  repo_id: string;
  apis: APIEntry[];
  schemas: SchemaEntry[];
  componentDefs: ComponentDef[]; // 可复用组件定义（responses / securitySchemes …）
  parse_issues: ParseIssue[]; // 校验问题：warning 不阻塞，error 跳过该 API
  meta: {
    openapi_version: string;
    parsed_at: number;
    source_url?: string;
  };
}

interface ParseIssue {
  api_id?: string; // 关联的 API（error 级时该 API 被跳过）
  severity: "warning" | "error";
  message: string;
}

interface APIEntry {
  id: string; // 自动生成：{method}:{path}
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  path: string;
  summary: string;
  description: string;
  parameters: Parameter[];
  request_body?: SchemaRef;
  responses: Record<string, ResponseDef>;
  tags: string[];
  security: SecurityRequirement[];
}

interface ComponentDef {
  kind: "response" | "securityScheme" | "parameter" | "requestBody" | "header" | "example";
  name: string;
  def_type?: string; // 展示型类型提示，如 securityScheme → http / apiKey / oauth2
  description?: string;
  payload: Record<string, unknown>; // 原始定义
}
```

## 核心能力

### 1. 多版本兼容

- 完整支持 OpenAPI 3.0.x、3.1.x；3.2.x 宽容解析（警告）
- Swagger 2.0 暂不支持，导入时提示先转换为 OpenAPI 3.0+
- 自动检测并归一化为内部 Model
- 非标准扩展字段保留在 `x-*` 字段中

### 2. Schema 展开

- 自动展开 `$ref` 引用为内联结构（展开深度可配置，默认 3 层）
- 循环引用检测：记录引用路径，标记为 `circular_ref`
- 保留原始 `$ref` 路径，便于后续追溯

### 3. 增量更新

- 与已有 API Model 比对，生成 Diff
- 发出 `api.created` / `api.updated` / `api.deleted` 事件
- 仅变更的 API 进入下游处理管道

### 4. 校验

- Schema 完整性检查（必填字段、类型一致性）
- 不合规项生成 `ParseIssue`，不阻塞解析
- 错误分级：`warning`（可继续，计入 `parse_issues`）/ `error`（该 API 被跳过并计入 `parse_issues`）

### 5. 组件提取（components.*）

与 `components.schemas` 同构，解析器同时提取可复用组件定义，作为独立于接口的定义资产：

| 组件 | OpenAPI 键 | 提取内容 |
| --- | --- | --- |
| 响应组件 | `components.responses` | `name`、`description`、`content` 首个媒体类型、`schema`（作为 `SchemaRef`） |
| 鉴权组件 | `components.securitySchemes` | `name`、`type`（http / apiKey / oauth2 / openIdConnect）、`in`、`scheme`、`bearerFormat`、`flows` |
| 参数 / 请求体等 | `components.parameters` / `requestBodies` / `headers` / `examples` | `name` + 原始定义（`payload`） |

统一建模为 `ComponentDef { kind, name, def_type, description, payload }`：`payload` 保留原始定义，`def_type` 为展示型类型提示（如 securityScheme → http / apiKey / oauth2）。落库时与 `data_models` 同构（`version_id` + `repo_id` + `kind` + `name` + JSON payload），随版本快照写入，供「模型 / 组件」页按 `kind` 分组浏览与后续管理——不内嵌到接口详情，避免与接口级响应 / 鉴权混杂。

## 行为规范

1. **幂等**：同一份 OpenAPI 规范重复导入，结果不变
2. **非破坏**：解析失败不影响已有 API 数据
3. **可追溯**：每个 API 记录来源（source_url, imported_at）

## 依赖

- 无上游 Agent 依赖（入口 Agent）
- 下游：Business Context Agent、Knowledge Graph Service（V1+ 可选）

## 触发方式

- 用户通过 Web UI 上传文件
- 用户输入 OpenAPI URL
- CI/CD Webhook 自动同步

## 边界情况

| 场景                               | 行为                               |
| ---------------------------------- | ---------------------------------- |
| 超大文件（>10MB, >500 paths）      | 分批解析，每批 100 个 path         |
| 空文件 / 无效 JSON                 | 返回 error 级 `ParseIssue`，不崩溃 |
| 已在其他 Repository 导入过同一文件 | 提示确认，支持跨仓库复用 API Model |
| 中文/特殊字符的 path/summary       | 完整保留，不做转义                 |
