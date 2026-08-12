import { getTranslations } from "next-intl/server";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@apigent/ui";
import { Building2, Database, Upload, Plus } from "lucide-react";
import Link from "next/link";
import { getDashboardStats } from "@/services/stats";

export default async function DashboardPage() {
  const t = await getTranslations("dashboard");
  const stats = await getDashboardStats();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("description")}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">{t("stats.organizations")}</CardTitle>
            <Building2 className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.organizations}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">{t("stats.repositories")}</CardTitle>
            <Database className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.repositories}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">{t("stats.endpoints")}</CardTitle>
            <Upload className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.endpoints}</div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <div>
        <CardDescription className="mb-3">{t("quickActions")}</CardDescription>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="hover:border-primary/50 transition-colors">
            <Link href="/orgs/new">
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                    <Building2 className="size-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">{t("createOrg.title")}</p>
                    <p className="text-sm text-muted-foreground">{t("createOrg.description")}</p>
                  </div>
                </div>
              </CardContent>
            </Link>
          </Card>
          <Card className="hover:border-primary/50 transition-colors">
            <Link href="/repos/new">
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                    <Plus className="size-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">{t("newRepo.title")}</p>
                    <p className="text-sm text-muted-foreground">{t("newRepo.description")}</p>
                  </div>
                </div>
              </CardContent>
            </Link>
          </Card>
        </div>
      </div>
    </div>
  );
}
