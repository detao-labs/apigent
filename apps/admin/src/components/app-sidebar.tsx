"use client";

import {
  LocaleSwitcher,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@apigent/ui";
import { LayoutDashboard, Users, ShieldCheck, Settings, UserCog } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { LogoutButton } from "@/components/logout-button";
import type { AdminSessionUser } from "@/services/auth";

export function AppSidebar({ admin }: { admin: AdminSessionUser }) {
  const pathname = usePathname();
  const t = useTranslations("nav");

  const navItems = [
    { title: t("dashboard"), url: "/", icon: LayoutDashboard },
    { title: t("users"), url: "/users", icon: Users },
    { title: t("auditLog"), url: "/audit", icon: ShieldCheck },
    { title: t("admins"), url: "/admins", icon: UserCog },
    { title: t("settings"), url: "/settings", icon: Settings },
  ];

  const isActive = (url: string) =>
    pathname === url || (url !== "/" && pathname.startsWith(`${url}/`));

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <Link href="/" className="flex items-center gap-3 px-3 py-2">
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <ShieldCheck className="size-4" />
              </div>
              <div className="flex flex-col gap-0.5 leading-none">
                <span className="font-semibold">Apigent</span>
                <span className="text-xs text-muted-foreground">{t("brandSubtitle")}</span>
              </div>
            </Link>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{t("adminGroup")}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton isActive={isActive(item.url)} tooltip={item.title}>
                    <Link href={item.url} className="flex items-center gap-2 w-full">
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <LocaleSwitcher />
          </SidebarMenuItem>
          <SidebarMenuItem>
            <div className="flex flex-col gap-0.5 px-3 py-2">
              <span className="truncate text-sm font-medium">{admin.name}</span>
              <span className="truncate text-xs text-muted-foreground">{admin.email}</span>
              <span className="text-xs text-muted-foreground">
                {t(admin.role === "admin_super" ? "roleSuper" : "adminFooter")}
              </span>
            </div>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <LogoutButton />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
