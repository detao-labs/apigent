import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SidebarInset, SidebarProvider, TooltipProvider } from "@apigent/ui";
import { AppHeader } from "@/components/app-header";
import { AppSidebar } from "@/components/app-sidebar";
import { BusinessContextDialog } from "@/components/business-context-dialog";
import { getSessionUser } from "@/services/auth";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
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
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
