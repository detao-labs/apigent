// ═══════════════════════════════════════════════════════════════════
// Short ID Generator — entity prefix + 10-char base62
// ═══════════════════════════════════════════════════════════════════
//
// IDs look like: org_Xk9mQ2zA7b, repo_8fHk2xN9qL, api_2hBvN8sRcM
// - 10 base62 chars ≈ 8.4e17 combinations per prefix, safe for
//   anything short of internet-scale traffic.
// - Alphabet excludes confusing characters (0/O/1/I/l).
// - Prefix identifies the entity type (Stripe-style) and scopes the
//   collision space per entity, so same-code-different-prefix is fine.
//
// 约定：所有新的实体/身份字段 ID（含 reqId 等请求级、任务级 id）一律
// 用 generateId(prefix) + ID_PREFIXES 生成，保持 `前缀_10位` 的统一格式。

import { customAlphabet } from "nanoid";

const ALPHABET = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const LENGTH = 10;

const generate = customAlphabet(ALPHABET, LENGTH);

export const ID_PREFIXES = {
  user: "usr_",
  org: "org_",
  repo: "repo_",
  version: "ver_",
  commit: "cmt_",
  endpoint: "api_",
  dataModel: "data_",
  module: "mod_",
  secretKey: "key_",
  member: "mem_",
  permission: "perm_",
  response: "rsp_",
  component: "comp_",
  context: "ctx_",
  relationship: "rel_",
  chunk: "chunk_",
  msg: "msg_",
  log: "log_",
  logDetail: "logd_",
  job: "job_",
  task: "task_",
  req: "req_",
  notification: "noti_",
} as const;

/** Generate a short ID with the given entity prefix, e.g. generateId("org") → "org_Xk9mQ2zA7b". */
export function generateId(prefix: keyof typeof ID_PREFIXES): string {
  return `${ID_PREFIXES[prefix]}${generate()}`;
}

/** Matches generated IDs: lowercase prefix + underscore + 10 base62 chars. */
export const SHORT_ID_RE = /^[a-z]{2,6}_[0-9A-Za-z]{10}$/;

export function isShortId(value: unknown): value is string {
  return typeof value === "string" && SHORT_ID_RE.test(value);
}
