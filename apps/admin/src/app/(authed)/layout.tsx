import { SidebarInset, SidebarProvider, TooltipProvider } from "@apigent/ui";
import { AppSidebar } from "@/components/app-sidebar";
import { Toaster } from "@/components/sonner";
import { requireAdmin } from "@/services/auth";

/**
 * 已登录区的布局与门禁。
 *
 * 所有需要管理员身份的路由都放在 (authed) 下——门禁写在布局里，新增页面默认
 * 受保护，不会因为忘记加守卫而裸奔。
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar admin={admin} />
        <SidebarInset>
          <main className="p-6">{children}</main>
        </SidebarInset>
      </SidebarProvider>
      <Toaster />
    </TooltipProvider>
  );
}
