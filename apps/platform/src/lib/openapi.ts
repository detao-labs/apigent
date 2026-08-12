// ═══════════════════════════════════════════════════════════════════
// Platform OpenAPI 3.1 document — built from the shared zod schemas in
// ./openapi-schemas so the spec never drifts from runtime validation.
//
// This is NOT served at runtime: the document is only materialized by the
// dedicated `openapi:export` command (scripts/export-openapi.ts), which
// writes apps/platform/openapi/platform.json — same idea as a build step.
// ═══════════════════════════════════════════════════════════════════

import { createDocument } from "zod-openapi";
import * as z from "zod/v4";
import {
  errorResponseSchema,
  loginBodySchema,
  okResponseSchema,
  orgCreateBodySchema,
  orgSchema,
  orgSummarySchema,
  registerBodySchema,
  userSchema,
} from "./openapi-schemas";

const registerResponseSchema = z.object({ user: userSchema });
const meResponseSchema = z.object({ user: userSchema.nullable() });
const orgResponseSchema = z.object({ org: orgSchema });
const orgsResponseSchema = z.object({ orgs: z.array(orgSummarySchema) });

export function createOpenApiDocument() {
  return createDocument({
    openapi: "3.1.1",
    info: {
      title: "Apigent Platform API",
      version: "0.1.0",
      description: "HTTP API for the Apigent platform webapp (apps/platform).",
    },
    servers: [
      { url: "http://localhost:3000", description: "Local development" },
    ],
    tags: [
      { name: "Auth", description: "Registration, login and session" },
      { name: "Organizations", description: "Organization operations" },
    ],
    components: {
      securitySchemes: {
        sessionCookie: {
          type: "apiKey",
          in: "cookie",
          name: "apigent_session",
          description:
            "HttpOnly session cookie issued by /api/auth/login or /api/auth/register.",
        },
      },
    },
    paths: {
      "/api/auth/register": {
        post: {
          tags: ["Auth"],
          operationId: "registerUser",
          summary: "Register a new user and start a session",
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: registerBodySchema },
            },
          },
          responses: {
            "201": {
              description: "User created and session started",
              content: {
                "application/json": { schema: registerResponseSchema },
              },
            },
            "400": {
              description: "Invalid input",
              content: {
                "application/json": { schema: errorResponseSchema },
              },
            },
            "409": {
              description: "Email already taken",
              content: {
                "application/json": { schema: errorResponseSchema },
              },
            },
            "500": {
              description: "Internal error",
              content: {
                "application/json": { schema: errorResponseSchema },
              },
            },
          },
        },
      },
      "/api/auth/login": {
        post: {
          tags: ["Auth"],
          operationId: "loginUser",
          summary: "Log in and start a session",
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: loginBodySchema },
            },
          },
          responses: {
            "200": {
              description: "Logged in",
              content: {
                "application/json": { schema: registerResponseSchema },
              },
            },
            "400": {
              description: "Invalid input",
              content: {
                "application/json": { schema: errorResponseSchema },
              },
            },
            "401": {
              description: "Invalid credentials",
              content: {
                "application/json": { schema: errorResponseSchema },
              },
            },
            "500": {
              description: "Internal error",
              content: {
                "application/json": { schema: errorResponseSchema },
              },
            },
          },
        },
      },
      "/api/auth/logout": {
        post: {
          tags: ["Auth"],
          operationId: "logout",
          summary: "Clear the session cookie",
          responses: {
            "200": {
              description: "Logged out",
              content: {
                "application/json": { schema: okResponseSchema },
              },
            },
          },
        },
      },
      "/api/auth/me": {
        get: {
          tags: ["Auth"],
          operationId: "getMe",
          summary: "Get the current session user (null when unauthenticated)",
          responses: {
            "200": {
              description: "Current user or null",
              content: {
                "application/json": { schema: meResponseSchema },
              },
            },
          },
        },
      },
      "/api/orgs": {
        get: {
          tags: ["Organizations"],
          operationId: "listOrgs",
          summary: "List organizations",
          security: [{ sessionCookie: [] }],
          responses: {
            "200": {
              description: "Organization list",
              content: {
                "application/json": { schema: orgsResponseSchema },
              },
            },
            "401": {
              description: "Unauthorized",
              content: {
                "application/json": { schema: errorResponseSchema },
              },
            },
          },
        },
        post: {
          tags: ["Organizations"],
          operationId: "createOrg",
          summary: "Create an organization",
          security: [{ sessionCookie: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: orgCreateBodySchema },
            },
          },
          responses: {
            "201": {
              description: "Organization created",
              content: {
                "application/json": { schema: orgResponseSchema },
              },
            },
            "400": {
              description: "Invalid input",
              content: {
                "application/json": { schema: errorResponseSchema },
              },
            },
            "401": {
              description: "Unauthorized",
              content: {
                "application/json": { schema: errorResponseSchema },
              },
            },
            "409": {
              description: "Slug already taken",
              content: {
                "application/json": { schema: errorResponseSchema },
              },
            },
          },
        },
      },
    },
  });
}
