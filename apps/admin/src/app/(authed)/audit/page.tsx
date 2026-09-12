import { getTranslations } from "next-intl/server";
import { listOperationLogs } from "@apigent/server/audit";
import { roleHasAdminCapability } from "@apigent/server/authz";
import { Card, CardContent } from "@apigent/ui";
import { OperationLogTable } from "@/components/operation-log-table";
import { requireAdmin } from "@/services/auth";

export default async function AuditPage() {
  const admin = await requireAdmin();
  const t = await getTranslations("audit");

  if (!roleHasAdminCapability(admin.role, "admin:audit:view")) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          {t("noPermission")}
        </CardContent>
      </Card>
    );
  }

  // platformOnly：organizationId 为 NULL 的事件，即平台侧操作
  const page = await listOperationLogs({ platformOnly: true, limit: 50 });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-muted-foreground">
          {t("description")} · {t("total", { count: page.total })}
        </p>
      </div>
      <OperationLogTable entries={page.items} />
    </div>
  );
}
