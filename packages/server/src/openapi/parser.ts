// ═══════════════════════════════════════════════════════════════════
// OpenAPI Parser Service — Main Parser
// ═══════════════════════════════════════════════════════════════════
//
// Parses OpenAPI 3.0.x / 3.1.x specs into a normalized ParsedAPIModel.
// Supports JSON and YAML input. Swagger 2.0 planned for later.
//
// Design principles:
//   - Error-tolerant: warnings don't block, errors skip individual APIs
//   - Idempotent: same spec → same output (no side effects)
//   - Non-destructive: parsing failures don't affect existing data
// ═══════════════════════════════════════════════════════════════════

import * as yaml from "yaml";
import { HTTP_METHODS } from "./types";
import type {
  ParsedAPIModel,
  APIEntry,
  SchemaEntry,
  ParseIssue,
  ParseInput,
  ParseMeta,
  ParameterDef,
  ResponseDef,
  SchemaRef,
  SecurityRequirement,
} from "./types";
import { resolveRefs } from "./ref-resolver";
import { validateAPI, validateSchema } from "./validator";

// ───────────────────────────────────────────────────────────────────
// Public API
// ───────────────────────────────────────────────────────────────────

/**
 * Parse an OpenAPI spec into the Apigent internal API model.
 */
export function parseOpenAPI(input: ParseInput): ParsedAPIModel {
  const issues: ParseIssue[] = [];
  const parsedAt = Date.now();

  // Step 1: Parse JSON or YAML
  let doc: Record<string, unknown>;
  try {
    doc = parseContent(input.content);
  } catch (err) {
    issues.push({
      severity: "error",
      message: `Failed to parse OpenAPI document: ${(err as Error).message}`,
    });
    return emptyModel(input.repoId, issues, { openapiVersion: "unknown", parsedAt });
  }

  // Step 2: Detect and validate OpenAPI version
  const openapiVersion = detectVersion(doc, issues);
  if (!openapiVersion) {
    return emptyModel(input.repoId, issues, { openapiVersion: "unknown", parsedAt });
  }

  // Step 3: Resolve $ref references
  const resolved = resolveRefs(doc, issues);

  // Step 4: Extract metadata
  const meta: ParseMeta = {
    openapiVersion,
    parsedAt,
    specTitle:
      typeof resolved.info === "object" && resolved.info !== null
        ? (resolved.info as Record<string, unknown>).title as string | undefined
        : undefined,
    specVersion:
      typeof resolved.info === "object" && resolved.info !== null
        ? (resolved.info as Record<string, unknown>).version as string | undefined
        : undefined,
  };

  // Step 5: Extract API endpoints from paths
  const apis = extractAPIs(resolved, input.repoId, issues);

  // Step 6: Extract data models from components/schemas
  const schemas = extractSchemas(resolved, issues);

  return {
    repoId: input.repoId,
    apis,
    schemas,
    parseIssues: issues,
    meta,
  };
}

// ───────────────────────────────────────────────────────────────────
// Internal helpers
// ───────────────────────────────────────────────────────────────────

function emptyModel(
  repoId: string,
  issues: ParseIssue[],
  meta: ParseMeta,
): ParsedAPIModel {
  return { repoId, apis: [], schemas: [], parseIssues: issues, meta };
}

function parseContent(
  content: string,
): Record<string, unknown> {
  const trimmed = content.trim();

  // Try JSON first, then fall back to YAML (YAML is a superset of JSON's
  // flow syntax, so malformed JSON may still be valid YAML).
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return tryYaml(trimmed);
    }
  }

  return tryYaml(trimmed);
}

function tryYaml(content: string): Record<string, unknown> {
  const parsed = yaml.parse(content);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Parsed YAML is not a document object");
  }
  return parsed as Record<string, unknown>;
}

function detectVersion(
  doc: Record<string, unknown>,
  issues: ParseIssue[],
): string | null {
  if (typeof doc.openapi === "string") {
    const v = doc.openapi;
    if (v.startsWith("3.0") || v.startsWith("3.1")) {
      return v;
    }
    issues.push({
      severity: "warning",
      message: `OpenAPI version ${v} detected — full support is for 3.0.x and 3.1.x`,
    });
    return v;
  }

  if (typeof doc.swagger === "string") {
    issues.push({
      severity: "error",
      message: "Swagger 2.0 is not yet supported. Please convert to OpenAPI 3.0+ first.",
    });
    return null;
  }

  issues.push({
    severity: "error",
    message:
      "Document is not a valid OpenAPI or Swagger spec (no 'openapi' or 'swagger' field found)",
  });
  return null;
}

function extractAPIs(
  doc: Record<string, unknown>,
  repoId: string,
  issues: ParseIssue[],
): APIEntry[] {
  const apis: APIEntry[] = [];
  const paths = doc.paths as Record<string, unknown> | undefined;

  if (!paths || typeof paths !== "object") {
    issues.push({
      severity: "error",
      message: "No 'paths' object found in the OpenAPI document",
    });
    return apis;
  }

  for (const [path, pathItem] of Object.entries(paths)) {
    if (pathItem === null || typeof pathItem !== "object") continue;

    // Path-level parameters apply to every operation unless overridden.
    const pathLevelParams = extractParameters(pathItem as Record<string, unknown>, issues);

    for (const method of HTTP_METHODS) {
      const operation = (pathItem as Record<string, unknown>)[method.toLowerCase()] as
        | Record<string, unknown>
        | undefined;

      if (!operation) continue;

      const id = `${method}:${path}`;
      const requestBody = extractRequestBody(operation);
      const api: APIEntry = {
        id,
        method,
        path,
        operationId:
          typeof operation.operationId === "string" ? operation.operationId : undefined,
        summary: typeof operation.summary === "string" ? operation.summary : undefined,
        description:
          typeof operation.description === "string" ? operation.description : undefined,
        parameters: mergeParameters(
          pathLevelParams,
          extractParameters(operation, issues),
        ),
        requestBody: requestBody?.schema,
        requestContentType: requestBody?.contentType,
        responses: extractResponses(operation),
        tags: Array.isArray(operation.tags)
          ? operation.tags.filter((t): t is string => typeof t === "string")
          : [],
        security: extractSecurity(operation, doc),
        deprecated: operation.deprecated === true,
      };

      const apiIssues = validateAPI(api);
      const hasError = apiIssues.some((i) => i.severity === "error");

      if (hasError) {
        issues.push(...apiIssues);
        continue;
      }

      issues.push(...apiIssues.filter((i) => i.severity === "warning"));
      apis.push(api);
    }
  }

  return apis;
}

function extractParameters(
  operation: Record<string, unknown>,
  issues: ParseIssue[],
): ParameterDef[] {
  const raw = operation.parameters;
  if (!Array.isArray(raw)) return [];

  const result: ParameterDef[] = [];
  for (const p of raw) {
    if (p === null || typeof p !== "object") continue;
    const param = p as Record<string, unknown>;
    let location: ParameterDef["in"];
    if (isValidParamLocation(param.in)) {
      location = param.in;
    } else {
      issues.push({
        severity: "warning",
        message: `Parameter '${typeof param.name === "string" ? param.name : "?"}' has invalid 'in' location — defaulting to 'query'`,
      });
      location = "query";
    }
    result.push({
      name: typeof param.name === "string" ? param.name : "",
      in: location,
      required: param.required === true,
      description: typeof param.description === "string" ? param.description : undefined,
      schema: param.schema as Record<string, unknown> | undefined,
      example: param.example,
    });
  }
  return result;
}

/**
 * Merge path-level parameters with operation-level ones.
 * Operation-level parameters win on `(name, in)` collisions (OpenAPI spec).
 */
function mergeParameters(
  pathLevel: ParameterDef[],
  operationLevel: ParameterDef[],
): ParameterDef[] {
  const key = (p: ParameterDef) => `${p.in}:${p.name}`;
  const opKeys = new Set(operationLevel.map(key));
  return [...pathLevel.filter((p) => !opKeys.has(key(p))), ...operationLevel];
}

function isValidParamLocation(
  loc: unknown,
): loc is "path" | "query" | "header" | "cookie" {
  return typeof loc === "string" && ["path", "query", "header", "cookie"].includes(loc);
}

function extractRequestBody(
  operation: Record<string, unknown>,
): { contentType?: string; schema: SchemaRef } | undefined {
  const rb = operation.requestBody as Record<string, unknown> | undefined;
  if (!rb || typeof rb !== "object") return undefined;

  const content = rb.content as Record<string, unknown> | undefined;
  if (!content || typeof content !== "object") return undefined;

  for (const [mediaType, mediaTypeObj] of Object.entries(content)) {
    if (mediaTypeObj && typeof mediaTypeObj === "object") {
      const mt = mediaTypeObj as Record<string, unknown>;
      if (mt.schema) {
        return {
          contentType: mediaType,
          schema: toSchemaRef(mt.schema as Record<string, unknown>),
        };
      }
    }
  }

  return undefined;
}

function extractResponses(operation: Record<string, unknown>): ResponseDef[] {
  const responses = operation.responses as Record<string, unknown> | undefined;
  if (!responses || typeof responses !== "object") return [];

  const result: ResponseDef[] = [];

  for (const [statusCode, response] of Object.entries(responses)) {
    const r = response as Record<string, unknown>;
    const description = typeof r?.description === "string" ? r.description : "";
    const rContent = r?.content as Record<string, unknown> | undefined;

    if (rContent && typeof rContent === "object") {
      let hasSchema = false;
      for (const [mediaType, mediaTypeObj] of Object.entries(rContent)) {
        const mt = mediaTypeObj as Record<string, unknown> | undefined;
        if (
          mt &&
          typeof mt === "object" &&
          mt.schema
        ) {
          hasSchema = true;
          result.push({
            statusCode,
            description,
            contentType: mediaType,
            schema: toSchemaRef(mt.schema as Record<string, unknown>),
          });
        }
      }
      // Content declared without any schema (e.g. example-only): keep the
      // status row so the code still shows up in the UI.
      if (!hasSchema) result.push({ statusCode, description });
    } else {
      result.push({ statusCode, description });
    }
  }

  return result;
}

function extractSecurity(
  operation: Record<string, unknown>,
  doc: Record<string, unknown>,
): SecurityRequirement[] {
  const sec = operation.security as SecurityRequirement[] | undefined;
  if (Array.isArray(sec)) return sec;

  const topLevel = doc.security as SecurityRequirement[] | undefined;
  if (Array.isArray(topLevel)) return topLevel;

  return [];
}

function extractSchemas(
  doc: Record<string, unknown>,
  issues: ParseIssue[],
): SchemaEntry[] {
  const schemas: SchemaEntry[] = [];

  const components = doc.components as Record<string, unknown> | undefined;
  if (!components || typeof components !== "object") return schemas;

  const schemaObjs = components.schemas as Record<string, unknown> | undefined;
  if (!schemaObjs || typeof schemaObjs !== "object") return schemas;

  for (const [name, schemaObj] of Object.entries(schemaObjs)) {
    if (!schemaObj || typeof schemaObj !== "object") continue;

    const s = schemaObj as Record<string, unknown>;
    const entry: SchemaEntry = {
      name,
      type: typeof s.type === "string" ? s.type : undefined,
      description: typeof s.description === "string" ? s.description : undefined,
      properties: (s.properties as Record<string, unknown>) ?? {},
      required: Array.isArray(s.required)
        ? s.required.filter((r): r is string => typeof r === "string")
        : [],
    };

    const schemaIssues = validateSchema(entry);
    issues.push(...schemaIssues);
    schemas.push(entry);
  }

  return schemas;
}

function toSchemaRef(schema: Record<string, unknown>): SchemaRef {
  if (typeof schema.$ref === "string") {
    return {
      ref: schema.$ref,
      unresolved: schema._unresolved === true,
    };
  }
  return { schema };
}
