// ═══════════════════════════════════════════════════════════════════
// Context Common — 共享常量与错误
// ═══════════════════════════════════════════════════════════════════

export const CONTEXT_QUEUE = "business.context";

export class RepoNotFoundError extends Error {
  constructor(repositoryId: string) {
    super(`Repository not found: ${repositoryId}`);
    this.name = "RepoNotFoundError";
  }
}

export class DuplicateContextTaskError extends Error {
  constructor(public readonly activeTaskId: string) {
    super("Repository already has a context generation task in progress");
    this.name = "DuplicateContextTaskError";
  }
}
