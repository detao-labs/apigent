"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";
import { SidebarMenuButton } from "@apigent/ui";

/** 退出 Admin 会话（只清 admin cookie，不影响 Platform 的登录状态）。 */
export function LogoutButton() {
  const router = useRouter();
  const t = useTranslations("nav");

  async function logout() {
    await signOut({ redirect: false }).catch(() => null);
    router.push("/login");
    router.refresh();
  }

  return (
    <SidebarMenuButton size="sm" onClick={logout} tooltip={t("logout")}>
      <LogOut className="size-4" />
      <span>{t("logout")}</span>
    </SidebarMenuButton>
  );
}
