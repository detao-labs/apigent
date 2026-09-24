// ═══════════════════════════════════════════════════════════════════
// Apigent DB Schema — Barrel Export
// ═══════════════════════════════════════════════════════════════════
//
// 文件按**领域**划分，依赖方向自上而下（下面的层可以引用上面的层）：
//
//   auth          身份与凭据            users · secret_keys
//   admin         平台管理员            admin_members
//   organization  租户与组织成员         organizations · organization_members
//   repository    仓库与仓库成员         repositories · repository_members
//   version       版本 / 快照 / 版本树   versions · version_commits · version_entity_links
//   endpoint      接口与响应            endpoints · endpoint_responses · endpoint_relationships
//   definitions   可复用定义            data_models · components
//   context       能力上下文            business_contexts
//   task          异步任务与投递         repository_tasks · impl_queue_jobs
//   knowledge     检索单元与版本树      knowledge_chunks · knowledge_chunk_links
//   notification  站内通知              notifications · notification_preferences
//   audit         操作审计              operation_logs · operation_log_details
// ═══════════════════════════════════════════════════════════════════

// 身份与凭据
export { users, secretKeys } from "./auth";

// 平台管理员
export { adminMembers } from "./admin";

// 租户
export { organizations, organizationMembers } from "./organization";

// 仓库
export { repositories, repositoryMembers } from "./repository";

// 版本
export { versions, versionCommits, versionEntityLinks } from "./version";

// 接口
export { endpoints, endpointResponses, endpointRelationships } from "./endpoint";

// 可复用定义
export { dataModels, components } from "./definitions";

// 能力上下文
export { businessContexts } from "./context";

// 异步任务
export { repositoryTasks, implQueueJobs } from "./task";

// 检索
export { knowledgeChunks, knowledgeChunkLinks } from "./knowledge";

// 通知
export { notifications, notificationPreferences } from "./notification";

// 审计
export { operationLogs, operationLogDetails } from "./audit";
