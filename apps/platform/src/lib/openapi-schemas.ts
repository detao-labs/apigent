// ═══════════════════════════════════════════════════════════════════
// Platform API Zod schemas — single source of truth for request/response
// validation AND OpenAPI generation (zod-openapi v5 uses zod's native
// `.meta()` for OpenAPI metadata; `id` registers reusable components).
// ═══════════════════════════════════════════════════════════════════

import * as z from "zod/v4";

const shortId = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}[0-9A-Za-z]{10}$`));

// ─────────────────────────────────────────────────────────────────────
// Users
// ─────────────────────────────────────────────────────────────────────

export const userSchema = z
  .object({
    id: shortId("usr_").meta({ description: "User short ID" }),
    email: z.email().meta({
      description: "Email address",
      example: "ada@example.com",
    }),
    name: z.string().min(1).max(255).meta({ description: "Display name" }),
  })
  .meta({ id: "User", description: "Authenticated user" });

export type User = z.infer<typeof userSchema>;

// ─────────────────────────────────────────────────────────────────────
// Auth request bodies
// ─────────────────────────────────────────────────────────────────────

export const registerBodySchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .meta({ description: "Display name" }),
    email: z.email().max(255).meta({
      description: "Email address",
      example: "ada@example.com",
    }),
    password: z
      .string()
      .min(8)
      .max(128)
      .meta({ description: "Password (8–128 chars)", writeOnly: true }),
  })
  .meta({ id: "RegisterBody", description: "User registration payload" });

export type RegisterInput = z.infer<typeof registerBodySchema>;

export const loginBodySchema = z
  .object({
    email: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .meta({ description: "Email address", example: "ada@example.com" }),
    password: z
      .string()
      .min(1)
      .max(128)
      .meta({ description: "Password", writeOnly: true }),
  })
  .meta({ id: "LoginBody", description: "Login payload" });

export type LoginInput = z.infer<typeof loginBodySchema>;

// ─────────────────────────────────────────────────────────────────────
// Organizations
// ─────────────────────────────────────────────────────────────────────

const orgIdField = shortId("org_").meta({ description: "Organization short ID" });
const orgNameField = z
  .string()
  .min(1)
  .max(255)
  .meta({ description: "Organization name" });
const createdAtField = z
  .date()
  .meta({ format: "date-time", description: "Creation time (ISO 8601)" });
const updatedAtField = z
  .date()
  .meta({ format: "date-time", description: "Last update time (ISO 8601)" });

export const orgSummarySchema = z
  .object({
    id: orgIdField,
    name: orgNameField,
    createdAt: createdAtField,
  })
  .meta({ id: "OrgSummary", description: "Organization summary" });

export type OrgSummary = z.infer<typeof orgSummarySchema>;

export const orgSchema = z
  .object({
    id: orgIdField,
    name: orgNameField,
    ownerId: shortId("usr_").meta({ description: "Owner user short ID" }),
    createdAt: createdAtField,
    updatedAt: updatedAtField,
  })
  .meta({ id: "Org", description: "Full organization record" });

export type Org = z.infer<typeof orgSchema>;

export const orgCreateBodySchema = z
  .object({
    name: orgNameField.meta({ description: "Organization display name" }),
  })
  .meta({ id: "OrgCreateBody", description: "Organization creation payload" });

export type OrgCreateInput = z.infer<typeof orgCreateBodySchema>;

// ─────────────────────────────────────────────────────────────────────
// Repositories
// ─────────────────────────────────────────────────────────────────────

const repoIdField = shortId("repo_").meta({ description: "Repository short ID" });
const repoNameField = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .meta({ description: "Repository name", example: "Payment Service API" });

export const repoCreateBodySchema = z
  .object({
    orgId: orgIdField.meta({
      description: "Organization the repository belongs to",
    }),
    name: repoNameField,
    description: z
      .string()
      .trim()
      .max(2000)
      .optional()
      .meta({ description: "Short description of the API repository" }),
  })
  .meta({ id: "RepoCreateBody", description: "Repository creation payload" });

export type RepoCreateInput = z.infer<typeof repoCreateBodySchema>;

export const repoSchema = z
  .object({
    id: repoIdField,
    name: repoNameField,
    description: z
      .string()
      .nullable()
      .meta({ description: "Repository description" }),
    orgId: orgIdField.meta({ description: "Owning organization UUID" }),
    orgName: z
      .string()
      .min(1)
      .meta({ description: "Organization display name" }),
    mcpEnabled: z.boolean().meta({ description: "Whether MCP access is enabled" }),
    createdAt: createdAtField,
  })
  .meta({ id: "Repo", description: "Repository record" });

export type Repo = z.infer<typeof repoSchema>;

// ─────────────────────────────────────────────────────────────────────
// OpenAPI import
// ─────────────────────────────────────────────────────────────────────

export const importContentBodySchema = z
  .object({
    content: z
      .string()
      .min(1)
      .max(5 * 1024 * 1024)
      .meta({
        description: "Raw OpenAPI 3.0/3.1 document (JSON or YAML)",
        writeOnly: true,
      }),
  })
  .meta({ id: "ImportContentBody", description: "OpenAPI import payload" });

export type ImportContentInput = z.infer<typeof importContentBodySchema>;

// ─────────────────────────────────────────────────────────────────────
// Common responses
// ─────────────────────────────────────────────────────────────────────

export const errorResponseSchema = z
  .object({
    error: z
      .string()
      .min(1)
      .meta({ description: "Machine-readable error code" }),
  })
  .meta({ id: "ErrorResponse", description: "Error response" });

export const okResponseSchema = z
  .object({
    ok: z.boolean().meta({ description: "Always true" }),
  })
  .meta({ id: "OkResponse", description: "Generic success response" });
