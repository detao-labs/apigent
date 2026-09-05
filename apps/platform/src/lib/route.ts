// ═══════════════════════════════════════════════════════════════════
// withRoute — 高阶 API Route 封装
// ═══════════════════════════════════════════════════════════════════
//
// 目的：消除每个 route 的样板：
//   - 自动生成 reqId 并进入日志上下文（AsyncLocalStorage）；
//   - 可选 auth: true 自动读 session（getSessionUser），未登录返回 401，
//     并把 userId 注入日志上下文；
//   - handler 只关心业务，签名统一为 ({ request, params, user })。
//
// 用法：
//   export const POST = withRoute({ auth: true }, async ({ request, params, user }) => { ... });
//   export const GET = withRoute(async ({ params }) => { ... });   // 无需登录
//
// 说明：Next.js 的 middleware/proxy 无法让 AsyncLocalStorage 贯穿到
// route handler（两者是独立异步根），因此 reqId 必须在 route 入口设置。
// ═══════════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { getSessionUser } from "@/services/auth";
import {
  getLoggingContext,
  newRequestId,
  runWithLoggingContext,
  type LoggingContext,
} from "@/lib/logger";

export type RouteParams = Record<string, string>;

export interface RouteContext<
  T extends RouteParams = RouteParams,
  U extends { id: string } | null = { id: string } | null,
> {
  request: Request;
  params: Promise<T>;
  user: U;
}

export type RouteHandler<
  T extends RouteParams = RouteParams,
  U extends { id: string } | null = { id: string } | null,
> = (ctx: RouteContext<T, U>) => Promise<Response>;

export type RouteFn = (
  request: Request,
  ctx: { params: Promise<RouteParams> },
) => Promise<Response>;

interface WithRouteOptions {
  auth?: boolean;
}

// 重载：auth: true 时 user 非空；auth: false / 未给时 user 可能为 null。
export function withRoute(
  options: { auth: true },
  handler: RouteHandler<RouteParams, { id: string }>,
): RouteFn;
export function withRoute(options: WithRouteOptions, handler: RouteHandler<RouteParams>): RouteFn;
export function withRoute(handler: RouteHandler<RouteParams>): RouteFn;
export function withRoute<U extends { id: string } | null = { id: string } | null>(
  optionsOrHandler: WithRouteOptions | RouteHandler<RouteParams, U>,
  handler?: RouteHandler<RouteParams, U>,
): RouteFn {
  const isOptions = typeof optionsOrHandler === "object" && optionsOrHandler !== null;
  const options: WithRouteOptions = isOptions ? (optionsOrHandler as WithRouteOptions) : {};
  const routeHandler = (isOptions ? handler : optionsOrHandler) as RouteHandler<
    RouteParams,
    { id: string } | null
  >;

  return async (request: Request, ctx: { params: Promise<RouteParams> }) => {
    const base = getLoggingContext();
    const logCtx: LoggingContext = { ...base, reqId: base.reqId ?? newRequestId() };

    return runWithLoggingContext(logCtx, async () => {
      let user: { id: string } | null = null;
      if (options.auth) {
        const authed = await getSessionUser();
        if (!authed) {
          return NextResponse.json({ error: "unauthorized" }, { status: 401 });
        }
        user = authed;
        // mutate 同一 logCtx 引用，使之后（含 server service 内）的日志带上 userId
        logCtx.userId = authed.id;
      }
      return routeHandler({ request, params: ctx.params, user });
    });
  };
}
