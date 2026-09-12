// ═══════════════════════════════════════════════════════════════════
// Secret Keys — API / MCP 密钥的签发、列表、吊销
// ═══════════════════════════════════════════════════════════════════
//
// key 归属于**用户**（`secret_keys.user_id`），因此这里是自助语义：只能签发、
// 查看、吊销自己的 key。
//
// **校验不在这里。** 调用方是机器客户端（Cursor / CLI），打的是 MCP Gateway 与
// 未来的外部 REST，它们不走浏览器会话。`verifySecretKey()` 与它的第一个调用方
// （网关端点）一起落地，见 docs/tech-design.md §3.10。
//
// 存储：只存 SHA-256 哈希（API key 是高熵随机串，不需要 scrypt 那种慢哈希），
// 明文只在签发响应里返回**一次**。
// ═══════════════════════════════════════════════════════════════════

import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { getDB, organizations, repositories, secretKeys } from "../db";
import { generateId } from "../id";
import { listAccessibleRepositoryIds } from "../authz";

/** 密钥前缀，同时是识别标志；`key_prefix` 列宽 20。 */
export const SECRET_KEY_PREFIX = "apigent_sk_";
/** 展示用的前缀长度：`apigent_sk_` + 8 位随机字符。 */
const KEY_PREFIX_LENGTH = SECRET_KEY_PREFIX.length + 8;

/** 允许的权限范围（docs/tech-design.md §2.7）。 */
export const KEY_SCOPES = [
  "api:read",
  "api:write",
  "mcp:search",
  "mcp:detail",
  "mcp:context",
] as const;

export type KeyScope = (typeof KEY_SCOPES)[number];

export function isKeyScope(value: unknown): value is KeyScope {
  return typeof value === "string" && (KEY_SCOPES as readonly string[]).includes(value);
}

export class SecretKeyError extends Error {
  constructor(
    public readonly code: "invalid-name" | "invalid-scopes" | "invalid-repositories" | "not-found",
  ) {
    super(code);
    this.name = "SecretKeyError";
  }
}

export interface SecretKeySummary {
  id: string;
  name: string;
  /** 形如 `apigent_sk_ab12cd34`，用于识别与排错（不是密钥本身） */
  keyPrefix: string;
  scopes: KeyScope[];
  /** 仓库白名单；空数组 = 不限制（沿用用户全部可访问仓库） */
  repositoryIds: string[];
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
}

export interface IssuedSecretKey {
  key: SecretKeySummary;
  /** 明文密钥，仅此一次返回 */
  rawKey: string;
}

function hashKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

/**
 * 校验仓库白名单：每个 id 都必须是调用者**当前可访问**的仓库。
 *
 * 这条在服务端做，不信前端。key 只能收窄用户已有的权限，永远不能放大——所以
 * "选了一个自己没权限的仓库"必须直接拒绝，而不是存下去等校验时再挡。
 * 返回去重后的 id 列表。
 */
async function assertRepositoriesSelectable(
  userId: string,
  repositoryIds: string[],
): Promise<string[]> {
  const unique = [...new Set(repositoryIds.filter((id) => typeof id === "string" && id !== ""))];
  if (unique.length === 0) return [];

  const accessible = new Set(await listAccessibleRepositoryIds(userId));
  const unknown = unique.filter((id) => !accessible.has(id));
  if (unknown.length > 0) throw new SecretKeyError("invalid-repositories");
  return unique;
}

export interface SelectableRepository {
  id: string;
  name: string;
  organizationId: string;
  organizationName: string;
}

/**
 * 当前用户**有权访问**的仓库（含所属组织名），供签发 / 编辑密钥时勾选。
 *
 * 注意不能用 Platform 的 `listRepos()`——那个是**全站目录**（所有登录用户都能
 * 看到仓库名），这里要的是"我能打开内容的仓库"。
 */
export async function listSelectableRepositories(userId: string): Promise<SelectableRepository[]> {
  const ids = await listAccessibleRepositoryIds(userId);
  if (ids.length === 0) return [];

  return getDB()
    .select({
      id: repositories.id,
      name: repositories.name,
      organizationId: repositories.organizationId,
      organizationName: organizations.name,
    })
    .from(repositories)
    .innerJoin(organizations, eq(organizations.id, repositories.organizationId))
    .where(inArray(repositories.id, ids))
    .orderBy(organizations.name, repositories.name);
}

/** 生成一把新密钥：`apigent_sk_` + 48 位十六进制（24 字节随机）。 */
export function generateRawKey(): string {
  return `${SECRET_KEY_PREFIX}${randomBytes(24).toString("hex")}`;
}

function toSummary(row: {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[] | null;
  repositoryIds: string[];
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
}): SecretKeySummary {
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.keyPrefix,
    // 读库时把 text[] 收窄回合法 scope；不认识的值直接丢掉而不是原样透给前端
    scopes: (row.scopes ?? []).filter(isKeyScope),
    repositoryIds: row.repositoryIds ?? [],
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}

export interface IssueSecretKeyInput {
  userId: string;
  name: string;
  scopes: string[];
  /** 仓库白名单；空数组 = 不限制 */
  repositoryIds?: string[];
  expiresAt?: Date | null;
}

export async function issueSecretKey(input: IssueSecretKeyInput): Promise<IssuedSecretKey> {
  const name = input.name.trim();
  if (name.length === 0 || name.length > 100) throw new SecretKeyError("invalid-name");

  const scopes = input.scopes.filter(isKeyScope);
  if (scopes.length === 0) throw new SecretKeyError("invalid-scopes");

  const repositoryIds = await assertRepositoriesSelectable(input.userId, input.repositoryIds ?? []);

  const rawKey = generateRawKey();
  const id = generateId("secretKey");

  const [row] = await getDB()
    .insert(secretKeys)
    .values({
      id,
      userId: input.userId,
      name,
      keyHash: hashKey(rawKey),
      keyPrefix: rawKey.slice(0, KEY_PREFIX_LENGTH),
      scopes,
      repositoryIds,
      expiresAt: input.expiresAt ?? null,
    })
    .returning({
      id: secretKeys.id,
      name: secretKeys.name,
      keyPrefix: secretKeys.keyPrefix,
      scopes: secretKeys.scopes,
      repositoryIds: secretKeys.repositoryIds,
      lastUsedAt: secretKeys.lastUsedAt,
      expiresAt: secretKeys.expiresAt,
      createdAt: secretKeys.createdAt,
    });

  if (!row) throw new Error("Failed to issue secret key");
  return { key: toSummary(row), rawKey };
}

/** 当前用户的有效密钥（已吊销的不列）。 */
export async function listSecretKeys(userId: string): Promise<SecretKeySummary[]> {
  const rows = await getDB()
    .select({
      id: secretKeys.id,
      name: secretKeys.name,
      keyPrefix: secretKeys.keyPrefix,
      scopes: secretKeys.scopes,
      repositoryIds: secretKeys.repositoryIds,
      lastUsedAt: secretKeys.lastUsedAt,
      expiresAt: secretKeys.expiresAt,
      createdAt: secretKeys.createdAt,
    })
    .from(secretKeys)
    .where(and(eq(secretKeys.userId, userId), isNull(secretKeys.revokedAt)))
    .orderBy(desc(secretKeys.createdAt));

  return rows.map(toSummary);
}

/**
 * 吊销密钥（软删除：写 `revoked_at`，不删行，便于排查"这把 key 何时被谁停用"）。
 * 返回是否命中——不命中表示不存在或不属于调用者，两种情况对外都是 404。
 */
export async function revokeSecretKey(input: { userId: string; keyId: string }): Promise<boolean> {
  const result = await getDB()
    .update(secretKeys)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(secretKeys.id, input.keyId),
        eq(secretKeys.userId, input.userId),
        isNull(secretKeys.revokedAt),
      ),
    );
  return (result.rowCount ?? 0) > 0;
}

/**
 * 修改密钥的仓库白名单。
 *
 * 之所以需要它：仓库是选择单位，组织里新增仓库时不在白名单内。没有编辑就只能
 * "吊销 + 重新签发"，而那意味着换一把明文密钥、重新分发到 agent 里——对"只是
 * 想让它多看一个仓库"来说代价太大。
 *
 * 只能改自己的、且未被吊销的 key；白名单同样必须是自己可访问的仓库。
 */
export async function updateSecretKeyScope(input: {
  userId: string;
  keyId: string;
  repositoryIds: string[];
}): Promise<SecretKeySummary | null> {
  const repositoryIds = await assertRepositoriesSelectable(input.userId, input.repositoryIds);

  const [row] = await getDB()
    .update(secretKeys)
    .set({ repositoryIds })
    .where(
      and(
        eq(secretKeys.id, input.keyId),
        eq(secretKeys.userId, input.userId),
        isNull(secretKeys.revokedAt),
      ),
    )
    .returning({
      id: secretKeys.id,
      name: secretKeys.name,
      keyPrefix: secretKeys.keyPrefix,
      scopes: secretKeys.scopes,
      repositoryIds: secretKeys.repositoryIds,
      lastUsedAt: secretKeys.lastUsedAt,
      expiresAt: secretKeys.expiresAt,
      createdAt: secretKeys.createdAt,
    });

  return row ? toSummary(row) : null;
}
