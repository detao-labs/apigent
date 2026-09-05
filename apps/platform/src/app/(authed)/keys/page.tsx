import { redirect } from "next/navigation";

/** API 密钥已并入设置页（/settings/keys），保留旧路由做重定向。 */
export default function KeysPage() {
  redirect("/settings/keys");
}
