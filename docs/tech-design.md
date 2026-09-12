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
- **Core Engine** — the API knowledge pipeline (OpenAPI Parser → Business Context Agent → MCP Gateway; Knowledge Graph is a V1+ optional enhancement), detailed in [docs/modules/](./modules/)

**Application map** (which runtime each app uses):

| App             | Runtime                  | Port | Role                                                                                       |
| --------------- | ------------------------ | ---- | ------------------------------------------------------------------------------------------ |
| `apps/platform` | **Next.js** (App Router) | 3000 | Developer-facing webapp **and** the Platform REST API (Route Handlers in `src/app/api/**`) |
| `apps/admin`    | **Next.js** (App Router) | 3001 | Admin webapp (shell in V0; full features in V1)                                            |
| `apps/open`     | **Hono**                 | 3002 | Open Gateway — machine-facing surface (health today, MCP endpoint in V1)                   |

Shared, framework-agnostic logic lives in `packages/*` and is imported by these apps rather than deployed as its own service.

---

# 2. Core Domain Model

## 2.1 Entity Overview

```
┌──────────┐     ┌──────────────────┐     ┌────────────────┐
│   User   │────→│ OrganizationMember│←────│  Organization  │
└──────────┘     └──────────────────┘     └────────────────┘
     │                                      │
     │  ┌──────────────────┐               │
     ├──│  SecretKey       │               │
     │  └──────────────────┘               │
     │                               ┌─────┴──────┐
     │  ┌──────────────────┐        │ Repository  │
     └──│  RepoPermission  │←──────→│  (1 repo =  │
        └──────────────────┘        │  1 OpenAPI  │
                                    │  file)      │
                                    └─────────────┘
                                           │
                                    ┌──────┴──────┐
                                    │   OpenAPI   │
                                    │  Versions   │
                                    └─────────────┘

┌──────────┐     ┌──────────────────┐     ┌─────────────┐
│ Project  │────→│ ProjectRepository │←────│ Repository │
└──────────┘     └──────────────────┘     └─────────────┘
     │
     │  ┌──────────────────┐
     └──│   ProjectMember  │
        └──────────────────┘
```

## 2.2 User

Represents a registered user account.

| Field           | Type      | Description                          |
| --------------- | --------- | ------------------------------------ |
| `id`            | UUID      | Unique identifier                    |
| `email`         | string    | Login email (unique)                 |
| `password_hash` | string    | Hashed password                      |
| `sso_providers` | string[]  | Linked SSO accounts (github, google) |
| `name`          | string    | Display name                         |
| `avatar_url`    | string    | Avatar image URL                     |
| `created_at`    | timestamp | Registration time                    |
| `updated_at`    | timestamp | Last update time                     |

## 2.3 Organization

The top-level tenant boundary. Users create Organizations first, then create Repositories within them.

| Field        | Type      | Description                    |
| ------------ | --------- | ------------------------------ |
| `id`         | UUID      | Unique identifier              |
| `name`       | string    | Organization display name      |
| `slug`       | string    | URL-friendly unique identifier |
| `owner_id`   | UUID      | Organization creator           |
| `created_at` | timestamp | Creation time                  |

## 2.4 OrganizationMember

Associates a User with an Organization and their role.

| Field             | Type   | Description                                            |
| ----------------- | ------ | ------------------------------------------------------ |
| `user_id`         | UUID   | User reference                                         |
| `organization_id` | UUID   | Organization reference                                 |
| `role`            | string | Role identifier (see [2.8 RBAC Model](#28-rbac-model)) |

**Organization-level roles:**

| Role         | Scope        | Summary                                                             |
| ------------ | ------------ | ------------------------------------------------------------------- |
| `org_owner`  | Organization | Full control: delete Organization, manage members, manage all repos |
| `org_admin`  | Organization | Manage members, manage all repos within the Organization            |
| `org_member` | Organization | Access repos based on repo-level role assignment                    |

## 2.5 Repository

The technical asset container. **One Repository = one OpenAPI file + its version history.** Repository holds the technical layer plus **Capability Context** (V0) — what capabilities this backend provides. Consumer-side **Usage Context** lives in Project (see [2.9](#29-project)).

| Field                | Type      | Description                                                                                                          |
| -------------------- | --------- | -------------------------------------------------------------------------------------------------------------------- |
| `id`                 | UUID      | Unique identifier                                                                                                    |
| `organization_id`    | UUID      | Parent Organization                                                                                                  |
| `name`               | string    | Repository name                                                                                                      |
| `description`        | string    | Repository description (LLM-assisted)                                                                                |
| `capability_context` | object    | Capability Context (V0): capability intent, constraints, side effects, examples — produced by Business Context Agent |
| `openapi_versions`   | Version[] | OpenAPI version history                                                                                              |
| `current_version`    | string    | Active version identifier                                                                                            |
| `mcp_enabled`        | boolean   | Whether MCP is enabled for this repo                                                                                 |
| `created_at`         | timestamp | Creation time                                                                                                        |
| `updated_at`         | timestamp | Last update time                                                                                                     |

**Version management:**

- Each import creates a new version (auto-detected from OpenAPI `info.version`)
- Version history with diff between versions
- Ability to rollback to a previous version
- Export to OpenAPI JSON/YAML at any version

## 2.6 RepositoryMember

A Repository's own membership table. **The repository directory is platform-wide; repository content is decided by this table** — without a row here, and without being an admin/owner of the owning Organization, content access is 403 (see [2.8 RBAC Model](#28-rbac-model)).

| Field           | Type      | Description                                                 |
| --------------- | --------- | ----------------------------------------------------------- |
| `repository_id` | string    | Repository reference (composite PK with `user_id`)          |
| `user_id`       | string    | User reference                                              |
| `role`          | string    | Repository role identifier (see [2.8.1](#281-tenant-roles)) |
| `granted_at`    | timestamp | When the member was added                                   |
| `granted_by`    | string    | Who granted it (for audit); NULL for system writes          |

**Repository roles (a strict four-level ladder):**

| Role          | Capabilities                                                                           |
| ------------- | -------------------------------------------------------------------------------------- |
| `repo_owner`  | Everything, including deleting the Repository                                          |
| `repo_admin`  | Repository settings (MCP, etc.) and member management                                  |
| `repo_member` | Edit basic info, import/export APIs, edit business context, branch and delete entities |
| `repo_viewer` | Read-only access to the Repository                                                     |

## 2.7 SecretKey

User-level API key for MCP access. External AI Agents use this key to authenticate with the MCP Gateway.

| Field          | Type      | Description                                                                                                 |
| -------------- | --------- | ----------------------------------------------------------------------------------------------------------- |
| `id`           | UUID      | Unique identifier                                                                                           |
| `user_id`      | UUID      | Owner reference                                                                                             |
| `name`         | string    | Human-readable key name                                                                                     |
| `key_hash`     | string    | Hashed key (raw key shown only once at creation)                                                            |
| `key_prefix`   | string    | First 8 chars for identification (e.g., `apigent_sk_...`)                                                   |
| `scopes`       | string[]  | Permission scopes: `api:read`, `api:write` (external REST), `mcp:search`, `mcp:detail`, `mcp:context` (MCP) |
| `last_used_at` | timestamp | Last usage timestamp                                                                                        |
| `expires_at`   | timestamp | Expiration time (optional)                                                                                  |
| `created_at`   | timestamp | Creation time                                                                                               |

## 2.8 RBAC Model

Authorization is split into **two independent systems**. They share identity (`users`) but never share vocabulary: a tenant role can never grant an admin capability, and an admin role can never grant tenant content rights.

| System          | Scope                                  | Used by         | Stored in                                    |
| --------------- | -------------------------------------- | --------------- | -------------------------------------------- |
| **Tenant RBAC** | One Organization / Repository          | Platform Webapp | `organization_members`, `repository_members` |
| **Admin RBAC**  | The whole deployment (instance-scoped) | Admin Webapp    | `admin_members`                              |

> **Why two systems:** tenant roles answer "what can you do inside this tenant", admin roles answer "what can you do as the operator of this deployment". They are orthogonal — a single role hierarchy cannot express "can manage platform admins, but cannot edit repository content", which is exactly what the platform operator role must be able to do (and not do).

### 2.8.1 Tenant Roles

| Role ID          | Level         | Description                                                                                           |
| ---------------- | ------------- | ----------------------------------------------------------------------------------------------------- |
| `org_owner`      | Organization  | Full control over the Organization (incl. deletion); implicitly `repo_owner` on all of its repos      |
| `org_admin`      | Organization  | Edit Organization info and members, **cannot delete it**; implicitly `repo_admin` on all of its repos |
| `org_member`     | Organization  | Read-only on Organization info; **implies no repository role at all**                                 |
| `repo_owner`     | Repository    | Everything, including deleting the Repository                                                         |
| `repo_admin`     | Repository    | Repository settings (MCP, etc.) and member management                                                 |
| `repo_member`    | Repository    | Edit basic info, import/export APIs, edit business context, branch and delete entities                |
| `repo_viewer`    | Repository    | Read-only access to the Repository                                                                    |
| `project_owner`  | Project (V1+) | Full control over a Project and its Repository links                                                  |
| `project_admin`  | Project (V1+) | Manage Project members and Repository links                                                           |
| `project_viewer` | Project (V1+) | View a Project and its aggregated usage context                                                       |

Repository roles form a **strict four-level ladder** (`viewer ⊂ member ⊂ admin ⊂ owner`), so a rank comparison is enough to decide them.

### 2.8.2 Permission Naming Convention

**Enforcement today is a role-rank comparison** (`isRepoRoleAtLeast` / `isOrgRoleAtLeast`); there is no capability layer yet, because tenant capabilities are genuinely nested.

| Permission              | Level         | Description                                              |
| ----------------------- | ------------- | -------------------------------------------------------- |
| `org:manage_members`    | Organization  | Invite, remove, and change member roles                  |
| `org:manage_settings`   | Organization  | Edit Organization name and description                   |
| `org:delete`            | Organization  | Delete the Organization (only after its repos are gone)  |
| `repo:read`             | Repository    | View APIs, models, business context                      |
| `repo:write`            | Repository    | Edit API descriptions, business context; delete entities |
| `repo:import`           | Repository    | Import new OpenAPI versions; create branches             |
| `repo:activate_version` | Repository    | Activate / roll back (moves the default-version pointer) |
| `repo:manage_members`   | Repository    | Add, change and remove repository members                |
| `repo:manage_mcp`       | Repository    | Enable/disable MCP, configure tool exposure              |
| `repo:delete`           | Repository    | Delete the Repository                                    |
| `project:read`          | Project (V1+) | View a Project and its aggregated usage context          |
| `project:manage`        | Project (V1+) | Manage Project settings and members                      |
| `project:link_repo`     | Project (V1+) | Link/unlink Repositories to/from a Project               |
| `api:read`              | REST API      | Access external REST endpoints (read)                    |
| `api:write`             | REST API      | Access external REST endpoints (write)                   |
| `mcp:search`            | MCP           | Access `search_apis` tool                                |
| `mcp:detail`            | MCP           | Access `get_api_detail` tool                             |
| `mcp:context`           | MCP           | Access `get_project_context` tool                        |

### 2.8.3 Tenant Role → Permission Mapping

| Role             | Permissions                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `org_owner`      | `org:*`; every `repo:*` on all repos of the Organization                                                                  |
| `org_admin`      | `org:manage_members`, `org:manage_settings`; every `repo:*` except `repo:delete` on all repos of the Organization         |
| `org_member`     | No Organization or repository write rights; **nor any implied repository read** — repo content requires a repository role |
| `repo_owner`     | Every `repo:*` on that repository                                                                                         |
| `repo_admin`     | `repo:read`, `repo:write`, `repo:import`, `repo:activate_version`, `repo:manage_members`, `repo:manage_mcp`               |
| `repo_member`    | `repo:read`, `repo:write`, `repo:import`                                                                                  |
| `repo_viewer`    | `repo:read`                                                                                                               |
| `project_owner`  | `project:*` (V1+)                                                                                                         |
| `project_admin`  | `project:read`, `project:manage`, `project:link_repo` (V1+)                                                               |
| `project_viewer` | `project:read` (V1+)                                                                                                      |

### 2.8.4 Repository Directory vs. Repository Content

**The directory is platform-wide; content is gated by role.** Being able to _discover_ a repository and being able to _open_ it are two different things.

```
Repository directory (/repos list)
  Any signed-in user sees every repository on the platform (name / description / Organization)

Repository content (detail page and every /api/repos/*)
  ① has a repository_members row      → use that role
  ② else the owning Organization → org_owner → repo_owner
                                   org_admin → repo_admin
  ③ neither                      → 403 (pointing at the repo or org admin)
```

1. **Directory and content are separate.** The directory answers "can I discover it"; the gate answers "can I read it". Repositories you cannot open show a lock marker in the list and their version numbers / endpoint counts are not sent — those are already content metadata.
2. **An explicit membership row wins, and may override downward.** Resolution is "repository first, Organization second", so setting an `org_admin` to `repo_viewer` on one repository really does make them read-only there — useful for locking a single repo down. This is why the old "overrides may only elevate" rule is gone.
3. **Organization membership no longer implies repository read access.** An `org_member` must be added to a repository explicitly.
4. Repository members are managed in the **Platform Webapp** (repo settings → members). The page lists explicit members (editable) and Organization-implied members (read-only there).
5. Override targets must be **members of the Organization**; V0 does not support guests outside the Organization (the `repository_members` shape allows it later).
6. **The creator of a repository automatically becomes its `repo_owner`** — otherwise a brand-new repository has no first member and nobody can administer it.

### 2.8.5 Admin Roles

Admin roles apply to the whole deployment and live in `admin_members(userId, role, grantedAt, grantedBy)` — one row means "this user can sign in to the Admin Webapp".

| Role ID          | Status                     | Description                                                                                            |
| ---------------- | -------------------------- | ------------------------------------------------------------------------------------------------------ |
| `admin_super`    | **V0 target**              | Super administrator. Manages who else is an admin, and has read-only access to platform stats / audit. |
| `admin_operator` | Reserved (not implemented) | Operations: account lifecycle (disable / enable), statistics, audit                                    |
| `admin_support`  | Reserved (not implemented) | Support: read-only plus a few restricted actions (e.g. disable an account, but never delete it)        |

Notes:

- **No tenant-scoped admin role exists.** Managing Organization / Repository members and roles stays in the Platform Webapp (§3.8), so the Admin Webapp never needs a per-tenant scope. This also means `admin_super` has no path to tenant data: it cannot add itself to a tenant and then edit content.
- **No read-only admin role right now** (`admin_viewer` was considered and dropped). Add `admin_support` when someone needs global visibility without the ability to change anything.
- Role values follow the `scope_tier` convention already used by `org_*` / `repo_*`. Avoid `admin_member` (collides with the "member = lowest, unprivileged tier" meaning of `org_member`) and `admin_sub` (says nothing about what the role can do).

### 2.8.6 Admin Permissions

Permission names follow `admin:<domain>:<action>`.

| Permission            | Status        | Description                                                                      |
| --------------------- | ------------- | -------------------------------------------------------------------------------- |
| `admin:admins:manage` | V0            | Grant / revoke admin roles (only `admin_super` holds it)                         |
| `admin:stats:view`    | V0            | View platform statistics                                                         |
| `admin:audit:view`    | V0            | View the platform-wide audit log                                                 |
| `admin:users:view`    | V0            | List users and open a user detail page                                           |
| `admin:users:disable` | Reserved      | Disable / re-enable a user account                                               |
| `admin:users:delete`  | Reserved      | Permanently delete a user account and its data                                   |
| `admin:content:read`  | Open question | Read arbitrary Repository content for troubleshooting (default: **not granted**) |

`admin_super` holds exactly the four V0 permissions above. It holds **no** `repo:*` or `org:*` permission, so "read-only on the Platform Webapp" is a structural property, not a convention.

### 2.8.7 Cross-System Rules

1. **Writes come from the tenant system.** `org:*` / `repo:*` permissions are the only source of content and membership writes inside a tenant.
2. **The admin system must never hold content-write permissions.** Enforced by a test: no `admin_*` role may map to `repo:write`, `repo:import`, `repo:delete`, `repo:manage_members`, `repo:manage_mcp`, or any `org:*` write permission. Adding such a mapping fails CI rather than being caught in review.
3. **`admin_super` is not a data superuser.** Its only write capability is `admin:admins:manage`; it cannot edit content and cannot add or remove Organization / Repository members.
4. **Secret Keys are a separate plane.** MCP tools and the external REST API are authenticated with user-issued Secret Keys carrying `mcp:*` / `api:*` scopes; a tenant or admin session role is never sufficient on its own. (The SecretKey issue/verify path is not implemented yet — see §5.4.8.)
5. **Double-layer rule (V1+):** Project membership only grants visibility of the Project itself. Content inside linked Repositories is always governed by `repo:*` permissions — Project views are assembled from the Repositories the user can access.

### 2.8.8 Assignment & Bootstrap

| Role                                                        | Who can grant it                                                                                                             |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `org_owner`                                                 | Only via Organization ownership transfer                                                                                     |
| `org_admin` / `org_member`                                  | `org_admin`+ of that Organization                                                                                            |
| `repo_viewer` / `repo_member` / `repo_admin` / `repo_owner` | Anyone with an effective role of `repo_admin`+ on that repository (including the implied roles of `org_admin` / `org_owner`) |
| `admin_super`                                               | Another `admin_super`, or the bootstrap seed                                                                                 |

The **first** `admin_super` is created by an explicit seed command, never through the Admin Webapp — otherwise there is no one able to grant the first admin (a bootstrapping deadlock). The **first `repo_owner` of a new repository** is its creator (§2.8.4, item 6) and needs no grant.

> Repository member management only adds/removes **explicit `repository_members` rows**. The `repo_admin` / `repo_owner` of Organization admins and owners are implicit and never stored, so "removing" them from the member page does nothing — revoke by changing the Organization role instead.

---

## 2.9 Project

An independent business-layer entity that aggregates Repositories across Organizations (many-to-many via `ProjectRepository`). Project is **not** attached to an Organization. It holds the **Usage Context** (V1+): how the project uses each linked Repository's capabilities.

| Field           | Type      | Description                                                                                                                |
| --------------- | --------- | -------------------------------------------------------------------------------------------------------------------------- |
| `id`            | UUID      | Unique identifier                                                                                                          |
| `name`          | string    | Project display name                                                                                                       |
| `description`   | string    | Project description (business purpose)                                                                                     |
| `usage_context` | object    | Usage Context (V1+, per `(project, repo)`): usage scenarios, usage policy, workflows; plus domain glossary and conventions |
| `created_at`    | timestamp | Creation time                                                                                                              |
| `updated_at`    | timestamp | Last update time                                                                                                           |

**ProjectRepository (M:N join):**

| Field           | Type | Description                                                   |
| --------------- | ---- | ------------------------------------------------------------- |
| `project_id`    | UUID | Project reference                                             |
| `repository_id` | UUID | Repository reference (may belong to a different Organization) |

**ProjectMember:**

| Field        | Type   | Description                                          |
| ------------ | ------ | ---------------------------------------------------- |
| `user_id`    | UUID   | User reference                                       |
| `project_id` | UUID   | Project reference                                    |
| `role`       | string | `project_owner` / `project_admin` / `project_viewer` |

**Double-layer access rule:** Project membership only determines whether a user can see the Project exists. Content inside any linked Repository is always gated by `repo:*` permissions — a Project view is assembled from the subset of Repositories the user can access.

**V0 status:** Project is defined in the domain model but **not implemented in V0**. Features (Project CRUD, Usage Context, cross-Repository knowledge aggregation, `get_project_context`) ship in V1+.

# 3. Platform Webapp

The main application for developers to manage their APIs as Agent-accessible knowledge assets.

## 3.1 Authentication

| Feature                | Description                                                              | V0 status                                            |
| ---------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------- |
| **Email Registration** | Sign up with email + password                                            | ✅ implemented (no email verification yet)           |
| **Email Login**        | Verify credentials against `users`, then issue the signed cookie         | ✅ implemented                                       |
| **SSO Login**          | GitHub OAuth, Google OAuth                                               | ⏳ not implemented (`auth.providers` config slot)    |
| **Password Reset**     | Email-based password reset flow                                          | ⏳ not implemented                                   |
| **Session Management** | HMAC-SHA256 signed httpOnly cookie (`apigent_session`); logout clears it | ✅ implemented (no refresh token / revocation in V0) |

## 3.2 User Profile

| Feature                      | Description                       |
| ---------------------------- | --------------------------------- |
| **Profile Editing**          | Name, avatar, bio                 |
| **Security Settings**        | Change password, manage SSO links |
| **Notification Preferences** | Email notification settings       |

## 3.3 Organization Management

| Feature                 | Description                                       |
| ----------------------- | ------------------------------------------------- |
| **Create Organization** | Name + slug, creator becomes Owner                |
| **Invite Members**      | Email invitation, role assignment                 |
| **Member List**         | View all members with roles                       |
| **Role Management**     | Owner/Admin can change member roles               |
| **Leave/Remove**        | Members can leave; Owner/Admin can remove members |

## 3.4 Homepage / Dashboard

After login, users see:

- **Repository Overview**: list of repos across all Organizations, with last update time, API count
- **Recent Activity**: recent imports, edits, member changes
- **Quick Actions**: Create Organization, Create Repository, Import OpenAPI
- **Global Search**: search across repos and APIs

## 3.5 Repository Management

### 3.5.1 Create & Import

| Action                  | Description                                                                                                                               |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Create Repository**   | Name + optional description                                                                                                               |
| **Import OpenAPI**      | Upload JSON/YAML file, or fetch from URL; runs asynchronously after confirmation (see [Async Queue module doc](./modules/async-queue.md)) |
| **Auto-detect Version** | Extract version from OpenAPI `info.version` field                                                                                         |
| **Validation**          | Validate spec before import, show errors                                                                                                  |

> **Async execution (V0 target)**: the request returns a task ID immediately; parse/persistence runs in a queue worker, with progress surfaced through top-bar notifications and a repo status badge (see [Async Queue module doc](./modules/async-queue.md)).

### 3.5.2 Content Display

Two primary views for browsing a repository:

**Endpoints View:**

- List of all API endpoints, grouped by tag
- Each endpoint shows: method, path, summary, capability intent (from Business Context Agent)
- Click to expand: request/response schema, business rules, examples, related APIs

**Data Models View:**

- List of all schemas/components defined in the OpenAPI spec
- Schema tree visualization with field types, constraints, descriptions
- Cross-reference: which endpoints use this model

### 3.5.3 Version Management

| Feature          | Description                                 |
| ---------------- | ------------------------------------------- |
| **Version List** | Complete import history with timestamps     |
| **Version Diff** | Side-by-side comparison of any two versions |
| **Rollback**     | Revert to a previous version                |
| **Export**       | Download OpenAPI JSON/YAML at any version   |

## 3.6 API Search & Knowledge Retrieval

The primary entry point for developers to find and understand APIs within the platform. Detailed retrieval architecture and RAG pipeline are documented in the agent design docs — this section provides a feature-level overview.

### 3.6.1 V0 — Semantic Search

| Feature               | Description                                                                                                                                                      |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Global Search Bar** | Accessible from Dashboard and Repository pages. Natural language input                                                                                           |
| **Hybrid Search**     | Embedding (Dense) + BM25 (Sparse) + Knowledge Graph — fused via RRF, re-ranked by cross-encoder. See [Semantic Search Agent](./modules/semantic-search.agent.md) |
| **Permission-aware**  | Results pre-filtered by RBAC effective permissions — users only see APIs they can access                                                                         |
| **Search Scope**      | Global (across all accessible repos) or scoped to a single Repository/Organization                                                                               |
| **Filters**           | Filter by HTTP method, tag, path prefix                                                                                                                          |
| **Result Display**    | API method + path, capability intent summary, match reason, relevance score                                                                                      |
| **Quick Actions**     | Click result → navigate to API detail page                                                                                                                       |

**Implementation:** The [Semantic Search Agent](./modules/semantic-search.agent.md) — same engine powering MCP `search_apis`. LLM calls ≤1 per query (optional query rewriting; retrievals are deterministic).

### 3.6.2 V1 — RAG Knowledge Q&A

Conversational RAG interface for deeper API understanding.

| Feature                | Description                                                                                                                                                                 |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Conversational Q&A** | Multi-turn chat; ask follow-up questions naturally                                                                                                                          |
| **RAG Pipeline**       | Query Rewriting → Permission Pre-filter → Hybrid Retrieval (Embedding + BM25 + KG) → RRF Coarse Rank → Cross-encoder Fine Rank → Context Assembly → Answer Generation (LLM) |
| **Source Citations**   | Every answer links back to the specific APIs and models it references                                                                                                       |
| **Knowledge Scope**    | Single Repository, or cross-repo within an Organization                                                                                                                     |

**Retrieval details:** [Semantic Search Agent](./modules/semantic-search.agent.md) covers chunk strategy, BM25 + embedding hybrid, query rewriting, permission filtering, and two-stage ranking in depth.

---

## 3.7 Agent-assisted Editing

| Feature                            | Description                                                                       |
| ---------------------------------- | --------------------------------------------------------------------------------- |
| **Enhance Description**            | LLM generates/improves API endpoint description based on path, method, and schema |
| **Enhance Repository Description** | LLM generates repo overview based on APIs                                         |
| **Diff Display**                   | Before applying AI suggestions, show a side-by-side diff of changes               |
| **Accept / Reject**                | User confirms or rejects each suggested change                                    |
| **Manual Override**                | User can manually edit after AI suggestions                                       |

This is a **user-triggered LLM call** — separate from the automated Business Context inference during import.

## 3.8 Permission Control

Apigent's RBAC model (defined in [2.8 RBAC Model](#28-rbac-model)) is surfaced in the Platform Webapp through the following interactions:

### 3.8.1 Organization-level Role Management

| Feature                | Description                                                                                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Role Assignment**    | When inviting a member or editing an existing member, assign an Organization role: `org_owner`, `org_admin`, or `org_member`                         |
| **Implied repo role**  | `org_owner` implicitly holds `repo_owner` on every repo of the Organization; `org_admin` implicitly holds `repo_admin`; `org_member` implies nothing |
| **Role Change**        | Organization Owner/Admin can change a member's role at any time                                                                                      |
| **Transfer Ownership** | Organization Owner can transfer ownership to another member                                                                                          |

### 3.8.2 Repository Members

| Feature                  | Description                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Where to manage**      | Repo settings → Members (`/repos/:id/settings/members`); Organization members stay on the Organization page                                 |
| **Member list**          | One table listing explicit members (editable, removable) plus Organization-implied members (read-only, labelled by source)                  |
| **Adding members**       | Pick from the Organization's members; any repository role can be granted. Requires `repo_admin`+                                            |
| **Effective permission** | **Repository row first, Organization role second** — an explicit row can therefore lock an Organization admin down to read-only on one repo |
| **New repository**       | The creator automatically becomes its `repo_owner`                                                                                          |

### 3.8.3 Access Control in Practice

| Scenario                    | Setup                                                   | Result                                                                    |
| --------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------- |
| **New Organization Member** | Invited as `org_member`                                 | Sees every repository in the directory, but can open none of them (403)   |
| **Joining one repository**  | `org_member` + `repo_member` on Repo A                  | Can edit Repo A; every other repository still 403                         |
| **Organization admin**      | `org_admin`                                             | Can open and administer every repo in the Organization except deleting it |
| **Locking one repo down**   | `org_admin` + explicit `repo_viewer` on Repo C          | Read-only on Repo C — the explicit row outranks the Organization role     |
| **MCP Access**              | `repo_admin` on Repo C + Secret Key with `mcp:*` scopes | Can use MCP tools on Repo C                                               |

## 3.9 MCP Settings

| Feature                     | Description                                                                                                            |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Enable/Disable per Repo** | Toggle MCP access for each repository                                                                                  |
| **Access Scope**            | Control which tools are exposed. V0: `search_apis` + `get_api_detail`; `get_project_context` ships with Project in V1+ |
| **Usage Monitoring**        | View MCP call count and history per key                                                                                |
| **Connection Info**         | Display MCP endpoint URL for users to configure in Cursor/Claude                                                       |

## 3.10 Secret Key Management

| Feature             | Description                                                   |
| ------------------- | ------------------------------------------------------------- |
| **Generate Key**    | Create a new API key with name and scope                      |
| **View Keys**       | List all keys with prefix, scopes, created/expiry dates       |
| **Raw Key Display** | Full key shown only once at creation (security best practice) |
| **Rotate Key**      | Generate a replacement key, deprecate the old one             |
| **Delete Key**      | Immediately revoke a key                                      |
| **Usage Tracking**  | Last used timestamp, call count                               |

Key format: `apigent_sk_<random_hex>`

---

# 4. Admin Webapp

A separate application for the operator of this deployment. Accessible only to users holding an admin role (`admin_members`), currently `admin_super` — see §2.8.5.

**Scope boundary:** the Admin Webapp is not where tenant data is managed. Organization and Repository members, roles and content are managed in the **Platform Webapp** (§3.8) — including repository members. The Admin Webapp is read-only with respect to tenant data, and its only write capability is managing who is an admin.

## 4.1 Authentication

| Feature               | Description                                                        | V0 status                                                     |
| --------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------- |
| **Admin Login**       | Separate sign-in from the Platform Webapp                          | ⏳ not implemented (V0 ships a shell with no auth)            |
| **Admin Role Check**  | Only `admin_super` holders can access (see §2.8.5)                 | ⏳ not implemented (`admin_members` table does not exist yet) |
| **Session Isolation** | Admin session is an independent cookie with its own signing secret | ⏳ not implemented                                            |

## 4.2 Dashboard & Statistics

| Metric                 | Description                                              |
| ---------------------- | -------------------------------------------------------- |
| **User Count**         | Total registered users, new registrations (daily/weekly) |
| **Organization Count** | Total organizations, active organizations                |
| **Repository Count**   | Total repos, repos with MCP enabled                      |
| **API Count**          | Total API endpoints across all repos                     |
| **MCP Usage**          | Total MCP calls, by repo, by key, time series            |
| **Active Users**       | DAU/WAU/MAU tracking                                     |

## 4.3 User Management

These are **instance-level account operations** — a different axis from Organization / Repository membership, which stays in the Platform Webapp.

| Feature             | Description                                                                   |
| ------------------- | ----------------------------------------------------------------------------- |
| **User List**       | Searchable, filterable list of all users                                      |
| **User Detail**     | Full profile, organizations, repos, activity log                              |
| **Disable Account** | Temporarily suspend a user account                                            |
| **Enable Account**  | Reactivate a disabled account                                                 |
| **Delete Account**  | Permanently remove a user and their data (with confirmation + cooling period) |

The account-lifecycle capabilities (`admin:users:disable` / `admin:users:delete`) are **reserved but not implemented in V0** — they are the natural first addition when a second admin tier (`admin_operator` / `admin_support`) is introduced.

## 4.4 Security Audit

| Feature               | Description                                                   |
| --------------------- | ------------------------------------------------------------- |
| **Operation Logs**    | Audit trail: who did what, when, from which IP                |
| **Login History**     | Per-user login records with IP and user agent                 |
| **Anomaly Detection** | Flag unusual patterns (new IP, rapid API calls, bulk export)  |
| **Key Leak Check**    | Detect Secret Keys in public repositories or exposed contexts |

---

# 5. Technical Architecture

## 5.1 Application Structure

```
apps/
├── platform/          # Platform Webapp — Next.js App Router (port 3000)
│   └── src/
│       ├── app/       # Pages + Route Handlers (src/app/api/** = the Platform REST API)
│       ├── components/ # React components
│       ├── services/  # Webapp-side glue over @apigent/server services
│       └── lib/       # Zod contracts, withRoute wrapper, logging, error handling
├── admin/             # Admin Webapp — Next.js App Router (port 3001, shell in V0)
│   └── src/
└── open/              # Open Gateway — Hono process (port 3002)
    └── src/index.ts   # `/` + `/health` today; MCP endpoint planned (V1)

packages/
├── core/              # Config (YAML + .env), DI container, shared types, i18n, agent registry
├── server/            # Domain + infrastructure, framework-agnostic:
│                      # db (Drizzle schema + migrations), openapi parser, imports, versions,
│                      # contexts, queue, auth, authz, notifications, logging, ai (AI SDK adapter)
└── ui/                # shadcn/ui components (Base UI + Tailwind v4)
```

> **Note:** this mirrors the current repo. `packages/server` is a **shared library**, not a standalone service — it has no HTTP entry point and is imported directly by the Next.js webapps (and, later, by the Hono gateway). There are no `mcp/` or `jobs/` folders yet: the MCP Gateway and BullMQ workers are designed, not implemented.

### Where does the API live?

The Platform REST API and the agent-facing MCP surface deliberately run in different runtimes:

| Surface                        | Runtime                                                                                | Why                                                                                                                                                                                                                                                              |
| ------------------------------ | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Platform REST API**          | Next.js Route Handlers (`apps/platform/src/app/api/**`) → `@apigent/server` in-process | Shares the webapp's process and deploy target: no HTTP hop, no second service to run in V0. The service layer stays framework-agnostic, so it can back any future runtime.                                                                                       |
| **Agent-facing gateway (MCP)** | Hono (`apps/open`)                                                                     | Machine-to-machine traffic has different scaling and lifetime characteristics than page rendering: deploy, scale, and monitor it independently; a long-lived process avoids the 10–60s serverless limits that LLM-backed tools such as `search_apis` can exceed. |

The original "separate the API server from Next.js" rationale still applies — but to the **gateway**, not to the webapp's REST API. `apps/open` declares `@modelcontextprotocol/sdk` and will call `@apigent/server` directly (no HTTP overhead) once the MCP endpoint is mounted in V1.

### MCP Transport

> **Status:** designed, not yet implemented. The `apps/open` Hono process currently serves `/` and `/health` only; there is no `/mcp` endpoint or tool registration yet (`@modelcontextprotocol/sdk` is a declared dependency but unused).

Apigent's MCP Gateway uses **Streamable HTTP** (2025 spec), not the older SSE-based transport:

| MCP Tool                    | Transport Pattern           | Notes                      |
| --------------------------- | --------------------------- | -------------------------- |
| `search_apis`               | Standard request → response | One HTTP POST, JSON result |
| `get_api_detail`            | Standard request → response | One HTTP POST, JSON result |
| `get_project_context` (V1+) | Standard request → response | One HTTP POST, JSON result |

All tools are **plain request-response** — no streaming, no server push, no persistent connection needed. MCP does not require SSE or long-lived connections for this use case. The separation is an **architectural choice** (independent scaling + deployment flexibility), not a protocol requirement.

## 5.2 Technology Choices

Each swappable component is defined by a **TypeScript interface** and shipped with a **default implementation**. Users can replace any component by implementing the interface and registering it via configuration. See [5.5 Extensibility Architecture](#55-extensibility-architecture) for details.

| Layer               | Default                                      | Abstraction (Interface) | Rationale                                                                                                           |
| ------------------- | -------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Webapp Frontend** | Next.js App Router, React, TypeScript        | —                       | SSR, streaming, Server Components, rich ecosystem                                                                   |
| **Webapp Styling**  | Tailwind CSS                                 | —                       | Utility-first, rapid UI development                                                                                 |
| **Platform API**    | Next.js Route Handlers + `@apigent/server`   | —                       | In-process with the Platform webapp: no HTTP hop, one deploy target in V0; services stay framework-agnostic         |
| **Open Gateway**    | Hono (TypeScript)                            | —                       | Standalone process for machine-facing traffic (MCP); multi-runtime, Web standard `Request`/`Response`               |
| **Type Bridge**     | Zod schemas + `zod-openapi`                  | —                       | Route Handlers validate with Zod; the OpenAPI 3.1 document is generated offline from the same schemas               |
| **Database**        | PostgreSQL                                   | `DatabaseAdapter`       | V0 relational store; PostgreSQL only (Drizzle pg-core schema)                                                       |
| **Vector Store**    | pgvector                                     | `VectorStore`           | In-PG vector search for V0; swap to Milvus/Qdrant/Weaviate for scale                                                |
| **ORM**             | Drizzle                                      | `DatabaseAdapter`       | SQL-first, type-safe; PostgreSQL (pg-core) for V0 — other dialects planned, not yet supported                       |
| **Async Tasks**     | Postgres queue (V0) / BullMQ + Redis (scale) | `QueueProvider`         | OpenAPI import, LLM inference, batch processing — swap to RabbitMQ/SQS via config                                   |
| **Auth**            | Credentials + HMAC-signed cookie             | `AuthProvider`          | Email + password with a stateless signed httpOnly cookie in V0; the interface is the seam for OAuth/OIDC/LDAP later |
| **LLM**             | Qwen API (Alibaba Cloud Model Studio)        | `LLMProvider`           | Structured output, function calling; swap to Claude/OpenAI/Gemini/local models                                      |
| **Embedding**       | Qwen Embedding (text-embedding-v4)           | `EmbeddingProvider`     | Semantic search embeddings; swap to Claude/OpenAI/Cohere/local embedding models                                     |
| **MCP**             | @modelcontextprotocol/sdk                    | —                       | Standard MCP implementation, Streamable HTTP transport                                                              |
| **Storage**         | Local filesystem                             | `StorageProvider`       | OpenAPI file storage; swap to S3/MinIO/Google Cloud Storage                                                         |
| **Diff**            | diff (or custom renderer)                    | —                       | Side-by-side comparison for version history and AI edits                                                            |

> **Implementation status:** LLM calls are live — product code (business-context generation, agent runtime) goes through `@apigent/server/ai` (`createAIModel()` on the Vercel AI SDK), while the DI container's `getLLM()` remains a fail-fast stub. The container registers only the `memory` vector store, `local` storage, and the Postgres queue; Embedding, pgvector, BullMQ and the MCP Gateway are defined in config/types but have no factory yet — `getEmbedding()`, `getVectorStore()` (non-`memory`), and `getQueue()` (non-`postgres`/`memory`) fail fast with `not implemented` (see `packages/core/src/di/container.test.ts`).

## 5.3 API Layer Design

```
                       ┌──────────────────────────────┐
                       │  Internal Webapps            │
                       │  (Platform / Admin)          │
                       │  Auth: Session Cookie        │
                       └──────────────┬───────────────┘
                                      │ in-process service calls
                                      │ (Next.js Route Handlers → @apigent/server)
                       ┌──────────────┴───────────────┐
                       │  External Developers / SDK   │
                       │  Auth: Bearer SecretKey      │
                       │  (api:* scopes)              │
                       └──────────────┬───────────────┘
                                      │ REST against the OpenAPI spec (surface not served yet)
                       ┌──────────────┴───────────────┐
                       │  External AI Agents          │
                       │  Auth: Bearer SecretKey      │
                       │  (mcp:* scopes)              │
                       └──────────────┬───────────────┘
                                      │ MCP (Streamable HTTP)
                                      ▼
                      Open Gateway (Hono, apps/open)
                      └── MCP Gateway (planned) → calls @apigent/server directly
                                      │
                                      ▼
                        PostgreSQL (+ pgvector / pg-fts)
```

**Three calling modes — one REST contract, three auth paths:**

| Calling Mode       | Channel                                                             | Auth                              | Type Safety                   |
| ------------------ | ------------------------------------------------------------------- | --------------------------------- | ----------------------------- |
| Internal Webapps   | Next.js Route Handlers (`withRoute`) → `@apigent/server` in-process | Session cookie (HMAC-signed)      | Shared Zod schemas + TS types |
| External OpenAPI   | REST against the exported OpenAPI spec (not served yet)             | Bearer SecretKey + `api:*` scopes | OpenAPI-generated SDK         |
| External AI Agents | MCP Gateway (Streamable HTTP, planned)                              | Bearer SecretKey + `mcp:*` scopes | MCP SDK                       |

- **One contract**: Route Handlers validate with the shared Zod schemas in `apps/platform/src/lib/openapi-schemas.ts`; the OpenAPI 3.1 document is generated from those same schemas by `zod-openapi` and written to `apps/platform/openapi/platform.json` (`pnpm openapi:platform`). Validation and documentation cannot drift.
- **Spec coverage**: the exported document currently covers the public auth and organization routes; it is not served at runtime.
- **MCP Gateway** will live in the `apps/open` Hono process; it calls `@apigent/server` directly (no HTTP overhead) and exposes a Streamable HTTP endpoint for external agents.
- **Both Webapps** are separate Next.js instances, each hosting its own pages; the Platform app also hosts the Platform REST API. `apps/open` is the only Hono process and can be scaled independently.
- **Async tasks** (OpenAPI import, Business Context LLM inference) are dispatched through the `QueueProvider` (Postgres queue by default in V0; switchable to BullMQ + Redis via `apigent.config.yaml`) and executed by dedicated workers without blocking HTTP requests (see [Async Queue module doc](./modules/async-queue.md)).

## 5.4 Auth & RBAC Implementation

### 5.4.1 Architecture Overview

Authentication (identity) and authorization (permissions) are separate concerns handled by different layers:

```
Browser Request
    │
    ▼
┌──────────────────────────────────────────────┐
│  Next.js Route Handler / Server Component      │
│                                              │
│  ┌────────────────────┐                      │
│  │ 1. Authentication  │  @apigent/server/auth│
│  │    Verify signed    │  "Who are you?"     │
│  │    session cookie   │                      │
│  └────────┬───────────┘                      │
│           │                                   │
│  ┌────────▼───────────┐                      │
│  │ 2. Authorization   │  @apigent/server/authz│
│  │    Effective role   │  "Can you do this?"  │
│  └────────┬───────────┘                      │
│           │                                   │
│  ┌────────▼───────────┐                      │
│  │ 3. Service call    │                      │
│  │    Page / API / MCP│                      │
│  └────────────────────┘                      │
└──────────────────────────────────────────────┘
```

There is **no `middleware.ts`**: authentication runs at each entry point — Route Handlers call `withRoute({ auth: true })`, which resolves the session user and returns 401 before the handler runs; authorized pages live under the `(authed)` route group whose layout calls `getSessionUser()` and redirects to `/login` when absent. Authorization is enforced in the service layer via `assertRepoAccess()` / `assertOrgRole()`. Both layers trust the same signed cookie, so there is a single source of truth for identity.

### 5.4.2 Authentication Flow (credentials + signed cookie)

V0 ships first-party credentials auth instead of NextAuth.js. Email + password is verified against the `users` table (scrypt hashing), and the session is a **stateless HMAC-SHA256 signed cookie** — no session table, no session lookup to verify the token itself.

**Token format:**

```
base64url(JSON { uid, iat, exp }) + "." + base64url(HMAC-SHA256(payload, auth.secret))
```

**Implementation (`packages/server/src/auth/`):**

```ts
// packages/server/src/auth/session.ts
export const SESSION_COOKIE = "apigent_session";

function sign(payload: string): string {
  return createHmac("sha256", getAuthConfig().secret).update(payload).digest("base64url");
}

export function createSessionToken(userId: string): string {
  /* uid + iat + exp, then sign */
}
export function verifySessionToken(token: string): SessionPayload | null {
  /* timing-safe compare */
}
```

**Configuration (`apigent.config.yaml` + `.env`):** `auth.providers: [credentials]`; the signing secret and lifetime come from `APIGENT_AUTH_SECRET` (`auth.secret`) and `auth.sessionMaxAge`. OAuth providers are not implemented — `auth.providers` is the config slot for them.

**Session payload:**

```ts
{
  uid: "user_abc123",  // user ID
  iat: 1722000000,     // issued at (seconds)
  exp: 1722600000,     // expires (config: auth.sessionMaxAge)
}
```

> **Known V0 limitation:** signing is symmetric and there is no revocation list — logging out clears the cookie client-side, but an already-issued token stays valid until `exp`. A session table or key rotation is the upgrade path if revocation becomes a requirement.

### 5.4.3 RBAC Permission Check

The core permission-checking function is called on every authorized request. It resolves a user's **effective permission** for a given resource.

**Resolution order:**

```
checkPermission → effective role

Step 1: Resolve the user's explicit membership on this repository
        └── repository_members (repositoryId, userId) → repo role (may be absent)
        └── if present it WINS — the Organization role is not consulted

Step 2: Otherwise resolve the user's role in the owning Organization
        └── organization_members.role, falling back to organizations.owner_id → org_owner
        └── org_owner  → repo_owner (implied)
        └── org_admin  → repo_admin (implied)
        └── org_member → no implied repo role

Step 3: Neither → no content access (ForbiddenError → 403)

Step 4: Compare ranks against the required minimum
        └── rank(effective) >= rank(required) → ALLOW
        └── otherwise                         → DENY (ForbiddenError → 403)
```

**Reference implementation (`packages/server/src/authz/`):**

```ts
// packages/server/src/authz/roles.ts — pure role model, no DB
export type OrgRole = "org_owner" | "org_admin" | "org_member";
export type RepoRole = "repo_owner" | "repo_admin" | "repo_member" | "repo_viewer";

const ORG_RANK = { org_member: 1, org_admin: 2, org_owner: 3 };
const REPO_RANK = { repo_viewer: 1, repo_member: 2, repo_admin: 3, repo_owner: 4 };

/** Implied repo role of an Organization role; org_member implies nothing */
export function orgRoleToRepoRole(role: OrgRole | null | undefined): RepoRole | null {
  /* owner→owner, admin→admin, member/null→null */
}

/** Effective repo role: the membership row first, the Organization role second */
export function resolveEffectiveRepoRole(
  orgRole?: OrgRole | null,
  memberRole?: RepoRole | null,
): RepoRole | null {
  return memberRole ?? orgRoleToRepoRole(orgRole);
}

export function isRepoRoleAtLeast(role: RepoRole | null, min: RepoRole): boolean {
  return !!role && REPO_RANK[role] >= REPO_RANK[min];
}
```

```ts
// packages/server/src/authz/index.ts — DB-backed checks used by Route Handlers
getUserOrgRole(userId, organizationId); // organization_members.role, owner fallback
getRepoMemberRole(userId, repositoryId); // repository_members.role
getEffectiveRepoRole(userId, repositoryId); // membership row first, Organization role second
assertRepoAccess(userId, repositoryId, min); // throws ForbiddenError → mapped to 403
assertOrgRole(userId, organizationId, min);
listAccessibleRepositoryIds(userId); // explicit memberships ∪ all repos of orgs where the user is org_admin/owner
```

**An explicit membership row wins, which means it can demote.** Setting an `org_admin` to `repo_viewer` on a single repository really does leave them read-only there. That is deliberate — it is how you lock a sensitive repo down.

**The admin scope is resolved separately.** `admin_members` is a different table and a different vocabulary (§2.8.5–2.8.7): admin capabilities are checked with `assertAdminCapability(userId, "admin:admins:manage")` and never through the tenant ladder. The two systems meet in exactly one place — the resource declaration on `withRoute` decides which of them applies to a route.

**Rank vs. permission.** Tenant capabilities are genuinely nested (`repo_viewer ⊂ repo_member ⊂ repo_admin ⊂ repo_owner`), so enforcement stays a rank comparison. The admin system is orthogonal to them, so it uses named capabilities (`admin:<domain>:<action>`, §2.8.6) instead. If a tenant requirement ever becomes non-nested — "can manage repo members but cannot activate the main version" — that is the signal to introduce a capability layer on the tenant side; the naming convention is already prepared in §2.8.2. Until then rank is simpler and cannot drift.

### 5.4.4 Authorization Enforcement (three layers)

Authorization is enforced in layers: the entry point makes it impossible to forget, the service layer states the business-level requirement, and background workers run as a system actor.

| Layer             | Where                                  | Responsibility                                                                                   |
| ----------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Entry declaration | `withRoute` options (`lib/route.ts`)   | Declares the resource a route operates on and the minimum role — no handler without a check      |
| Service assertion | `packages/server/src/authz` call sites | States the fine-grained requirement next to the operation it protects                            |
| System actor      | Queue workers (`imports` / `contexts`) | Authorization happens at **enqueue** time; workers execute as a system actor and do not re-check |

**Entry declaration** (target shape):

```ts
export const POST = withRoute(
  { auth: true, repo: { param: "id", min: "repo_member" } },
  async ({ request, params, user }) => { … },
);

{ auth: true, org:   { param: "id", min: "org_admin" } }
{ auth: true, admin: "admin:admins:manage" }
```

**Service assertion** — the same requirement stated directly, so non-HTTP callers stay covered:

```ts
await assertRepoAccess(user.id, id, "repo_member");
await assertOrgRole(user.id, organizationId, "org_admin");
```

**System actor** — a queued import was authorized when the task was created, and the worker has no request to check against, so it must not re-run a user check. Retry endpoints are HTTP-triggered and therefore **do** re-check at the entry layer.

**Pages** rely on `apps/platform/src/app/(authed)/layout.tsx` for authentication; per-resource authorization runs in the page's data loader:

```tsx
const user = await getSessionUser();
if (!user) redirect("/login");
```

Authentication is resolved once per request from the signed cookie — `withRoute` for APIs, `getSessionUser()` for pages — and is never taken from a client-supplied value. Public routes (login, register) stay open by omitting `auth: true`.

There is no `middleware.ts`: Next.js middleware cannot carry `AsyncLocalStorage` into Route Handlers, so `withRoute` opens the logging context (reqId / userId) and checks the session at the entry point.

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
│  4. Pass userId + repositoryId to     │
│     RBAC check for repo access   │
└─────────────────────────────────┘
```

### 5.4.6 Shared Auth Code Structure

Auth lives in `packages/server` (shared by every runtime), with a thin Next.js glue layer in the Platform app:

```
packages/server/src/auth/           # credentials + session primitives (runtime-agnostic)
├── index.ts                        # barrel: SESSION_COOKIE, createSessionToken, verifySessionToken, …
├── password.ts                     # hashPassword() / verifyPassword() (scrypt)
└── session.ts                      # HMAC-SHA256 signed cookie payload

packages/server/src/authz/          # RBAC
├── roles.ts                        # pure role model + rank comparison (no DB)
└── index.ts                        # assertRepoAccess(), assertOrgRole(), listAccessibleRepositoryIds()

apps/platform/src/services/auth.ts  # Next.js glue: cookies() + users table → SessionUser
apps/platform/src/lib/route.ts      # withRoute({ auth: true }) — 401 before the handler
apps/platform/src/lib/repo-guard.ts # guardRepoAccess() — entry-level repo assertion → 403
apps/platform/src/services/repo-members.ts # repo members (explicit + Organization-implied)
```

**Key design decisions:**

| Decision                                      | Rationale                                                                                                                                                                                                              |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HMAC-signed cookie (not a session table)      | Token verification needs no DB round-trip; revocation is explicitly out of scope for V0                                                                                                                                |
| httpOnly cookie (not localStorage)            | Immune to XSS; the browser sends it automatically on every request                                                                                                                                                     |
| Auth primitives in `packages/server`          | The Platform webapp and the future Hono gateway validate the same cookie with the same code                                                                                                                            |
| Entry-point enforcement (not `middleware.ts`) | Next.js middleware cannot carry `AsyncLocalStorage` into Route Handlers, so `withRoute` opens the logging context and checks the session at the entry point; authorization then runs next to the operation it protects |
| MCP uses API key (not session)                | External agents (Cursor/CLI) have no browser session; Bearer token is the standard machine-to-machine pattern                                                                                                          |

### 5.4.7 Audit Logging

Every privileged mutation writes an `operation_logs` row **in the same transaction as the mutation itself**. Otherwise a successful change could be missing from the audit trail — and that trail is the only evidence that the "admin cannot touch tenant data" boundary actually holds.

Events to record (full plan in [modules/audit-log.md](./modules/audit-log.md)):

| Event                                                                | Actor                      | Status      | Notes                                                      |
| -------------------------------------------------------------------- | -------------------------- | ----------- | ---------------------------------------------------------- |
| `member.invite` / `member.role_change` / `member.remove`             | `org_admin`+               | ✅ wired    | Organization membership                                    |
| `repo.member_add` / `repo.member_role_change` / `repo.member_remove` | `repo_admin`+ on that repo | ✅ wired    | Repository membership                                      |
| `org.transfer`                                                       | `org_owner`                | ✅ wired    | Ownership transfer                                         |
| `org.create` / `repo.create`                                         | creator                    | ✅ wired    | The creator's implicit owner row is written in the same tx |
| `admin.grant` / `admin.revoke`                                       | `admin_super`              | ⏳ pending  | The only admin write operation; lands with `admin_members` |
| `admin.login`                                                        | `admin_super`              | ⏳ optional | Platform sign-in trail                                     |
| import / activate / MCP / secret keys                                | matching `repo_*` role     | ⏳ pending  | Rest of phase A                                            |

**Landed.** `packages/server/src/audit/` exposes `recordOperation(tx, input)` — a transaction handle is required, so an audit row cannot be written outside the transaction that performs the business write — plus `withAuditTransaction(run)` and `listOperationLogs(filter)`. Two read endpoints ship with it: `GET /api/repos/:id/operations` (`repo_viewer`) and `GET /api/orgs/:id/operations` (`org_member`), rendered on `/repos/:id/settings/audit` and in the Organization detail "Activity log" tab.

`operation_logs.organizationId` is NULL for platform-level operations, and the `(organizationId, operationType, createdAt)` index does not cover those rows; migration `0001_audit_log_indexes.sql` adds a partial index (`WHERE organization_id IS NULL`) plus a `(repositoryId, createdAt)` index for the per-repository read path.

### 5.4.8 Known Gaps & Rollout Order

The model above is the target. **Already landed:**

- ✅ **Repository authorization covers every HTTP entry point** — every route that receives a `repositoryId` asserts the caller's minimum repo role at the entry layer (`apps/platform/src/lib/repo-guard.ts`: reads need `repo_viewer`, writes and imports `repo_member`, moving the default-version pointer and member management `repo_admin`). `getContextTask`, `retryContextTask`, `getImportTask` and `retryImportTask` additionally filter by `repositoryId`, because task ids are globally unique and a repo-prefix swap would otherwise expose another repository's task. Collapsing these assertions into `withRoute({ repo: … })` declarations (§5.4.4) is still open.
- ✅ **Consistent version permissions** — `activate` and `rollback` both require `repo_admin` now.
- ✅ **Repository members can be managed** — `repository_members` replaced the old `repo_permissions` override layer; the members page (`/repos/:id/settings/members`) lists explicit and Organization-implied members and supports add / change role / remove (`GET/POST /api/repos/:id/members`, `PATCH/DELETE /api/repos/:id/members/:userId`). Writes require the target to be an Organization member, and an explicit row may override downward (§2.8.4).
- ✅ **Membership changes are audited** — every membership mutation (`member.*`, `repo.member_*`, `org.transfer`) and the `org.create` / `repo.create` bootstrap write their `operation_logs` row inside the same transaction as the business write, via `recordOperation(tx, …)`; read paths are `GET /api/repos/:id/operations` and `GET /api/orgs/:id/operations` (§5.4.7). **Still open:** import detail rows (`operation_log_details`), repository edit/delete, version activate/rollback, MCP toggle, secret keys, and the `admin.*` events.

**Remaining gaps**, in the order they should be closed:

1. **`admin_members` does not exist** — the Admin Webapp has no authentication at all today: it is reachable by anyone who can reach the port.
2. **`users.is_platform_admin` is unused** — remove it when `admin_members` lands, so there is a single source of truth.
3. **Audit coverage is partial** — membership and create events are wired (§5.4.7); import, version activation, MCP, secret keys and `admin.*` are not. Import detail rows (`operation_log_details`) are still empty.
4. **Open items** — whether `admin_super` may read repository content (`admin:content:read`); whether the SecretKey issue/verify path ships before the external surfaces; whether `org:delete` / `repo:delete` / `repo:manage_mcp` get implemented (documented but not implemented in code).

Suggested order: 1 → 2 / 3 → 4.

### 5.4.9 Planned: third-party authentication (NextAuth)

V0 ships first-party credentials auth. GitHub / Google sign-in is planned, and the decision is to adopt Auth.js / NextAuth for the **authentication** part only — authorization stays in `packages/server` as described above.

| Decision                                                       | Rationale                                                                                                                                               |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NextAuth handles identity only                                 | RBAC keeps taking a `userId`, so the route handlers, `withRoute` and `authz/*` do not change                                                            |
| A new `packages/auth` hosts the shared config factory          | `packages/server` stays framework-agnostic; the Hono gateway must never depend on `next-auth`                                                           |
| Platform and Admin get separate instances, cookies and secrets | Admin is the higher-privilege surface: independent sign-out, shorter lifetime, independent rotation                                                     |
| Shared `users` table, no separate admin user store             | An admin is a platform user holding an admin role; separate identity stores break account linking                                                       |
| Keep email + password login                                    | Self-hosted deployments need a local fallback — and it is why the session stays JWT-based, since Auth.js credentials does not support database sessions |
| Roles never go into the token                                  | Authorization is resolved from the database per request, so role changes take effect immediately                                                        |

Migration cost stays contained by the `getSessionUser()` seam: swapping its implementation changes where the user id comes from, not how it is consumed.

## 5.5 Extensibility Architecture

### 5.5.1 Design Philosophy

Apigent is an **open-source, self-hosted** platform. Different teams have different infrastructure preferences — some use Milvus for vector search, some want OpenAI instead of Qwen. Rather than forcing a single stack, Apigent defines **TypeScript interfaces** for each infrastructure concern and ships with sensible defaults. Users swap implementations by changing configuration, not code.

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

| Component              | Interface           | Default                               | Common Alternatives                                                       |
| ---------------------- | ------------------- | ------------------------------------- | ------------------------------------------------------------------------- |
| **Vector Store**       | `VectorStore`       | pgvector                              | Milvus, Qdrant, Weaviate, Pinecone, Chroma                                |
| **LLM Provider**       | `LLMProvider`       | Qwen API (Alibaba Cloud Model Studio) | Claude, OpenAI, Gemini, Ollama (local), vLLM                              |
| **Embedding Provider** | `EmbeddingProvider` | Qwen Embedding (text-embedding-v4)    | Claude Embedding, OpenAI Embedding, Cohere, BGE (local)                   |
| **Storage Provider**   | `StorageProvider`   | Local filesystem                      | AWS S3, MinIO, Google Cloud Storage, Azure Blob                           |
| **Queue Provider**     | `QueueProvider`     | Postgres queue (`PgQueueProvider`)    | BullMQ + Redis, RabbitMQ, AWS SQS                                         |
| **Auth Provider**      | `AuthProvider`      | Credentials + HMAC-signed cookie      | OAuth / OIDC, LDAP, SAML, Authentik (config slot exists, not implemented) |

### 5.5.3 Vector Store Interface

```ts
// packages/core/src/interfaces/vector-store.ts

export interface VectorDocument {
  id: string;
  vector: number[];
  metadata: Record<string, unknown>;
}

export interface VectorSearchResult {
  document: VectorDocument;
  score: number;
}

export interface VectorStore {
  /** Insert or update documents with their embeddings */
  upsert(documents: VectorDocument[]): Promise<void>;

  /** Search for similar documents by vector */
  search(
    vector: number[],
    options?: {
      topK?: number;
      filter?: Record<string, unknown>;
    },
  ): Promise<VectorSearchResult[]>;

  /** Delete documents by ID */
  delete(ids: string[]): Promise<void>;

  /** Delete documents matching a filter */
  deleteByFilter(filter: Record<string, unknown>): Promise<void>;

  /** Check connection health */
  health(): Promise<boolean>;
}
```

**Default implementation — pgvector:**

```ts
// packages/vector-store-pgvector/src/pgvector-store.ts
import { VectorStore, VectorDocument, VectorSearchResult } from "@/core/interfaces";
import { sql } from "drizzle-orm";

export class PgvectorStore implements VectorStore {
  async upsert(documents: VectorDocument[]): Promise<void> {
    await this.db
      .insert(embeddings)
      .values(
        documents.map((d) => ({
          id: d.id,
          vector: sql`${JSON.stringify(d.vector)}::vector`,
          metadata: d.metadata,
        })),
      )
      .onConflictDoUpdate({
        target: embeddings.id,
        set: { vector: sql`excluded.vector`, metadata: sql`excluded.metadata` },
      });
  }

  async search(
    vector: number[],
    options?: {
      topK?: number;
      filter?: Record<string, unknown>;
    },
  ): Promise<VectorSearchResult[]> {
    const topK = options?.topK ?? 10;
    const rows = await this.db.execute(sql`
      SELECT id, metadata, 1 - (vector <=> ${JSON.stringify(vector)}::vector) AS score
      FROM embeddings
      ORDER BY vector <=> ${JSON.stringify(vector)}::vector
      LIMIT ${topK}
    `);
    return rows.map((r) => ({
      document: { id: r.id, vector: [], metadata: r.metadata },
      score: r.score,
    }));
  }

  // ... delete, deleteByFilter, health
}
```

**Example swap — Milvus:**

```ts
// User's project: my-apigent/vector-store.ts
import { VectorStore, VectorDocument, VectorSearchResult } from "apigent/core";
import { MilvusClient } from "@zilliz/milvus2-sdk-node";

export class MilvusStore implements VectorStore {
  private client: MilvusClient;

  constructor(config: { host: string; port: number; collection: string }) {
    this.client = new MilvusClient({ address: `${config.host}:${config.port}` });
  }

  async upsert(documents: VectorDocument[]): Promise<void> {
    await this.client.insert({
      collection_name: this.collection,
      data: documents.map((d) => ({
        id: d.id,
        vector: d.vector,
        metadata: JSON.stringify(d.metadata),
      })),
    });
  }

  async search(
    vector: number[],
    options?: {
      topK?: number;
      filter?: Record<string, unknown>;
    },
  ): Promise<VectorSearchResult[]> {
    const results = await this.client.search({
      collection_name: this.collection,
      vector,
      limit: options?.topK ?? 10,
    });
    return results.map((r) => ({
      document: { id: r.id, vector: [], metadata: JSON.parse(r.metadata) },
      score: r.score ?? 0,
    }));
  }

  async delete(ids: string[]): Promise<void> {
    await this.client.delete({ collection_name: this.collection, ids });
  }

  // ... deleteByFilter, health
}
```

### 5.5.4 LLM Provider Interface

```ts
// packages/core/src/interfaces/llm-provider.ts

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "text" | "json_object";
}

export interface ChatResponse {
  content: string;
  usage: { inputTokens: number; outputTokens: number };
}

export interface LLMProvider {
  /** Single-turn chat completion */
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse>;

  /** Streaming chat completion */
  chatStream(messages: ChatMessage[], options?: ChatOptions): AsyncIterable<string>;

  /** List available models */
  listModels(): Promise<string[]>;
}
```

**Default:** `QwenProvider` wraps Alibaba Cloud Model Studio (DashScope) via its OpenAI-compatible API.  
**Alternatives:** `ClaudeProvider` wraps `@anthropic-ai/sdk`, `OpenAIProvider` wraps `openai` SDK, `OllamaProvider` wraps Ollama HTTP API, `GeminiProvider` wraps `@google/generative-ai`.

### 5.5.5 Embedding Provider Interface

```ts
// packages/core/src/interfaces/embedding-provider.ts

export interface EmbeddingProvider {
  /** Generate embedding for a single text */
  embed(text: string): Promise<number[]>;

  /** Generate embeddings for multiple texts (batch) */
  embedBatch(texts: string[]): Promise<number[][]>;

  /** Dimension of the embedding vectors */
  readonly dimension: number;
}
```

This interface is separate from `LLMProvider` because:

- Some deployments use different services for chat vs. embeddings (e.g., Qwen for chat + Cohere for embeddings)
- Local embedding models (BGE, GTE) have no chat capability
- Decoupled interfaces allow independent swap

**Default:** `QwenEmbeddingProvider` using Alibaba Cloud Model Studio's `text-embedding-v4`.  
**Alternatives:** `ClaudeEmbeddingProvider`, `OpenAIEmbeddingProvider`, `CohereEmbeddingProvider`, `LocalEmbeddingProvider` (wraps FastEmbed/Transformers.js).

### 5.5.6 Storage Provider Interface

```ts
// packages/core/src/interfaces/storage-provider.ts

export interface StorageProvider {
  /** Upload a file, return its storage path */
  upload(key: string, body: Buffer | ReadableStream, contentType: string): Promise<string>;

  /** Download a file as a Buffer */
  download(key: string): Promise<Buffer>;

  /** Get a signed URL for direct access (optional) */
  getSignedUrl?(key: string, expiresInSeconds: number): Promise<string>;

  /** Delete a file */
  delete(key: string): Promise<void>;

  /** Check if a file exists */
  exists(key: string): Promise<boolean>;
}
```

**Default:** `LocalStorageProvider` stores files under `data/uploads/`.  
**Alternatives:** `S3StorageProvider`, `MinioStorageProvider`, `GCSStorageProvider`.

### 5.5.7 Queue Provider Interface

```ts
// packages/core/src/types/queue-provider.ts

export interface QueueJob {
  id?: string;
  name: string;
  data: unknown;
}

export interface QueueProvider {
  /** Enqueue a job with payload */
  enqueue(queue: string, job: QueueJob): Promise<string>;

  /** Register a handler for a queue */
  process(queue: string, handler: (job: QueueJob) => Promise<void>): Promise<void>;

  /** Gracefully shut down */
  shutdown(): Promise<void>;
}
```

The queue is responsible for **scheduling and delivery only**; business task state (progress, result, error) is persisted in business tables such as `import_tasks`, so `QueueProvider` does not expose status queries.

**Default (V0): `PgQueueProvider` — Postgres queue** (reuses the existing PostgreSQL, no Redis needed; consumption claims jobs with `FOR UPDATE SKIP LOCKED` for multi-instance safety; on restart, stale `running` jobs are marked `failed(interrupted)`).

The full design (`impl_queue_jobs` schema, worker lifecycle, config switching, async OpenAPI import tasks, in-app notifications, API contract) lives in **[Async Queue & Notifications module doc](./modules/async-queue.md)**.

### 5.5.8 Configuration System — Two-Layer Design

Apigent uses a **two-layer configuration system** designed for easy switching between dev and deployment environments:

| Layer                   | File                  | What goes here                                                                                                                               | Examples                                                           |
| ----------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **Scheme choices**      | `apigent.config.yaml` | Which provider / model / strategy to use (structured YAML, supports comments)                                                                | `llm.provider: qwen`, `rag.retrieval.retrievalMode: hybrid`        |
| **Secrets**             | `.env`                | Sensitive data only — API keys, passwords, connection strings. No provider/scheme env vars; all scheme choices live in `apigent.config.yaml` | `DASHSCOPE_API_KEY`, `APIGENT_DATABASE_URL`, `APIGENT_AUTH_SECRET` |
| **Programmatic config** | `apigent.config.ts`   | Custom provider factories, advanced wiring (**planned for V1+ — not implemented in V0**; most users only need `.yaml` + `.env`)              | Custom `VectorStore` implementation, plugin registration           |

**Default workflow — apigent.config.yaml + .env (95% of users):**

`apigent.config.yaml` (scheme choices):

```yaml
llm:
  provider: qwen
  models:
    default: qwen3.7-plus
    business_context: qwen3.7-plus
    query_rewrite: qwen3.7-flash
    rag_answer: qwen3.7-plus
    editing: qwen3.7-plus

rag:
  chunkStrategy: hierarchical
  embedding:
    provider: qwen
    model: text-embedding-v4
  vectorStore:
    provider: pgvector
    indexType: ivfflat
  searchStore:
    provider: pg-fts
  queryRewrite: true
  retrieval:
    retrievalMode: hybrid
    fusionMethod: rrf
    coarseRankTopK: 20
    fineRankTopK: 10
    reranker:
      provider: qwen
      model: qwen3-rerank
  knowledgeGraph:
    enabled: false
```

`.env` (secrets only):

```bash
DASHSCOPE_API_KEY=sk-your-dashscope-key-here
APIGENT_DATABASE_URL=postgresql://localhost:5433/apigent
APIGENT_AUTH_SECRET=your-secret-here
```

The config loader reads YAML + .env and constructs a fully-typed `ApigentConfig`:

```ts
import { loadConfig } from "@apigent/core/config";

const config = loadConfig();
// → reads apigent.config.yaml + .env → ApigentConfig
```

**Advanced workflow — apigent.config.ts (custom providers):**

> ⚠️ **Status: planned (V1+).** `loadConfig()` currently reads only `apigent.config.yaml` + `.env`, and `ApigentConfig` fields are plain data, not factories. The example below describes the target design.

For custom provider implementations, `apigent.config.ts` adds programmatic overrides on top of YAML + env:

```ts
// apigent.config.ts
import type { ApigentConfig } from "@apigent/core";
import { loadConfig } from "@apigent/core/config";
import { MyCustomVectorStore } from "./my-vector-store";

const base = loadConfig();

const config: ApigentConfig = {
  ...base,
  rag: {
    ...base.rag,
    vectorStore: () => new MyCustomVectorStore({/* ... */}),
  },
};

export default config;
```

**Swap example — dev (Qwen + pgvector) → production (OpenAI + Milvus):**

No code change needed. Just use different files per environment:

```yaml
# apigent.config.prod.yaml
llm:
  provider: openai
  models:
    default: gpt-4o
    query_rewrite: gpt-4o-mini

rag:
  embedding:
    provider: openai
    model: text-embedding-3-small
  vectorStore:
    provider: milvus
    host: milvus-prod.internal
    port: 19530
  searchStore:
    provider: pg-fts
  retrieval:
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
import type { ApigentConfig } from "./config";

export class Container {
  private instances = new Map<string, unknown>();

  constructor(private config: ApigentConfig) {}

  getVectorStore(): VectorStore {
    if (!this.instances.has("vectorStore")) {
      this.instances.set("vectorStore", this.config.rag.vectorStore());
    }
    return this.instances.get("vectorStore") as VectorStore;
  }

  getLLM(): LLMProvider {
    /* ... */
  }
  getEmbedding(): EmbeddingProvider {
    /* ... */
  }
  getStorage(): StorageProvider {
    /* ... */
  }
  getQueue(): QueueProvider {
    /* ... */
  }
}

// Singleton — initialized once at app startup
let container: Container;

export function initContainer(config: ApigentConfig) {
  container = new Container(config);
}

export function getContainer(): Container {
  if (!container) throw new Error("Container not initialized");
  return container;
}
```

Business code never imports a concrete implementation directly:

```ts
// ✅ GOOD — uses interface, works with any implementation
import { getContainer } from "@/core/container";

async function searchApis(query: string) {
  const vectorStore = getContainer().getVectorStore();
  const embeddingProvider = getContainer().getEmbedding();
  const queryVector = await embeddingProvider.embed(query);
  return vectorStore.search(queryVector, { topK: 10 });
}

// ❌ BAD — hardcoded dependency, can't swap
import { PgvectorStore } from "@apigent/vector-store-pgvector";
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
  name: string;
  version: string;
  /** Called when the plugin is registered */
  register(ctx: PluginContext): void | Promise<void>;
  /** Called when the plugin is unregistered */
  unregister?(): void | Promise<void>;
}

export interface PluginContext {
  container: Container;
  logger: Logger;
  /** Register a hook into the platform lifecycle */
  onHook(hook: string, handler: (...args: any[]) => Promise<void>): void;
}
```

Plugins register via `apigent.config.ts`:

```ts
const config: ApigentConfig = {
  // ... core config
  plugins: ["./plugins/custom-notification", "./plugins/custom-ai-rule"],
};
```

---

# 6. V0 Scope

Consolidating from the blueprint roadmap, V0 covers the minimal usable product:

| Area             | V0 Features                                                                                                                      |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Auth**         | Email login/register, session management                                                                                         |
| **Organization** | Create organization, invite members, basic roles                                                                                 |
| **Repository**   | Create repo, import OpenAPI (file/URL), version list                                                                             |
| **Versioning**   | Version branches, commits (snapshots), rollback, diff — implemented ahead of the original V1 plan                                |
| **Browsing**     | Endpoint list (grouped by tag), model list, semantic search (natural language)                                                   |
| **Core Engine**  | OpenAPI Parser → Business Context Agent (capability context; Knowledge Graph is a V1+ optional enhancement, disabled by default) |
| **Secret Keys**  | Generate, list, delete keys                                                                                                      |
| **Dashboard**    | Simple repo list + recent activity                                                                                               |
| **Project**      | Model defined in the domain model only; no features in V0                                                                        |

> **Scope note:** MCP Gateway 挂载与 **Admin Webapp 完整功能**均移至 **V1**（V0 聚焦 Platform Webapp）：外部 Agent 接入（`search_apis` / `get_api_detail`）随 V1 提供，`get_project_context` 仍随 Project 在 V1+；Admin 在 V0 仅保留壳。

---

# 7. Async Tasks & Notifications

Async OpenAPI import, in-app notifications, and queue implementations (`import_tasks` / `notifications` / `impl_queue_jobs`, state machine, API contract, frontend presentation, implementation order) have been split into a dedicated module doc:

👉 **[Async Queue & Notifications module doc](./modules/async-queue.md)**
