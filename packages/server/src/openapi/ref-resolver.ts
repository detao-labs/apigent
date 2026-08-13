// ═══════════════════════════════════════════════════════════════════
// OpenAPI Parser — $ref Resolution
// ═══════════════════════════════════════════════════════════════════

import type { ParseIssue } from "./types";

/**
 * Resolves all `$ref` pointers in an OpenAPI document.
 *
 * Strategy:
 * - Track visited refs per resolution chain to detect cycles
 * - Circular refs: mark as `circular_ref` in parse issues
 * - Unresolvable refs keep their `$ref` and are marked `_unresolved: true`
 */
export function resolveRefs(
  doc: Record<string, unknown>,
  issues: ParseIssue[],
): Record<string, unknown> {
  function resolveValue(value: unknown, visited: Set<string>): unknown {
    if (Array.isArray(value)) {
      return value.map((v) => resolveValue(v, visited));
    }

    if (value !== null && typeof value === "object") {
      const obj = value as Record<string, unknown>;

      // If this object is a $ref, resolve it
      if (typeof obj.$ref === "string") {
        const refPath = obj.$ref;

        if (visited.has(refPath)) {
          issues.push({
            severity: "warning",
            message: `Circular $ref detected: ${refPath}`,
          });
          return { $ref: refPath, _circular: true, _unresolved: true };
        }

        const resolved = resolveRefPath(doc, refPath);
        if (!resolved) {
          issues.push({
            severity: "warning",
            message: `Unresolvable $ref: ${refPath}`,
          });
          return { ...obj, _unresolved: true };
        }

        // Resolve deeper refs within the resolved object
        const newVisited = new Set(visited);
        newVisited.add(refPath);
        return resolveValue(resolved, newVisited);
      }

      // Recursively resolve all properties
      const resolved: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(obj)) {
        resolved[key] = resolveValue(val, visited);
      }
      return resolved;
    }

    return value;
  }

  // Deep-clone via JSON round-trip to avoid mutating the input document
  const cloned = JSON.parse(JSON.stringify(doc));
  return resolveValue(cloned, new Set()) as Record<string, unknown>;
}

/**
 * Resolve a JSON Pointer path within a document.
 * Supports `#/components/schemas/Foo` and `#/paths/~1users~1{id}/get/responses/200`.
 */
function resolveRefPath(
  doc: Record<string, unknown>,
  ref: string,
): Record<string, unknown> | null {
  if (!ref.startsWith("#/")) return null;

  const pathParts = ref
    .slice(2)
    .split("/")
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));

  let current: unknown = doc;
  for (const part of pathParts) {
    if (current === null || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[part];
  }

  if (current === null || typeof current !== "object" || Array.isArray(current)) {
    return null;
  }

  return current as Record<string, unknown>;
}
