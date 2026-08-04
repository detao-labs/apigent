# OpenAPI Parser Service

> **类型：Platform Service**（确定性逻辑，不需要 LLM）

## 定位

知识构建层的入口模块。负责将外部 API 规范（OpenAPI/Swagger）解析为 Apigent 内部统一的 API Model。纯解析和校验逻辑，不涉及 AI 推理。

**粒度：Repository 级。** 解析对象是某个 Organization 下的一个 Repository 所持有的单份 OpenAPI 文件，输出的是该仓库的技术模型（method/path/schema）；业务知识不在此层产生。

## 输入

| 字段 | 类型 | 说明 |
|------|------|------|
| `source` | `file` \| `url` \| `text` | 输入来源类型 |
| `content` | `string` | OpenAPI JSON/YAML 内容或 URL |
| `repo_id` | `string` | 所属 Repository ID |

## 输出

```typescript
interface ParsedAPIModel {
  repo_id: string;
  apis: APIEntry[];
  schemas: SchemaEntry[];
  parse_issues: ParseIssue[];   // 校验问题：warning 不阻塞，error 跳过该 API
  meta: {
    openapi_version: string;
    parsed_at: number;
    source_url?: string;
  };
}

interface ParseIssue {
  api_id?: string;              // 关联的 API（error 级时该 API 被跳过）
  severity: "warning" | "error";
  message: string;
}

interface APIEntry {
  id: string;                    // 自动生成：{method}:{path}
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  summary: string;
  description: string;
  parameters: Parameter[];
  request_body?: SchemaRef;
  responses: Record<string, ResponseDef>;
  tags: string[];
  security: SecurityRequirement[];
}
```

## 核心能力

### 1. 多版本兼容
- 支持 OpenAPI 2.0 (Swagger)、3.0.x、3.1.x
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

| 场景 | 行为 |
|------|------|
| 超大文件（>10MB, >500 paths） | 分批解析，每批 100 个 path |
| 空文件 / 无效 JSON | 返回 error 级 `ParseIssue`，不崩溃 |
| 已在其他 Repository 导入过同一文件 | 提示确认，支持跨仓库复用 API Model |
| 中文/特殊字符的 path/summary | 完整保留，不做转义 |
