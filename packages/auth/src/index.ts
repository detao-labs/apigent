// ═══════════════════════════════════════════════════════════════════
// Apigent Auth — Auth.js (NextAuth v5) 共享配置
// ═══════════════════════════════════════════════════════════════════
//
// 只有 Next.js 应用依赖这个包；`packages/server` 保持与框架无关，
// Hono 网关永不依赖 next-auth（docs/tech-design.md §5.4.9）。

export {
  createAuthConfig,
  resolveAuthSecret,
  resolveSessionMaxAge,
  type CreateAuthConfigOptions,
} from "./config";
export {
  AUTH_SCOPES,
  authCookieNames,
  type AuthCookieNames,
  type AuthScope,
} from "./cookies";
