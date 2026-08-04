# Apigent Blueprint

> 🌐 Language: [English](./blueprint.md) | [中文](./blueprint.zh.md)

**Apigent**, pronounced /ˈeɪ.pi.dʒənt/, is short for "API for Agent".

---

# 1. Project Overview

## 1.1 Project Name

- Name: **Apigent**
- Repository: `detao-labs/apigent`
- License: MIT

## 1.2 One-line Description

> An API platform that annotates APIs with business context and semantic knowledge, then exposes them to AI Agents through MCP — so agents can discover, understand, and invoke the right API at the right time.

## 1.3 Vision

Traditional API platforms were built for human developers reading documentation. In the Agent-native era, APIs need to be machine-understandable — with business meaning, usage constraints, and semantic relationships that AI Agents can reason about.

Apigent builds that knowledge layer, so every API in an organization becomes a discoverable, composable capability that both developers and agents can use.

## 1.4 Core Concept

```
API Spec (OpenAPI)           ← 技术契约
Business Knowledge           ← 业务含义 + 使用规则 + 关联关系
Usage Insights               ← 示例 + 实际使用数据
        |
        v
Apigent Knowledge Layer
        |
        +-------------------+
        |                   |
   Developers          AI Agents
```

---

# 2. Product Positioning

## 2.1 Problem

Current API tools mainly solve:

- API documentation
- API testing
- Team collaboration

However, AI Agents require more than schemas:

- What does this API mean?
- When should this API be used?
- What business rules apply?
- What APIs should be called next?

Existing API documentation lacks structured business knowledge for AI consumption.

---

## 2.2 Solution

Apigent provides:

- API asset management
- Business context management
- Semantic API search
- MCP-based Agent access
- AI-assisted API understanding

Transform APIs from static documentation into Agent-readable capabilities.

---

# 3. Core Principles

## 3.1 Agent First

All API assets should be understandable and accessible by AI Agents.

## 3.2 Knowledge Over Schema

OpenAPI describes technical contracts.

Apigent adds:

- Business meaning
- Usage scenarios
- Constraints
- Relationships

## 3.3 One Source of Truth

The same API knowledge should serve:

- Developers
- AI coding agents
- Internal tools

---

# 4. Technical Architecture

## 4.1 High-level Architecture

```
                 AI Agents
            Cursor / Claude / Others
                       |
                       |
                  MCP Server
                       |
                       |
              Apigent Core Platform
                       |
        --------------------------------
        |              |               |
     API Model     Knowledge       RAG Layer
                    Layer
        |
   PostgreSQL
```

---

## 4.2 Technology Stack

### Frontend / Full-stack

- Next.js App Router
- TypeScript
- React

Reasons:

- Full-stack development experience
- Unified frontend/backend architecture
- Native streaming support
- Strong TypeScript ecosystem

---

### Data Layer

Primary:

- PostgreSQL

Optional:

- Vector database

Purpose:

- API semantic retrieval
- Business context indexing
- Agent knowledge search

---

### AI Layer

Capabilities:

- RAG retrieval
- MCP Server
- AI-assisted documentation
- API understanding

---

# 5. Core Domain Model

## 5.1 Organization

Represents the top-level tenant boundary — a company, team, or business unit.

- Organization members with org-level roles (`org_owner` / `org_admin` / `org_member`)
- Repositories belong to an Organization
- Flat by default (no nested Organizations)

## 5.2 Repository

Represents the technical asset container for **one OpenAPI file** and its version history.

- Owned by exactly one Organization
- Holds OpenAPI specs, imported versions, and parsed API technical models (method/path/schema)
- The smallest unit of permission filtering (`repo:*` permissions)
- Repository is the technical layer only — business knowledge lives in Project

## 5.3 Project

Represents the business layer — an API service or business system.

Example:

```
E-commerce Order System
```

- An independent entity: **not attached to an Organization**
- Aggregates one or more Repositories (many-to-many), possibly across Organizations
- Contains project basic info, business context, domain glossary, conventions, and project members/roles (`project_owner` / `project_admin` / `project_viewer`)
- V0 defines the model only; Project features ship in V1+

---

## 5.4 API

Represents an individual API capability.

Contains:

- HTTP method
- Path
- Request schema
- Response schema
- Business description
- Usage rules
- Examples
- Version history

Example:

```
POST /orders/refund
```

Business Context:

```
Refund can only be requested
for paid orders within 7 days.
```

---

## 5.5 API Relationship

Defines API dependency and workflow.

Examples:

```
Create Order
      |
      v
Payment
      |
      v
Order Confirmation
```

Relationship types:

- depends_on
- follow_up
- alternative
- related

---

# 6. MCP Capability Design

Apigent provides MCP tools for external AI Agents.

## 6.1 API Search

Purpose:

Semantic API discovery.

Example:

```
Find APIs related to user refund
```

---

## 6.2 API Detail Query

Purpose:

Retrieve complete API knowledge.

Returns:

- Schema
- Business rules
- Examples
- Related APIs

---

## 6.3 Project Context Query

Purpose:

Retrieve global project knowledge.

Includes:

- Authentication rules
- Domain concepts
- Common response formats

---

# 7. Development Roadmap

## V0 - API Knowledge Foundation

Goal:

Build the minimum Agent-native API knowledge platform.

Features:

- Organization / Repository management
- API management
- OpenAPI import/export
- Business context
- MCP Server
- Semantic search
- Basic AI assistance

> Note: The Project entity is defined in the domain model (see 5.3) but not implemented in V0.

---

## V1 - AI-powered API Engineering

Features:

- Project management (business info, members, cross-Repository aggregation)
- AI API generation
- AI documentation improvement
- API change analysis
- Smart Mock generation
- API knowledge assistant


---

## V2 - Agent Engineering Platform

Features:

- API workflow discovery
- Code generation
- Advanced MCP tools
- Agent observability
- API governance


---

# 8. Non-goals

To avoid becoming another traditional API platform:

Not the primary focus:

- API testing platform
- Full Mock platform
- Enterprise permission system
- Complex API gateway

Apigent focuses on:

> Making APIs understandable and usable by AI Agents.

---

# 9. Success Metrics

Early stage:

- Developers can connect Cursor/Claude through MCP
- Agents can correctly discover APIs
- Agents can generate API integration code
- API context retrieval is accurate

Long-term:

Apigent becomes the knowledge layer between software systems and AI Agents.

---

# 10. Open Source Strategy

## Community Focus

Target users:

- AI application developers
- Full-stack developers
- Platform engineers
- Agent Engineering practitioners


## Ecosystem Direction

Potential packages:

```
@apigent/core
@apigent/mcp-server
@apigent/sdk
@apigent/openapi-parser
```

---

# 11. Summary

Apigent is not an API documentation replacement.

It treats APIs as knowledge assets — not just endpoint specs — so that developers and AI Agents share the same understanding of what each API does and how to use it.

Its mission:

> Make every API understandable, discoverable, and usable by AI Agents.
