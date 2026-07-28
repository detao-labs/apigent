# Business Context Agent

> **类型：AI Agent**（LLM 驱动，需要推理能力）

## 定位

知识层唯一需要 LLM 的核心 Agent。将 API 的文本描述（description/path/schema）推理转化为结构化业务知识：意图、使用场景、约束条件、副作用。

## 输入

| 字段 | 类型 | 说明 |
|------|------|------|
| `api` | `APIEntry` | 来自 OpenAPI Parser 的 API 结构 |
| `project_context` | `ProjectContext` | 项目全局上下文（认证方式、领域术语等） |
| `human_annotations?` | `string` | 人工添加的业务描述 |

## 输出

```typescript
interface EnrichedAPI {
  api_id: string;
  
  // 技术层（来自 Parser）
  technical: {
    method: string;
    path: string;
    schema: APISchema;
  };
  
  // 业务层（本 Agent 产出）
  business: {
    intent: string;              // 业务意图："用于处理订单退款"
    when_to_use: string[];      // 使用场景
    when_not_to_use: string[];  // 不适用场景
    constraints: BusinessRule[];
    side_effects: string[];     // 副作用："扣除库存"、"发送通知"
  };
  
  // 示例层
  examples: {
    request: ExampleValue[];
    response: ExampleValue[];
    error: ExampleValue[];      // 常见错误
  };
  
  // 元数据
  confidence: number;           // 自动推断置信度 (0-1)
  needs_review: boolean;        // 是否需要人工确认
}
```

## 核心能力

### 1. 自动推断

基于 Schema 结构 + 命名模式自动推断业务含义：

| 输入信号 | 推断结果 |
|---------|---------|
| `POST /orders/{id}/refund` | 意图: "订单退款"，副作用: "创建退款单" |
| 参数包含 `amount` / `currency` | 约束: "金额需 > 0" |
| response 包含 `error_code` | 示例层填充常见错误码 |
| tag 包含 `[admin]` | 约束: "需要管理员权限" |

### 2. 人工标注融合

- 人工标注优先级高于自动推断
- 当 `confidence < 0.6` 时，标记 `needs_review: true`
- 人工确认后，该标注作为未来推断的 few-shot 参考

### 3. 规则约束提取

从 `description` / `summary` 文本中提取约束：

```
输入: "Refund can only be requested for paid orders within 7 days."
提取: [
  { type: "precondition", rule: "订单状态 = 已支付" },
  { type: "time_limit", rule: "支付后 7 天内" }
]
```

## 行为规范

1. **不过度推断**：不确定性高时不强行标注，留 `needs_review`
2. **可覆盖**：所有自动推断项允许人工修改
3. **版本化**：业务知识变更记录版本历史

## 依赖

- 上游：OpenAPI Parser Agent
- 下游：Knowledge Graph Agent、Knowledge Retrieval Agent
- 辅助：需要 LLM 支持（RAG 层提供 embedding）

## 触发方式

- OpenAPI Parser 完成解析后自动触发
- 用户手动编辑业务上下文后重新推断
- Project Context 变更时重新计算受影响 API

## 边界情况

| 场景 | 行为 |
|------|------|
| API 无 description 字段 | 仅基于 path/method/schema 推断，confidence 较低 |
| 非英文描述 | 检测语言并保留原文，部分规则用 LLM 翻译后提取 |
| 同一 API 在不同 Project 中有不同业务含义 | 按 Project 隔离存储，允许差异化 |
