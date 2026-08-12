// ═══════════════════════════════════════════════════════════════════
// OpenAPI Parser — Validator
// ═══════════════════════════════════════════════════════════════════

import type { ParseIssue, APIEntry } from "./types";
import { HTTP_METHODS } from "./types";

/**
 * Validates a parsed API entry against OpenAPI schema rules.
 * Generates warnings and errors but never throws — error tolerance
 * is a core principle: warn about issues, skip broken APIs, continue parsing.
 */
export function validateAPI(api: APIEntry): ParseIssue[] {
  const issues: ParseIssue[] = [];

  if (!HTTP_METHODS.includes(api.method)) {
    issues.push({
      apiId: api.id,
      severity: "error",
      message: `Invalid HTTP method '${api.method}' for endpoint ${api.id}`,
    });
  }

  if (!api.path || api.path.trim().length === 0) {
    issues.push({
      apiId: api.id,
      severity: "error",
      message: `Empty path for endpoint ${api.id}`,
    });
  }

  if (api.path && !api.path.startsWith("/")) {
    issues.push({
      apiId: api.id,
      severity: "warning",
      message: `Path '${api.path}' does not start with '/' for endpoint ${api.id}`,
    });
  }

  if (api.responses.length === 0) {
    issues.push({
      apiId: api.id,
      severity: "warning",
      message: `No response defined for endpoint ${api.id}`,
    });
  }

  for (const param of api.parameters) {
    if (param.in === "path" && !param.required) {
      issues.push({
        apiId: api.id,
        severity: "warning",
        message: `Path parameter '${param.name}' should be required in ${api.id}`,
      });
    }
  }

  if (!api.operationId) {
    issues.push({
      apiId: api.id,
      severity: "warning",
      message: `Missing operationId for endpoint ${api.id} — cross-version tracking may be affected`,
    });
  }

  return issues;
}

/**
 * Validates a schema entry.
 */
export function validateSchema(
  schema: { name: string; type?: string; properties: Record<string, unknown> },
): ParseIssue[] {
  const issues: ParseIssue[] = [];

  if (!schema.name || schema.name.trim().length === 0) {
    issues.push({
      severity: "error",
      message: "Schema entry has no name",
    });
  }

  if (!schema.type) {
    issues.push({
      severity: "warning",
      message: `Schema '${schema.name}' has no type specified`,
    });
  }

  return issues;
}
