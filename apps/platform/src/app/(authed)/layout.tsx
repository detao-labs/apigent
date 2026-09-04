import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SidebarInset, SidebarProvider, TooltipProvider } from "@apigent/ui";
import { AppHeader } from "@/components/app-header";
import { AppSidebar } from "@/components/app-sidebar";
import { AssistantDrawer } from "@/components/assistant-drawer";
import { BusinessContextDialog } from "@/components/business-context-dialog";
import { DatabaseDownRedirect } from "@/components/error-page";
import { Toaster } from "@/components/sonner";
import { detectDatabaseIssue } from "@/lib/error-detection";
import { getSessionUser } from "@/services/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let user;
  try {
    user = await getSessionUser();
  } catch (err) {
    // 数据库不可用时，所有已登录页面都会在这里失败——确定性兜底，
    // 跳转到独立 /500 页（生产环境 error.message 会被脱敏，不能依赖它）。
    const issue = detectDatabaseIssue(err);
    if (issue) {
      console.error("[auth] database unavailable", err);
      return <DatabaseDownRedirect issue={issue} />;
    }
    throw err;
  }
  if (!user) redirect("/login");

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <AppHeader user={user} />
          <main className="flex-1">{children}</main>
          <Suspense fallback={null}>
            <BusinessContextDialog />
          </Suspense>
          <Suspense fallback={null}>
            <AssistantDrawer />
          </Suspense>
        </SidebarInset>
      </SidebarProvider>
      <Toaster />
    </TooltipProvider>
  );
}
