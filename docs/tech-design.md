# Apigent Technical Design

> 🌐 Language: [English](./tech-design.md) | [中文](./tech-design.zh.md)

This document covers the platform-layer technical design of Apigent — the web applications, domain models, and user-facing features beyond the API knowledge engine (which is documented in [blueprint](./blueprint.md) and [modules/](./modules/)).

---

# 1. Product Architecture

Apigent consists of three application layers:

```
                          External AI Agents
                       (Cursor / Claude / ...)
                                |
                           MCP Protocol
                                |
┌───────────────────────────────┼───────────────────────────────┐
│                      MCP Gateway                              │
│                 (Protocol Server)                              │
└───────────────────────────────┼───────────────────────────────┘
                                |
                    Apigent Core API Layer
                                |
            ┌───────────────────┼───────────────────┐
            |                   |                   |
    ┌───────┴───────┐   ┌───────┴───────┐   ┌───────┴───────┐
    │ Platform      │   │ Admin         │   │ Core Engine    │
    │ Webapp        │   │ Webapp        │   │ (Services +    │
    │ (Next.js)     │   │ (Next.js)     │   │  AI Agents)    │
    └───────────────┘   └───────────────┘   └───────────────┘
                                                    |
                                              PostgreSQL
                                              + Vector DB
```

- **Platform Webapp** — the main application for developers to manage APIs
- **Admin Webapp** — the admin panel for platform operators
- **Core Engine** — the API knowledge pipeline (OpenAPI Parser → Business Context Agent → Knowledge Graph → MCP Gateway), detailed in [docs/modules/](./modules/)

---

# 2. Core Domain Model

## 2.1 Entity Overview

```
┌──────────┐     ┌──────────────┐     ┌────────────────┐
│   User   │────→│  TeamMember  │←────│     Team       │
└──────────┘     └──────────────┘     └────────────────┘
     │                                      │
     │  ┌──────────────────┐               │
     ├──│  SecretKey       │               │
     │  └──────────────────┘               │
     │                               ┌─────┴──────┐
     │  ┌──────────────────┐        │ Repository  │
     └──│  RepoPermission  │←──────→│  (1 repo =  │
        └──────────────────┘        │  1 project) │
                                    └─────────────┘
                                           │
                                    ┌──────┴──────┐
                                    │   OpenAPI   │
                                    │  Versions   │
                                    └─────────────┘
```

## 2.2 User

Represents a registered user account.

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Unique identifier |
| `email` | string | Login email (unique) |
| `password_hash` | string | Hashed password |
| `sso_providers` | string[] | Linked SSO accounts (github, google) |
| `name` | string | Display name |
| `avatar_url` | string | Avatar image URL |
| `created_at` | timestamp | Registration time |
| `updated_at` | timestamp | Last update time |

## 2.3 Team

An organization unit. Users create Teams first, then create Repositories within Teams.

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Unique identifier |
| `name` | string | Team display name |
| `slug` | string | URL-friendly unique identifier |
| `owner_id` | UUID | Team creator |
| `created_at` | timestamp | Creation time |

## 2.4 TeamMember

Associates a User with a Team and their role.

| Field | Type | Description |
|-------|------|-------------|
| `user_id` | UUID | User reference |
| `team_id` | UUID | Team reference |
| `role` | string | Role identifier (see [2.8 RBAC Model](#28-rbac-model)) |

**Team-level roles:**

| Role | Scope | Summary |
|------|-------|---------|
| `team_owner` | Team | Full control: delete Team, manage members, manage all repos |
| `team_admin` | Team | Manage members, manage all repos within the Team |
| `team_member` | Team | Access repos based on repo-level role assignment |

## 2.5 Repository

The core organizational unit. **One Repository = one backend project's OpenAPI file.**

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Unique identifier |
| `team_id` | UUID | Parent Team |
| `name` | string | Repository name |
| `description` | string | Repository description (LLM-assisted) |
| `openapi_versions` | Version[] | OpenAPI version history |
| `current_version` | string | Active version identifier |
| `mcp_enabled` | boolean | Whether MCP is enabled for this repo |
| `created_at` | timestamp | Creation time |
| `updated_at` | timestamp | Last update time |

**Version management:**

- Each import creates a new version (auto-detected from OpenAPI `info.version`)
- Version history with diff between versions
- Ability to rollback to a previous version
- Export to OpenAPI JSON/YAML at any version

## 2.6 RepositoryPermission

Per-user role within a specific Repository. When set, this **overrides** the default inherited from the Team-level role.

| Field | Type | Description |
|-------|------|-------------|
| `user_id` | UUID | User reference |
| `repo_id` | UUID | Repository reference |
| `role` | string | Repo-level role identifier (see [2.8 RBAC Model](#28-rbac-model)) |

**Repository-level roles:**

| Role | Capabilities |
|------|-------------|
| `repo_admin` | Manage permissions, configure MCP, delete repo, import versions |
| `repo_editor` | Edit API descriptions, import new versions |
| `repo_viewer` | View APIs, models, and descriptions |

## 2.7 SecretKey

User-level API key for MCP access. External AI Agents use this key to authenticate with the MCP Gateway.

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Unique identifier |
| `user_id` | UUID | Owner reference |
| `name` | string | Human-readable key name |
| `key_hash` | string | Hashed key (raw key shown only once at creation) |
| `key_prefix` | string | First 8 chars for identification (e.g., `apigent_sk_...`) |
| `scopes` | string[] | Permission scopes: `mcp:read`, `mcp:search` |
| `last_used_at` | timestamp | Last usage timestamp |
| `expires_at` | timestamp | Expiration time (optional) |
| `created_at` | timestamp | Creation time |

## 2.8 RBAC Model

Apigent uses a formal Role-Based Access Control (RBAC) model. A **role** is a named collection of **permissions**. Users gain permissions by being assigned roles — at the Team level, Repository level, or Platform level.

### 2.8.1 Roles

| Role ID | Level | Description |
|---------|-------|-------------|
| `team_owner` | Team | Full control over Team and all its repos |
| `team_admin` | Team | Manage members and all repos within the Team |
| `team_member` | Team | Basic Team membership; repo access depends on repo-level role |
| `repo_admin` | Repository | Full control over a specific Repository |
| `repo_editor` | Repository | Edit API descriptions, import new versions |
| `repo_viewer` | Repository | Read-only access to APIs and models |
| `platform_admin` | Platform | Cross-Team admin access (Admin Webapp) |

### 2.8.2 Permissions

| Permission | Level | Description |
|------------|-------|-------------|
| `team:manage_members` | Team | Invite, remove, and change member roles |
| `team:delete` | Team | Delete the Team |
| `team:manage_settings` | Team | Edit Team name, slug, settings |
| `repo:read` | Repository | View APIs, models, descriptions |
| `repo:write` | Repository | Edit API descriptions and business context |
| `repo:import` | Repository | Import new OpenAPI versions |
| `repo:delete` | Repository | Delete the Repository |
| `repo:manage_permissions` | Repository | Assign/change user roles on the Repository |
| `repo:manage_mcp` | Repository | Enable/disable MCP, configure tool exposure |
| `mcp:search` | MCP | Access `search_apis` tool |
| `mcp:detail` | MCP | Access `get_api_detail` tool |
| `mcp:context` | MCP | Access `get_project_context` tool |
| `admin:manage_users` | Platform | View, disable, enable, delete user accounts |
| `admin:view_stats` | Platform | View platform statistics |
| `admin:view_audit` | Platform | View audit logs and security events |

### 2.8.3 Role → Permission Mapping

| Role | Permissions |
|------|------------|
| `team_owner` | `team:*`, `repo:*` (on all Team repos) |
| `team_admin` | `team:manage_members`, `team:manage_settings`, `repo:*` (on all Team repos) |
| `team_member` | `repo:read` (on repos where assigned a repo-level role) |
| `repo_admin` | `repo:*` (on specific repo) |
| `repo_editor` | `repo:read`, `repo:write`, `repo:import` |
| `repo_viewer` | `repo:read` |
| `platform_admin` | `admin:*`, cross-Team read access |

### 2.8.4 Inheritance & Override Rules

```
Team Role (team_owner / team_admin / team_member)
        │
        ├──→ Default repo-level permission inherited from Team role
        │      team_owner  → repo_admin (on all repos)
        │      team_admin  → repo_editor (on all repos)
        │      team_member → repo_viewer (on all repos)
        │
        └──→ Can be OVERRIDDEN per Repository
               Example: A team_member assigned repo_admin on Repo X
                        gets full control over Repo X, while remaining
                        a viewer on all other Team repos.
```

**Rules:**

1. A user's effective permission on a Repository = the higher of: their inherited Team-role permission **or** any explicit repo-level role assignment
2. `platform_admin` has read access to all Teams and repos for audit purposes, but cannot modify unless explicitly added as a member
3. MCP tools are controlled by Secret Key `scopes` — even if a user has `repo:read`, their Secret Key must also have `mcp:*` scopes to call MCP tools

---

# 3. Platform Webapp

The main application for developers to manage their APIs as Agent-accessible knowledge assets.

## 3.1 Authentication

| Feature | Description |
|---------|-------------|
| **Email Registration** | Sign up with email + password, email verification |
| **Email Login** | Email + password with session management |
| **SSO Login** | GitHub OAuth, Google OAuth |
| **Password Reset** | Email-based password reset flow |
| **Session Management** | JWT-based sessions, refresh tokens, logout |

## 3.2 User Profile

| Feature | Description |
|---------|-------------|
| **Profile Editing** | Name, avatar, bio |
| **Security Settings** | Change password, manage SSO links |
| **Notification Preferences** | Email notification settings |

## 3.3 Team Management

| Feature | Description |
|---------|-------------|
| **Create Team** | Name + slug, creator becomes Owner |
| **Invite Members** | Email invitation, role assignment |
| **Member List** | View all members with roles |
| **Role Management** | Owner/Admin can change member roles |
| **Leave/Remove** | Members can leave; Owner/Admin can remove members |

## 3.4 Homepage / Dashboard

After login, users see:

- **Repository Overview**: list of repos across all Teams, with last update time, API count
- **Recent Activity**: recent imports, edits, member changes
- **Quick Actions**: Create Team, Create Repository, Import OpenAPI
- **Global Search**: search across repos and APIs

## 3.5 Repository Management

### 3.5.1 Create & Import

| Action | Description |
|--------|-------------|
| **Create Repository** | Name + optional description |
| **Import OpenAPI** | Upload JSON/YAML file, or fetch from URL |
| **Auto-detect Version** | Extract version from OpenAPI `info.version` field |
| **Validation** | Validate spec before import, show errors |

### 3.5.2 Content Display

Two primary views for browsing a repository:

**Endpoints View:**
- List of all API endpoints, grouped by tag
- Each endpoint shows: method, path, summary, business intent (from Business Context Agent)
- Click to expand: request/response schema, business rules, examples, related APIs

**Data Models View:**
- List of all schemas/components defined in the OpenAPI spec
- Schema tree visualization with field types, constraints, descriptions
- Cross-reference: which endpoints use this model

### 3.5.3 Version Management

| Feature | Description |
|---------|-------------|
| **Version List** | Complete import history with timestamps |
| **Version Diff** | Side-by-side comparison of any two versions |
| **Rollback** | Revert to a previous version |
| **Export** | Download OpenAPI JSON/YAML at any version |

## 3.6 API Search & Knowledge Retrieval

The primary entry point for developers to find and understand APIs within the platform. Detailed retrieval architecture and RAG pipeline are documented in the agent design docs — this section provides a feature-level overview.

### 3.6.1 V0 — Semantic Search

| Feature | Description |
|---------|-------------|
| **Global Search Bar** | Accessible from Dashboard and Repository pages. Natural language input |
| **Hybrid Search** | Embedding (Dense) + BM25 (Sparse) + Knowledge Graph — fused via RRF, re-ranked by cross-encoder. See [Semantic Search Agent](./modules/semantic-search.agent.md) |
| **Permission-aware** | Results pre-filtered by RBAC effective permissions — users only see APIs they can access |
| **Search Scope** | Global (across all accessible repos) or scoped to a single Repository/Team |
| **Filters** | Filter by HTTP method, tag, path prefix |
| **Result Display** | API method + path, business intent summary, match reason, relevance score |
| **Quick Actions** | Click result → navigate to API detail page |

**Implementation:** The [Semantic Search Agent](./modules/semantic-search.agent.md) — same engine powering MCP `search_apis`. LLM calls ≤1 per query (optional query rewriting; retrievals are deterministic).

### 3.6.2 V1 — RAG Knowledge Q&A

Conversational RAG interface for deeper API understanding.

| Feature | Description |
|---------|-------------|
| **Conversational Q&A** | Multi-turn chat; ask follow-up questions naturally |
| **RAG Pipeline** | Query Rewriting → Permission Pre-filter → Hybrid Retrieval (Embedding + BM25 + KG) → RRF Coarse Rank → Cross-encoder Fine Rank → Context Assembly → Answer Generation (LLM) |
| **Source Citations** | Every answer links back to the specific APIs and models it references |
| **Knowledge Scope** | Single Repository, or cross-repo within a Team |

**Retrieval details:** [Semantic Search Agent](./modules/semantic-search.agent.md) covers chunk strategy, BM25 + embedding hybrid, query rewriting, permission filtering, and two-stage ranking in depth.

---

## 3.7 Agent-assisted Editing

| Feature | Description |
|---------|-------------|
| **Enhance Description** | LLM generates/improves API endpoint description based on path, method, and schema |
| **Enhance Repository Description** | LLM generates repo overview based on APIs |
| **Diff Display** | Before applying AI suggestions, show a side-by-side diff of changes |
| **Accept / Reject** | User confirms or rejects each suggested change |
| **Manual Override** | User can manually edit after AI suggestions |

This is a **user-triggered LLM call** — separate from the automated Business Context inference during import.

## 3.8 Permission Control

Apigent's RBAC model (defined in [2.8 RBAC Model](#28-rbac-model)) is surfaced in the Platform Webapp through the following interactions:

### 3.8.1 Team-level Role Management

| Feature | Description |
|---------|-------------|
| **Role Assignment** | When inviting a member or editing an existing member, assign a Team role: `team_owner`, `team_admin`, or `team_member` |
| **Role Inheritance** | Team role automatically grants the corresponding repo-level role on all current and future repos in the Team |
| **Role Change** | Team Owner/Admin can change a member's role at any time |
| **Transfer Ownership** | Team Owner can transfer ownership to another member |

### 3.8.2 Repository-level Role Override

| Feature | Description |
|---------|-------------|
| **Per-repo Override** | On any Repository, a `team_member` can be promoted to `repo_admin` or `repo_editor` without changing their Team role |
| **Override Display** | Repository member list shows both inherited role and explicit override (with visual indicator) |
| **Effective Permission** | The higher of inherited + override applies per repository |

### 3.8.3 Access Control in Practice

| Scenario | Setup | Result |
|----------|-------|--------|
| **New Team Member** | Invited as `team_member` | Can view all repos (inherited `repo_viewer`) but cannot edit |
| **Promoted Editor** | `team_member` + override `repo_editor` on Repo A | Can edit Repo A, viewer on all other repos |
| **External Collaborator** | Not a Team member, assigned `repo_viewer` on Repo B | Can only view Repo B, no access to other repos |
| **MCP Access** | `repo_admin` on Repo C + Secret Key with `mcp:*` scopes | Can use MCP tools on Repo C |

## 3.9 MCP Settings

| Feature | Description |
|---------|-------------|
| **Enable/Disable per Repo** | Toggle MCP access for each repository |
| **Access Scope** | Control which tools are exposed: `search_apis`, `get_api_detail`, `get_project_context` |
| **Usage Monitoring** | View MCP call count and history per key |
| **Connection Info** | Display MCP endpoint URL for users to configure in Cursor/Claude |

## 3.10 Secret Key Management

| Feature | Description |
|---------|-------------|
| **Generate Key** | Create a new API key with name and scope |
| **View Keys** | List all keys with prefix, scopes, created/expiry dates |
| **Raw Key Display** | Full key shown only once at creation (security best practice) |
| **Rotate Key** | Generate a replacement key, deprecate the old one |
| **Delete Key** | Immediately revoke a key |
| **Usage Tracking** | Last used timestamp, call count |

Key format: `apigent_sk_<random_hex>`

---

# 4. Admin Webapp

A separate application for platform administrators. Accessible only by users with admin privileges.

## 4.1 Authentication

| Feature | Description |
|---------|-------------|
| **Admin Login** | Separate auth flow from Platform Webapp |
| **Admin Role Check** | Only users with `admin` flag can access |
| **Session Isolation** | Admin sessions are independent of Platform sessions |

## 4.2 Dashboard & Statistics

| Metric | Description |
|--------|-------------|
| **User Count** | Total registered users, new registrations (daily/weekly) |
| **Team Count** | Total teams, active teams |
| **Repository Count** | Total repos, repos with MCP enabled |
| **API Count** | Total API endpoints across all repos |
| **MCP Usage** | Total MCP calls, by repo, by key, time series |
| **Active Users** | DAU/WAU/MAU tracking |

## 4.3 User Management

| Feature | Description |
|---------|-------------|
| **User List** | Searchable, filterable list of all users |
| **User Detail** | Full profile, teams, repos, activity log |
| **Disable Account** | Temporarily suspend a user account |
| **Enable Account** | Reactivate a disabled account |
| **Delete Account** | Permanently remove a user and their data (with confirmation + cooling period) |

## 4.4 Security Audit

| Feature | Description |
|---------|-------------|
| **Operation Logs** | Audit trail: who did what, when, from which IP |
| **Login History** | Per-user login records with IP and user agent |
| **Anomaly Detection** | Flag unusual patterns (new IP, rapid API calls, bulk export) |
| **Key Leak Check** | Detect Secret Keys in public repositories or exposed contexts |

---

# 5. Technical Architecture

## 5.1 Application Structure

```
apps/
├── platform/          # Platform Webapp (Next.js App Router)
│   ├── app/           # Pages
│   ├── components/    # React components
│   └── lib/           # Webapp-specific utilities
├── admin/             # Admin Webapp (Next.js App Router)
│   ├── app/
│   ├── components/
│   └── lib/
├── server/            # Apigent Core API Server (Hono, independent process)
│   ├── services/      # Platform Services (OpenAPI Parser, Knowledge Graph, etc.)
│   ├── agents/        # AI Agents (Business Context, Semantic Search)
│   ├── mcp/           # MCP Gateway (HTTP + Streamable HTTP)
│   ├── jobs/          # Async task workers (BullMQ)
│   ├── db/            # Database schema & migrations
│   └── index.ts       # Server entry point
└── packages/           # Shared packages
    ├── types/          # Shared TypeScript types
    ├── ui/             # Shared UI components
    └── auth/           # Shared auth utilities
```

### Why Hono for the API Server?

The Core API Server is separated from Next.js for three reasons:

| Concern | Next.js API Routes | Independent Server (Hono) |
|---------|:--:|:--:|
| **Independent scaling** | Coupled to Webapp process lifecycle | Deploy, scale, and monitor MCP traffic independently from web pages |
| **No timeout anxiety** | Serverless platforms impose 10–60s hard limits; `search_apis` with LLM + Business Context inference may exceed them | Long-lived process, no artificial timeout |
| **Deployment flexibility** | Tied to Vercel/Node.js serverless model | Deploy anywhere — VPS, K8s, Docker, or edge runtimes (Bun, Cloudflare Workers) |

### MCP Transport

Apigent's MCP Gateway uses **Streamable HTTP** (2025 spec), not the older SSE-based transport:

| MCP Tool | Transport Pattern | Notes |
|----------|------------------|-------|
| `search_apis` | Standard request → response | One HTTP POST, JSON result |
| `get_api_detail` | Standard request → response | One HTTP POST, JSON result |
| `get_project_context` | Standard request → response | One HTTP POST, JSON result |

All three tools are **plain request-response** — no streaming, no server push, no persistent connection needed. MCP does not require SSE or long-lived connections for this use case. The separation is an **architectural choice** (independent scaling + deployment flexibility), not a protocol requirement.

## 5.2 Technology Choices

Each swappable component is defined by a **TypeScript interface** and shipped with a **default implementation**. Users can replace any component by implementing the interface and registering it via configuration. See [5.5 Extensibility Architecture](#55-extensibility-architecture) for details.

| Layer | Default | Abstraction (Interface) | Rationale |
|-------|---------|-------------------------|-----------|
| **Webapp Frontend** | Next.js App Router, React, TypeScript | — | SSR, streaming, Server Components, rich ecosystem |
| **Webapp Styling** | Tailwind CSS | — | Utility-first, rapid UI development |
| **API Server** | Hono (TypeScript) | — | Lightweight (12KB), multi-runtime, Web standard `Request`/`Response`, Express-like API |
| **Type Bridge** | tRPC | — | End-to-end type safety between Webapps and API Server |
| **Database** | PostgreSQL | `DatabaseAdapter` | Relational data; Drizzle ORM already supports MySQL, SQLite — swap driver + schema |
| **Vector Store** | pgvector | `VectorStore` | In-PG vector search for V0; swap to Milvus/Qdrant/Weaviate for scale |
| **ORM** | Drizzle | `DatabaseAdapter` | SQL-first, type-safe; Drizzle supports PostgreSQL, MySQL, SQLite with same API |
| **Async Tasks** | BullMQ + Redis | `QueueProvider` | OpenAPI import, LLM inference, batch processing — swap to RabbitMQ/SQS as needed |
| **Auth** | NextAuth.js (credentials + OAuth) | `AuthProvider` | Mature, flexible auth for Next.js; supports custom OIDC/LDAP providers |
| **LLM** | Claude API | `LLMProvider` | Structured output, function calling; swap to OpenAI/Gemini/local models |
| **Embedding** | Claude Embedding API | `EmbeddingProvider` | Semantic search embeddings; swap to OpenAI/Cohere/local embedding models |
| **MCP** | @modelcontextprotocol/sdk | — | Standard MCP implementation, Streamable HTTP transport |
| **Storage** | Local filesystem | `StorageProvider` | OpenAPI file storage; swap to S3/MinIO/Google Cloud Storage |
| **Diff** | diff (or custom renderer) | — | Side-by-side comparison for version history and AI edits |

## 5.3 API Layer Design

```
Platform Webapp ──→ tRPC ──→ Core API Server (Hono) ──→ PostgreSQL
Admin Webapp    ──→ tRPC ──→ Core API Server (Hono) ──→ PostgreSQL
                                           │
                                    ┌──────┴──────┐
                                    │  MCP Gateway │  ← runs inside Core API Server,
                                    │  (Streamable │     shares Services directly
                                    │   HTTP)      │
                                    └──────────────┘
                                           ↑
                                    External AI Agents
                                   (Cursor / Claude)
```

- **tRPC** provides end-to-end type safety between Webapps and the Core API Server
- **MCP Gateway** is embedded in the same Hono process; it calls Core Services directly (no HTTP overhead), and exposes a Streamable HTTP endpoint for external agents
- **Both Webapps** are separate Next.js instances; the API Server is an independent process that can be scaled separately
- **Async tasks** (OpenAPI import, Business Context LLM inference) are dispatched to BullMQ workers, not blocking HTTP requests

## 5.4 Auth & RBAC Implementation

### 5.4.1 Architecture Overview

Authentication (identity) and authorization (permissions) are separate concerns handled by different layers:

```
Browser Request
    │
    ▼
┌──────────────────────────────────────────────┐
│  Next.js Middleware (middleware.ts)           │
│                                              │
│  ┌────────────────────┐                      │
│  │ 1. Authentication  │  NextAuth.js         │
│  │    Decode JWT       │  "Who are you?"     │
│  │    → session.user   │                      │
│  └────────┬───────────┘                      │
│           │                                   │
│  ┌────────▼───────────┐                      │
│  │ 2. Authorization   │  RBAC Engine          │
│  │    Check Permission │  "Can you do this?"  │
│  │    → allow / deny   │                      │
│  └────────┬───────────┘                      │
│           │                                   │
│  ┌────────▼───────────┐                      │
│  │ 3. Route Handler   │                      │
│  │    Page / API / MCP│                      │
│  └────────────────────┘                      │
└──────────────────────────────────────────────┘
```

### 5.4.2 Authentication Flow (NextAuth.js)

NextAuth.js (Auth.js v5) is configured with **JWT strategy** — the session token is a signed JWT stored in an httpOnly cookie. No database lookup is needed on every request.

**Configuration (`packages/auth/auth.ts`):**

```ts
import NextAuth from "next-auth"
import GitHub from "next-auth/providers/github"
import Google from "next-auth/providers/google"
import Credentials from "next-auth/providers/credentials"
import { DrizzleAdapter } from "@auth/drizzle-adapter"
import { db } from "@/server/db"

export const { auth, handlers, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db),
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      authorize: async (credentials) => {
        // Verify email + password against DB
        const user = await verifyCredentials(credentials)
        return user // { id, email, name }
      },
    }),
    GitHub({ clientId: process.env.GITHUB_ID, clientSecret: process.env.GITHUB_SECRET }),
    Google({ clientId: process.env.GOOGLE_ID, clientSecret: process.env.GOOGLE_SECRET }),
  ],
  callbacks: {
    jwt: async ({ token, user }) => {
      if (user) token.userId = user.id
      return token
    },
    session: async ({ session, token }) => {
      session.user.id = token.userId as string
      return session
    },
  },
})
```

**JWT payload structure:**

```ts
{
  sub: "user_abc123",      // user ID
  email: "dev@example.com",
  name: "Jiahui Wu",
  iat: 1722000000,         // issued at
  exp: 1722600000,         // expires (7 days)
}
```

### 5.4.3 RBAC Permission Check

The core permission-checking function is called on every authorized request. It resolves a user's **effective permission** for a given resource.

**Resolution order:**

```
checkPermission(userId, resourceType, resourceId, requiredPermission)

Step 1: Is user a platform_admin?
        └── Yes → ALLOW (bypass further checks)

Step 2: Is there an explicit RepoPermission for (userId, repoId)?
        └── Yes → use that role's permissions
        └── No  → fall through to Step 3

Step 3: What is the user's Team role?
        └── team_owner  → inherits repo_admin (all repos in Team)
        └── team_admin  → inherits repo_editor (all repos in Team)
        └── team_member → inherits repo_viewer (all repos in Team)

Step 4: Map role → permissions, check if requiredPermission is included
        └── Yes → ALLOW
        └── No  → DENY (403)
```

**Reference implementation (`packages/auth/rbac.ts`):**

```ts
import { db } from "@/server/db"
import { teamMembers, repoPermissions, users } from "@/server/db/schema"
import { eq, and } from "drizzle-orm"

const ROLE_PERMISSIONS: Record<string, string[]> = {
  team_owner:  ["team:manage_members", "team:delete", "team:manage_settings",
                "repo:read", "repo:write", "repo:import", "repo:delete",
                "repo:manage_permissions", "repo:manage_mcp"],
  team_admin:  ["team:manage_members", "team:manage_settings",
                "repo:read", "repo:write", "repo:import", "repo:delete",
                "repo:manage_permissions", "repo:manage_mcp"],
  team_member: ["repo:read"],
  repo_admin:  ["repo:read", "repo:write", "repo:import", "repo:delete",
                "repo:manage_permissions", "repo:manage_mcp"],
  repo_editor: ["repo:read", "repo:write", "repo:import"],
  repo_viewer: ["repo:read"],
  platform_admin: ["admin:manage_users", "admin:view_stats", "admin:view_audit"],
}

const TEAM_ROLE_INHERITANCE: Record<string, string> = {
  team_owner:  "repo_admin",
  team_admin:  "repo_editor",
  team_member: "repo_viewer",
}

async function checkPermission(
  userId: string,
  resourceType: "team" | "repo" | "mcp" | "admin",
  resourceId: string,
  requiredPermission: string,
): Promise<boolean> {
  // 1. Check platform_admin
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { role: true },
  })
  if (user?.role === "platform_admin") return true

  // 2. For repo-scoped checks
  if (resourceType === "repo" || resourceType === "mcp") {
    // 2a. Check explicit repo-level override
    const explicitRole = await db.query.repoPermissions.findFirst({
      where: and(
        eq(repoPermissions.userId, userId),
        eq(repoPermissions.repoId, resourceId),
      ),
    })
    if (explicitRole) {
      return ROLE_PERMISSIONS[explicitRole.role]?.includes(requiredPermission) ?? false
    }

    // 2b. Fall back to inherited Team role
    const { teamId } = await db.query.repos.findFirst({
      where: eq(repos.id, resourceId),
      columns: { teamId: true },
    }) ?? {}
    if (teamId) {
      const membership = await db.query.teamMembers.findFirst({
        where: and(
          eq(teamMembers.userId, userId),
          eq(teamMembers.teamId, teamId),
        ),
      })
      if (membership) {
        const inheritedRole = TEAM_ROLE_INHERITANCE[membership.role]
        return ROLE_PERMISSIONS[inheritedRole]?.includes(requiredPermission) ?? false
      }
    }
  }

  // 3. For team-scoped checks
  if (resourceType === "team") {
    const membership = await db.query.teamMembers.findFirst({
      where: and(
        eq(teamMembers.userId, userId),
        eq(teamMembers.teamId, resourceId),
      ),
    })
    if (membership) {
      return ROLE_PERMISSIONS[membership.role]?.includes(requiredPermission) ?? false
    }
  }

  return false
}
```

### 5.4.4 Middleware Integration

Next.js middleware runs before every request. It chains authentication (NextAuth.js) with authorization (RBAC):

**`middleware.ts`:**

```ts
import { auth } from "@/packages/auth/auth"
import { checkPermission } from "@/packages/auth/rbac"

// Routes that don't require authentication
const PUBLIC_ROUTES = ["/login", "/register", "/api/auth/*"]

// Route → required permission mapping
const ROUTE_PERMISSIONS: Record<string, { type: string; permission: string }> = {
  "/api/repos/:repoId/edit":       { type: "repo", permission: "repo:write" },
  "/api/repos/:repoId/import":     { type: "repo", permission: "repo:import" },
  "/api/repos/:repoId/settings":   { type: "repo", permission: "repo:manage_permissions" },
  "/api/repos/:repoId/mcp":        { type: "repo", permission: "repo:manage_mcp" },
  "/api/teams/:teamId/members":    { type: "team", permission: "team:manage_members" },
  "/api/teams/:teamId/settings":   { type: "team", permission: "team:manage_settings" },
  "/api/admin/*":                  { type: "admin", permission: "admin:view_stats" },
}

export default auth((req) => {
  const { pathname } = req.nextUrl

  // Allow public routes
  if (PUBLIC_ROUTES.some(r => pathname.startsWith(r))) {
    return  // proceed without auth
  }

  // Require authentication
  if (!req.auth?.user?.id) {
    return Response.redirect(new URL("/login", req.url))
  }

  // Check route-level permission
  const routeConfig = matchRoute(pathname, ROUTE_PERMISSIONS)
  if (routeConfig) {
    const allowed = checkPermission(
      req.auth.user.id,
      routeConfig.type,
      extractResourceId(pathname),  // e.g., extract "repo_123" from "/api/repos/repo_123/edit"
      routeConfig.permission,
    )
    if (!allowed) {
      return new Response("Forbidden", { status: 403 })
    }
  }
})

// Route matcher config
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}
```

### 5.4.5 MCP Tool Authorization

MCP tools use a separate auth path — API key instead of session cookie:

```
External Agent (Cursor/Claude)
    │
    │  Authorization: Bearer apigent_sk_xxxx
    │
    ▼
┌─────────────────────────────────┐
│  MCP Gateway (Hono)             │
│                                 │
│  1. Extract API key from header │
│  2. Look up SecretKey in DB     │
│     ├── expired? → 401          │
│     └── valid? → step 3         │
│  3. Check key.scopes[]          │
│     ├── includes "mcp:search"?  │
│     │   → allow search_apis     │
│     ├── includes "mcp:detail"?  │
│     │   → allow get_api_detail  │
│     └── includes "mcp:context"? │
│         → allow get_project_context│
│  4. Pass userId + repoId to     │
│     RBAC check for repo access   │
└─────────────────────────────────┘
```

### 5.4.6 Shared Auth Package Structure

```
packages/auth/
├── auth.ts              # NextAuth.js configuration
├── auth.config.ts       # Route matchers, public route list
├── middleware.ts         # Next.js middleware (auth + RBAC)
├── rbac.ts              # checkPermission(), role→permission maps
├── mcp-auth.ts          # MCP API key validation (used by Hono server)
└── types.ts             # Session, Role, Permission type definitions
```

**Key design decisions:**

| Decision | Rationale |
|----------|-----------|
| JWT strategy (not database sessions) | No DB lookup per request in middleware; faster, horizontally scalable |
| httpOnly cookie (not localStorage) | Immune to XSS; cookie automatically sent on every request |
| Middleware-level RBAC (not per-handler) | Centralized, auditable; no forgotten checks in individual route handlers |
| MCP uses API key (not session) | External agents (Cursor/CLI) have no browser session; Bearer token is the standard machine-to-machine pattern |
| `packages/auth/` shared across webapps | Both Platform and Admin Webapps use identical auth logic; shared package avoids duplication |

## 5.5 Extensibility Architecture

### 5.5.1 Design Philosophy

Apigent is an **open-source, self-hosted** platform. Different teams have different infrastructure preferences — some run MySQL, some use Milvus for vector search, some want OpenAI instead of Claude. Rather than forcing a single stack, Apigent defines **TypeScript interfaces** for each infrastructure concern and ships with sensible defaults. Users swap implementations by changing configuration, not code.

```
┌─────────────────────────────────────────────────────────────┐
│                    Apigent Core                              │
│                                                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────┐ │
│  │ Services │ │ Agents   │ │ MCP      │ │ Auth / RBAC   │ │
│  │          │ │          │ │ Gateway  │ │               │ │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └──────┬────────┘ │
│       │            │            │               │          │
│       └────────────┴────────────┴───────────────┘          │
│                         │                                   │
│                         ▼                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Interface / Adapter Layer               │   │
│  │                                                     │   │
│  │  VectorStore  LLMProvider  EmbeddingProvider  ...    │   │
│  └──────────────────────┬──────────────────────────────┘   │
└─────────────────────────┼──────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          │               │               │
    ┌─────┴─────┐   ┌─────┴─────┐   ┌─────┴─────┐
    │ Default   │   │  Custom   │   │  Custom   │
    │ pgvector  │   │  Milvus   │   │  Qdrant   │
    └───────────┘   └───────────┘   └───────────┘
```

**Core principle:** Apigent code depends on interfaces, not concrete implementations. Every infrastructure component can be replaced without touching business logic.

### 5.5.2 Swappable Components

| Component | Interface | Default | Common Alternatives |
|-----------|-----------|---------|-------------------|
| **Vector Store** | `VectorStore` | pgvector | Milvus, Qdrant, Weaviate, Pinecone, Chroma |
| **LLM Provider** | `LLMProvider` | Claude API | OpenAI, Gemini, Ollama (local), vLLM |
| **Embedding Provider** | `EmbeddingProvider` | Claude Embedding | OpenAI Embedding, Cohere, BGE (local) |
| **Storage Provider** | `StorageProvider` | Local filesystem | AWS S3, MinIO, Google Cloud Storage, Azure Blob |
| **Queue Provider** | `QueueProvider` | BullMQ + Redis | RabbitMQ, AWS SQS, Google Pub/Sub |
| **Auth Provider** | `AuthProvider` | NextAuth.js | Custom OIDC, LDAP, SAML, Authentik |

### 5.5.3 Vector Store Interface

```ts
// packages/core/src/interfaces/vector-store.ts

export interface VectorDocument {
  id: string
  vector: number[]
  metadata: Record<string, unknown>
}

export interface VectorSearchResult {
  document: VectorDocument
  score: number
}

export interface VectorStore {
  /** Insert or update documents with their embeddings */
  upsert(documents: VectorDocument[]): Promise<void>

  /** Search for similar documents by vector */
  search(vector: number[], options?: {
    topK?: number
    filter?: Record<string, unknown>
  }): Promise<VectorSearchResult[]>

  /** Delete documents by ID */
  delete(ids: string[]): Promise<void>

  /** Delete documents matching a filter */
  deleteByFilter(filter: Record<string, unknown>): Promise<void>

  /** Check connection health */
  health(): Promise<boolean>
}
```

**Default implementation — pgvector:**

```ts
// packages/vector-store-pgvector/src/pgvector-store.ts
import { VectorStore, VectorDocument, VectorSearchResult } from "@/core/interfaces"
import { sql } from "drizzle-orm"

export class PgvectorStore implements VectorStore {
  async upsert(documents: VectorDocument[]): Promise<void> {
    await this.db.insert(embeddings).values(
      documents.map(d => ({
        id: d.id,
        vector: sql`${JSON.stringify(d.vector)}::vector`,
        metadata: d.metadata,
      }))
    ).onConflictDoUpdate({
      target: embeddings.id,
      set: { vector: sql`excluded.vector`, metadata: sql`excluded.metadata` },
    })
  }

  async search(vector: number[], options?: {
    topK?: number
    filter?: Record<string, unknown>
  }): Promise<VectorSearchResult[]> {
    const topK = options?.topK ?? 10
    const rows = await this.db.execute(sql`
      SELECT id, metadata, 1 - (vector <=> ${JSON.stringify(vector)}::vector) AS score
      FROM embeddings
      ORDER BY vector <=> ${JSON.stringify(vector)}::vector
      LIMIT ${topK}
    `)
    return rows.map(r => ({
      document: { id: r.id, vector: [], metadata: r.metadata },
      score: r.score,
    }))
  }

  // ... delete, deleteByFilter, health
}
```

**Example swap — Milvus:**

```ts
// User's project: my-apigent/vector-store.ts
import { VectorStore, VectorDocument, VectorSearchResult } from "apigent/core"
import { MilvusClient } from "@zilliz/milvus2-sdk-node"

export class MilvusStore implements VectorStore {
  private client: MilvusClient

  constructor(config: { host: string; port: number; collection: string }) {
    this.client = new MilvusClient({ address: `${config.host}:${config.port}` })
  }

  async upsert(documents: VectorDocument[]): Promise<void> {
    await this.client.insert({
      collection_name: this.collection,
      data: documents.map(d => ({
        id: d.id,
        vector: d.vector,
        metadata: JSON.stringify(d.metadata),
      })),
    })
  }

  async search(vector: number[], options?: {
    topK?: number
    filter?: Record<string, unknown>
  }): Promise<VectorSearchResult[]> {
    const results = await this.client.search({
      collection_name: this.collection,
      vector,
      limit: options?.topK ?? 10,
    })
    return results.map(r => ({
      document: { id: r.id, vector: [], metadata: JSON.parse(r.metadata) },
      score: r.score ?? 0,
    }))
  }

  async delete(ids: string[]): Promise<void> {
    await this.client.delete({ collection_name: this.collection, ids })
  }

  // ... deleteByFilter, health
}
```

### 5.5.4 LLM Provider Interface

```ts
// packages/core/src/interfaces/llm-provider.ts

export interface ChatMessage {
  role: "system" | "user" | "assistant"
  content: string
}

export interface ChatOptions {
  model?: string
  temperature?: number
  maxTokens?: number
  responseFormat?: "text" | "json_object"
}

export interface ChatResponse {
  content: string
  usage: { inputTokens: number; outputTokens: number }
}

export interface LLMProvider {
  /** Single-turn chat completion */
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse>

  /** Streaming chat completion */
  chatStream(messages: ChatMessage[], options?: ChatOptions): AsyncIterable<string>

  /** List available models */
  listModels(): Promise<string[]>
}
```

**Default:** `ClaudeProvider` wraps `@anthropic-ai/sdk`.  
**Alternatives:** `OpenAIProvider` wraps `openai` SDK, `OllamaProvider` wraps Ollama HTTP API, `GeminiProvider` wraps `@google/generative-ai`.

### 5.5.5 Embedding Provider Interface

```ts
// packages/core/src/interfaces/embedding-provider.ts

export interface EmbeddingProvider {
  /** Generate embedding for a single text */
  embed(text: string): Promise<number[]>

  /** Generate embeddings for multiple texts (batch) */
  embedBatch(texts: string[]): Promise<number[][]>

  /** Dimension of the embedding vectors */
  readonly dimension: number
}
```

This interface is separate from `LLMProvider` because:
- Some deployments use different services for chat vs. embeddings (e.g., Claude for chat + Cohere for embeddings)
- Local embedding models (BGE, GTE) have no chat capability
- Decoupled interfaces allow independent swap

**Default:** `ClaudeEmbeddingProvider` using Claude Embedding API.  
**Alternatives:** `OpenAIEmbeddingProvider`, `CohereEmbeddingProvider`, `LocalEmbeddingProvider` (wraps FastEmbed/Transformers.js).

### 5.5.6 Storage Provider Interface

```ts
// packages/core/src/interfaces/storage-provider.ts

export interface StorageProvider {
  /** Upload a file, return its storage path */
  upload(key: string, body: Buffer | ReadableStream, contentType: string): Promise<string>

  /** Download a file as a Buffer */
  download(key: string): Promise<Buffer>

  /** Get a signed URL for direct access (optional) */
  getSignedUrl?(key: string, expiresInSeconds: number): Promise<string>

  /** Delete a file */
  delete(key: string): Promise<void>

  /** Check if a file exists */
  exists(key: string): Promise<boolean>
}
```

**Default:** `LocalStorageProvider` stores files under `data/uploads/`.  
**Alternatives:** `S3StorageProvider`, `MinioStorageProvider`, `GCSStorageProvider`.

### 5.5.7 Queue Provider Interface

```ts
// packages/core/src/interfaces/queue-provider.ts

export interface QueueProvider {
  /** Enqueue a job with payload */
  enqueue<T>(queueName: string, payload: T, options?: {
    delay?: number
    priority?: number
  }): Promise<string>

  /** Register a handler for a queue */
  register<T, R>(queueName: string, handler: (payload: T) => Promise<R>): void

  /** Get job status */
  getStatus(jobId: string): Promise<"waiting" | "active" | "completed" | "failed">

  /** Gracefully shut down */
  shutdown(): Promise<void>
}
```

**Default:** `BullmqQueueProvider` wraps BullMQ + Redis.  
**Alternatives:** `RabbitmqQueueProvider`, `SqsQueueProvider`, `InMemoryQueueProvider` (dev/testing).

### 5.5.8 Configuration System — Two-Layer Design

Apigent uses a **two-layer configuration system** designed for easy switching between dev and deployment environments:

| Layer | File | What goes here | Examples |
|-------|------|---------------|----------|
| **Scheme choices** | `apigent.config.yaml` | Which provider / model / strategy to use (structured YAML, supports comments) | `llm.provider: claude`, `rag.retrievalMode: hybrid` |
| **Secrets** | `.env` | API keys, passwords, connection strings (`APIGENT_` prefix) | `ANTHROPIC_API_KEY`, `APIGENT_DATABASE_URL`, `APIGENT_AUTH_SECRET` |
| **Programmatic config** | `apigent.config.ts` | Custom provider factories, advanced wiring (optional — most users only need `.yaml` + `.env`) | Custom `VectorStore` implementation, plugin registration |

**Default workflow — apigent.config.yaml + .env (95% of users):**

`apigent.config.yaml` (scheme choices):
```yaml
llm:
  provider: claude
  models:
    default: claude-sonnet-5
    query_rewrite: claude-haiku-4-5-20251001
    rag_answer: claude-sonnet-5

embedding:
  provider: claude
  model: claude-embedding

rag:
  retrievalMode: hybrid
  reranker:
    provider: bge-reranker
    model: BAAI/bge-reranker-v2-m3
```

`.env` (secrets only):
```bash
ANTHROPIC_API_KEY=sk-ant-your-key-here
APIGENT_DATABASE_URL=postgresql://localhost:5432/apigent_dev
APIGENT_REDIS_URL=redis://localhost:6379
APIGENT_AUTH_SECRET=your-secret-here
```

The config loader reads YAML + .env and constructs a fully-typed `ApigentConfig`:

```ts
import { loadConfig } from "@apigent/core/config";

const config = loadConfig();
// → reads apigent.config.yaml + .env → ApigentConfig
```

**Advanced workflow — apigent.config.ts (custom providers):**

For custom provider implementations, `apigent.config.ts` adds programmatic overrides on top of YAML + env:

```ts
// apigent.config.ts
import type { ApigentConfig } from "@apigent/core";
import { loadConfig } from "@apigent/core/config";
import { MyCustomVectorStore } from "./my-vector-store";

const base = loadConfig();

const config: ApigentConfig = {
  ...base,
  vectorStore: () => new MyCustomVectorStore({ /* ... */ }),
};

export default config;
```

**Swap example — dev (Claude + pgvector) → production (OpenAI + Milvus):**

No code change needed. Just use different files per environment:

```yaml
# apigent.config.prod.yaml
llm:
  provider: openai
  models:
    default: gpt-4o
    query_rewrite: gpt-4o-mini

embedding:
  provider: openai
  model: text-embedding-3-small

vectorStore:
  provider: milvus
  host: milvus-prod.internal
  port: 19530

rag:
  reranker:
    provider: cohere
```

```bash
# .env.production
OPENAI_API_KEY=sk-prod-key
APIGENT_COHERE_API_KEY=co-prod-key
APIGENT_DATABASE_URL=postgresql://prod-db:5432/apigent
APIGENT_AUTH_SECRET=prod-secret
```

Config type definitions are in `packages/core/src/config/types.ts`. See `.env.example` and `apigent.config.example.yaml` at the repo root for all available options.

The Apigent core framework reads this config at startup and injects implementations via a **service container**:

```ts
// packages/core/src/container.ts
import type { ApigentConfig } from "./config"

export class Container {
  private instances = new Map<string, unknown>()

  constructor(private config: ApigentConfig) {}

  getVectorStore(): VectorStore {
    if (!this.instances.has("vectorStore")) {
      this.instances.set("vectorStore", this.config.vectorStore())
    }
    return this.instances.get("vectorStore") as VectorStore
  }

  getLLM(): LLMProvider { /* ... */ }
  getEmbedding(): EmbeddingProvider { /* ... */ }
  getStorage(): StorageProvider { /* ... */ }
  getQueue(): QueueProvider { /* ... */ }
}

// Singleton — initialized once at app startup
let container: Container

export function initContainer(config: ApigentConfig) {
  container = new Container(config)
}

export function getContainer(): Container {
  if (!container) throw new Error("Container not initialized")
  return container
}
```

Business code never imports a concrete implementation directly:

```ts
// ✅ GOOD — uses interface, works with any implementation
import { getContainer } from "@/core/container"

async function searchApis(query: string) {
  const vectorStore = getContainer().getVectorStore()
  const embeddingProvider = getContainer().getEmbedding()
  const queryVector = await embeddingProvider.embed(query)
  return vectorStore.search(queryVector, { topK: 10 })
}

// ❌ BAD — hardcoded dependency, can't swap
import { PgvectorStore } from "@apigent/vector-store-pgvector"
```

### 5.5.9 Plugin System (V1+)

Beyond core infrastructure interfaces, Apigent supports **plugins** for extending platform behavior:

```
plugins/
├── custom-notification/       # Send notifications via WeChat/Slack/email
│   ├── index.ts
│   └── package.json
├── custom-ai-rule/            # Add custom lint/validation rules
│   ├── index.ts
│   └── package.json
└── custom-export/             # Export APIs in custom formats
    ├── index.ts
    └── package.json
```

**Plugin interface (V1):**

```ts
export interface ApigentPlugin {
  name: string
  version: string
  /** Called when the plugin is registered */
  register(ctx: PluginContext): void | Promise<void>
  /** Called when the plugin is unregistered */
  unregister?(): void | Promise<void>
}

export interface PluginContext {
  container: Container
  logger: Logger
  /** Register a hook into the platform lifecycle */
  onHook(hook: string, handler: (...args: any[]) => Promise<void>): void
}
```

Plugins register via `apigent.config.ts`:

```ts
const config: ApigentConfig = {
  // ... core config
  plugins: [
    "./plugins/custom-notification",
    "./plugins/custom-ai-rule",
  ],
}
```

---

# 6. V0 Scope

Consolidating from the blueprint roadmap, V0 covers the minimal usable product:

| Area | V0 Features |
|------|------------|
| **Auth** | Email login/register, session management |
| **Team** | Create team, invite members, basic roles |
| **Repository** | Create repo, import OpenAPI (file/URL), version list |
| **Browsing** | Endpoint list (grouped by tag), model list, semantic search (natural language) |
| **Core Engine** | OpenAPI Parser → Business Context Agent → Knowledge Graph |
| **MCP** | Basic MCP Gateway with `search_apis` + `get_api_detail` + `get_project_context` |
| **Secret Keys** | Generate, list, delete keys |
| **Dashboard** | Simple repo list + recent activity |
| **Admin** | Basic user list, platform stats |
