import { getTranslations } from "next-intl/server";
import { Braces, Building2, Database, Users } from "lucide-react";
import { getPlatformStats } from "@apigent/server/admin";
import { listOperationLogs } from "@apigent/server/audit";
import { roleHasAdminCapability } from "@apigent/server/authz";
import { Card, CardContent, CardHeader, CardTitle } from "@apigent/ui";
import { OperationLogTable } from "@/components/operation-log-table";
import { requireAdmin } from "@/services/auth";

export default async function AdminDashboard() {
  const admin = await requireAdmin();
  const t = await getTranslations("dashboard");

  if (!roleHasAdminCapability(admin.role, "admin:stats:view")) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          {t("stats.noPermission")}
        </CardContent>
      </Card>
    );
  }

  const [stats, activity] = await Promise.all([
    getPlatformStats(),
    listOperationLogs({ platformOnly: true, limit: 5 }),
  ]);

  const cards = [
    {
      icon: <Users className="size-4 text-muted-foreground" />,
      label: t("stats.users"),
      value: stats.users,
      desc: t("stats.usersDesc", { count: stats.newUsers }),
    },
    {
      icon: <Building2 className="size-4 text-muted-foreground" />,
      label: t("stats.orgs"),
      value: stats.organizations,
      desc: t("stats.orgsDesc"),
    },
    {
      icon: <Database className="size-4 text-muted-foreground" />,
      label: t("stats.repos"),
      value: stats.repositories,
      desc: t("stats.reposDesc", { count: stats.mcpEnabledRepositories }),
    },
    {
      icon: <Braces className="size-4 text-muted-foreground" />,
      label: t("stats.endpoints"),
      value: stats.endpoints,
      desc: t("stats.endpointsDesc"),
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("description")}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        {cards.map((card) => (
          <Card key={card.label}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">{card.label}</CardTitle>
              {card.icon}
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tabular-nums">{card.value}</div>
              <p className="mt-1 text-xs text-muted-foreground">{card.desc}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">{t("recentActivity")}</h2>
        <OperationLogTable entries={activity.items} />
      </div>
    </div>
  );
}
