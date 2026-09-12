import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: { id: string } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    /** 用户 id；平台角色绝不放进 token，每请求现查 admin_members */
    uid?: string;
  }
}
