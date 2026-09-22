// ═══════════════════════════════════════════════════════════════════
// RAG Contracts — 错误类型
// ═══════════════════════════════════════════════════════════════════
//
// 统一带 `code`，便于调用方（MCP / API route）映射成协议错误码，
// 而不必解析 message 文本。
// ═══════════════════════════════════════════════════════════════════

export type RagErrorCode =
  /** 配置非法：provider 未注册、取值不被支持等。启动期自检抛这个。 */
  | "RAG_CONFIG_INVALID"
  /** 摄取失败：文档源、分词、写入等环节出错 */
  | "RAG_INGEST_FAILED"
  /** 依赖的组件不可用（向量库连不上、embedding 服务不可达） */
  | "RAG_DEPENDENCY_UNAVAILABLE";

export class RagError extends Error {
  readonly code: RagErrorCode;

  constructor(code: RagErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "RagError";
    this.code = code;
  }
}

/** 配置非法。**启动期自检**用它，让「配错了」在启动时就报出来。 */
export class RagConfigError extends RagError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("RAG_CONFIG_INVALID", message, options);
    this.name = "RagConfigError";
  }
}

/** 摄取失败。 */
export class RagIngestError extends RagError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("RAG_INGEST_FAILED", message, options);
    this.name = "RagIngestError";
  }
}

/** 依赖不可用。注意：**降级不抛这个** —— 降级走 `RetrieveResult.degraded`。 */
export class RagDependencyError extends RagError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("RAG_DEPENDENCY_UNAVAILABLE", message, options);
    this.name = "RagDependencyError";
  }
}
