import { NextResponse } from "next/server";
import { SecretKeyError, issueSecretKey } from "@apigent/server/keys";
import { withRoute } from "@/lib/route";

interface IssueBody {
  name?: unknown;
  scopes?: unknown;
  repositoryIds?: unknown;
  expiresInDays?: unknown;
}

/**
 * 签发 API 密钥。POST /api/keys
 *
 * 明文密钥只在这次响应里返回一次；列表接口永远只给前缀。
 * 只能签发自己的密钥——userId 取自会话，不接受请求体传入。
 */
export const POST = withRoute({ auth: true }, async ({ request, user }) => {
  let body: IssueBody;
  try {
    body = (await request.json()) as IssueBody;
  } catch {
    return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name : "";
  const scopes = Array.isArray(body.scopes)
    ? body.scopes.filter((s): s is string => typeof s === "string")
    : [];
  const days = typeof body.expiresInDays === "number" ? body.expiresInDays : null;
  const expiresAt = days && days > 0 ? new Date(Date.now() + days * 24 * 60 * 60 * 1000) : null;
  const repositoryIds = Array.isArray(body.repositoryIds)
    ? body.repositoryIds.filter((id): id is string => typeof id === "string")
    : [];

  try {
    const issued = await issueSecretKey({
      userId: user.id,
      name,
      scopes,
      repositoryIds,
      expiresAt,
    });
    return NextResponse.json(issued, { status: 201 });
  } catch (err) {
    if (err instanceof SecretKeyError) {
      return NextResponse.json({ error: err.code }, { status: 400 });
    }
    console.error("[keys POST]", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
});
