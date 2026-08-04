# Project Context Service

> **类型：Platform Service**（确定性逻辑，不需要 LLM）

## 定位

检索和维护项目级别的全局知识。从 OpenAPI 结构字段中提取项目约定（base_url、分页方式、认证类型等），纯规则匹配，不涉及推理。

**粒度：Project 级。** 一个 Project 聚合其关联的多个 Repository（可跨 Organization），项目约定从这些 Repository 的 OpenAPI 中提取并合并。V0 阶段 Project 实体未实现，本服务随 Project 在 V1+ 提供。

## 输入

| 字段 | 类型 | 说明 |
|------|------|------|
| `project_id` | `string` | 项目 ID |

## 输出

```typescript
interface ProjectContext {
  project_id: string;
  name: string;
  description: string;
  
  // 认证
  auth: {
    type: 'bearer' | 'api_key' | 'oauth2' | 'basic' | 'none';
    details: AuthDetail;
    default_header: string;       // "Authorization: Bearer <token>"
  };
  
  // 领域概念
  domain: {
    entities: DomainEntity[];     // 核心业务实体
    glossary: GlossaryEntry[];    // 术语表
  };
  
  // API 约定
  conventions: {
    base_url: string;
    version_strategy: 'path' | 'header' | 'query';  // /v1/ vs X-API-Version
    date_format: string;          // ISO 8601
    pagination: PaginationStyle;
    error_format: ErrorFormat;
  };
  
  // 通用模型
  common_models: {
    name: string;
    schema: SchemaDef;
  }[];
}
```

## 核心能力

### 1. 自动提取

从已导入的 API 中自动提取项目级约定：
- `base_url`：从 OpenAPI `servers[0].url` 提取
- `pagination`：检测分页参数模式（offset/limit vs cursor）
- `error_format`：从 responses 中的 error schema 推断
- `date_format`：检测日期字段的 format 属性

### 2. 领域概念管理

- 从 API tag、summary 中提取高频业务实体
- 人工可补充定义（如 "Order 指代用户提交的购买请求"）
- Agent 查询时可引用领域概念

### 3. 全局配置变更影响分析

- 当 `base_url` 变更时，通知所有引用此项目的外部 Agent
- 认证方式变更时，标记为 `breaking_change`

## 行为规范

1. **单一数据源**：每个项目只有一份 Project Context
2. **变更通知**：关键配置变更主动通知 MCP Gateway
3. **自动补全**：未检测到的配置允许人工填写

## 依赖

- 上游：OpenAPI Parser Service（从项目关联的 Repository 提取）
- 下游：MCP Gateway、Business Context Agent

## 触发方式

- MCP Gateway 调用 `get_project_context` tool（V1+，随 Project 提供）
- 项目创建/更新时自动构建
- API 导入后增量更新

## 边界情况

| 场景 | 行为 |
|------|------|
| 新项目（无 API 导入） | 返回空白模板，所有字段 `null`，引导用户填写 |
| 多环境（dev/staging/prod） | 每个环境独立的 base_url，存储为数组 |
| 认证类型混合（部分 API 不同认证） | 主认证类型作为 default，例外 API 在各 API 的 security 中标记 |
