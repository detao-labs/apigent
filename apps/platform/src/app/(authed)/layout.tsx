import { redirect } from "next/navigation";
import { SidebarInset, SidebarProvider, TooltipProvider } from "@apigent/ui";
import { AppSidebar } from "@/components/app-sidebar";
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
        <AppSidebar user={user} />
        <SidebarInset>
          <main className="p-6">{children}</main>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
