import { getLocale, getTranslations } from "next-intl/server";
import { listAdminMembers } from "@apigent/server/admin";
import { roleHasAdminCapability } from "@apigent/server/authz";
import { Card, CardContent } from "@apigent/ui";
import { AdminsView, type AdminMemberView } from "@/components/admins-view";
import { requireAdmin } from "@/services/auth";

export default async function AdminsPage() {
  const admin = await requireAdmin();
  const t = await getTranslations("admins");

  if (!roleHasAdminCapability(admin.role, "admin:admins:manage")) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          {t("errors.noPermission")}
        </CardContent>
      </Card>
    );
  }

  const locale = await getLocale();
  const fmt = new Intl.DateTimeFormat(locale === "en" ? "en-US" : "zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  // 时间在服务端格式化好再传下去：客户端组件里用 Intl 会有 hydration 风险
  const members: AdminMemberView[] = (await listAdminMembers()).map((member) => ({
    userId: member.userId,
    name: member.name,
    email: member.email,
    role: member.role,
    grantedAtLabel: fmt.format(new Date(member.grantedAt)),
    grantedByLabel: member.grantedByName ?? (member.grantedBy ? "—" : t("bySystem")),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-muted-foreground">{t("description")}</p>
      </div>
      <AdminsView members={members} currentUserId={admin.id} />
    </div>
  );
}
