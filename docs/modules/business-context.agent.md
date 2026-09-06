# Business Context Agent

> **状态：** 部分实现——上下文服务与 agent 工具位于 `packages/server/src/contexts` 与 `packages/core/src/agent/business-context-tools.ts`。

> **类型：AI Agent**（LLM 驱动，需要推理能力）

## 定位

知识层唯一需要 LLM 的核心 Agent。将 API 的文本描述（description/path/schema）推理转化为**两类结构化业务知识**：

1. **能力上下文（Capability Context）——Repository 级（V0）**：提供方视角，描述这个后端项目**提供了哪些能力**：能力意图、后端强制的约束规则、副作用、示例。每个 Repository 一份。
2. **使用上下文（Usage Context）——Project 级（V1+）**：消费方视角，描述业务项目**使用了某个 Repository 的哪些能力、为什么用、怎么用**：使用场景、不适用场景、项目使用政策。按 `(project_id, repo_id)` 各存一份。

能力上下文是共享的（不管谁消费都成立），使用上下文是差异化的（同一接口在不同项目可以有不同用法）。

## 输入

| 字段                 | 类型             | 说明                                                             |
| -------------------- | ---------------- | ---------------------------------------------------------------- |
| `api`                | `APIEntry`       | 来自 OpenAPI Parser Service 的 API 技术模型（repo 级）           |
| `repo_id`            | `string`         | 所属 Repository（能力上下文粒度）                                |
| `project_id?`        | `string`         | 所属 Project（使用上下文粒度，V1+）                              |
| `project_context?`   | `ProjectContext` | 项目全局上下文（认证方式、领域术语等，V1+ 使用上下文推断时输入） |
| `human_annotations?` | `string`         | 人工添加的业务描述                                               |

## 输出

```typescript
// 能力上下文（Repository 级，V0）—— 提供方视角
interface CapabilityContext {
  api_id: string;
  repo_id: string;

  capability: {
    intent: string; // 能力意图："处理订单退款"
    constraints: BusinessRule[];
    side_effects: string[]; // 副作用："扣除库存"、"发送通知"
  };

  examples: {
    request: ExampleValue[];
    response: ExampleValue[];
    error: ExampleValue[]; // 常见错误
  };

  confidence: number; // 自动推断置信度 (0-1)
  needs_review: boolean; // 是否需要人工确认
}

// 使用上下文（Project 级，V1+）—— 消费方视角，按 (project_id, repo_id) 存储
interface UsageContext {
  api_id: string;
  repo_id: string;
  project_id: string;

  usage: {
    when_to_use: string[]; // 本项目在什么场景下使用该 API
    when_not_to_use: string[]; // 本项目什么场景下不要使用
    usage_policy: string[]; // 项目使用政策："仅前台发起退款，不开放给客服"
  };

  confidence: number; // 自动推断置信度 (0-1)
  needs_review: boolean; // 是否需要人工确认
}
```

## 核心能力

### 1. 自动推断

分两次推断，互不耦合：

**第一遍（V0）— 能力上下文：** 基于 Schema 结构 + 命名模式推断后端能力：

| 输入信号                       | 推断结果                               |
| ------------------------------ | -------------------------------------- |
| `POST /orders/{id}/refund`     | 意图: "订单退款"，副作用: "创建退款单" |
| 参数包含 `amount` / `currency` | 约束: "金额需 > 0"                     |
| response 包含 `error_code`     | 示例层填充常见错误码                   |
| tag 包含 `[admin]`             | 约束: "需要管理员权限"                 |

**第二遍（V1+）— 使用上下文：** 结合项目业务目标（Project Context）推断该项目如何使用各接口：

| 输入信号                       | 推断结果                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------- |
| 项目业务目标："电商订单系统"   | `when_to_use`: "前台用户发起退款时"                                             |
| 项目内部约定："客服走线下流程" | `when_not_to_use`: "客服工单场景不使用本接口"、`usage_policy`: "仅前台渠道开放" |
| 项目选用的 API 集合            | 使用场景与调用流程（工作流）                                                    |

> LLM 成本：能力上下文每 Repository 推断一次；使用上下文按 `(project, repo)` 各推断一次（同一 repo 进入 N 个项目则 ×N）。

### 2. 人工标注融合

- 人工标注优先级高于自动推断
- 当 `confidence < 0.6` 时，标记 `needs_review: true`
- 人工确认后，该标注作为未来推断的 few-shot 参考

### 3. 规则约束提取

从 `description` / `summary` 文本中提取**后端强制约束**（属于能力上下文）：

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

- 上游：OpenAPI Parser Service（repo 级技术模型）
- 下游：Knowledge Retrieval Service；Knowledge Graph Service（V1+ 可选，提供业务关系输入）
- 辅助：需要 LLM 支持

## 触发方式

- **能力上下文（V0）**：OpenAPI Parser Service 完成解析后按 Repository 触发；用户手动编辑后重新推断
- **使用上下文（V1+）**：Project 创建/关联 Repository 时按 `(project, repo)` 触发；Project Context 变更时重新计算受影响 API

## 边界情况

| 场景                                 | 行为                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------- |
| API 无 description 字段              | 仅基于 path/method/schema 推断，confidence 较低                                 |
| 非英文描述                           | 检测语言并保留原文，部分规则用 LLM 翻译后提取                                   |
| 同一 API 在不同 Project 中有不同用法 | 能力上下文按 repo 共享一份；使用上下文按 `(project, repo)` 各存一份，允许差异化 |
