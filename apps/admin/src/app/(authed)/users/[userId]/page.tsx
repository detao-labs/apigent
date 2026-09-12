import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { getUserDetail } from "@apigent/server/admin";
import { roleHasAdminCapability } from "@apigent/server/authz";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@apigent/ui";
import { UserActions } from "@/components/user-actions";
import { requireAdmin } from "@/services/auth";

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const admin = await requireAdmin();
  const { userId } = await params;
  const t = await getTranslations("users");

  if (!roleHasAdminCapability(admin.role, "admin:users:view")) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          {t("noPermission")}
        </CardContent>
      </Card>
    );
  }

  const detail = await getUserDetail(userId);
  if (!detail) notFound();
  const canManage =
    roleHasAdminCapability(admin.role, "admin:users:disable") &&
    roleHasAdminCapability(admin.role, "admin:users:delete");

  const locale = await getLocale();
  const fmt = new Intl.DateTimeFormat(locale === "en" ? "en-US" : "zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <div className="space-y-6">
      <Link
        href="/users"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        {t("detail.back")}
      </Link>

      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">{detail.name}</h1>
          <Badge
            className={
              detail.disabledAt
                ? "bg-destructive/10 text-destructive"
                : "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
            }
          >
            {detail.disabledAt ? t("statusDisabled") : t("statusActive")}
          </Badge>
        </div>
        <p className="text-muted-foreground">{detail.email}</p>
        {canManage ? (
          <div className="mt-3 space-y-2">
            <UserActions
              userId={detail.id}
              userName={detail.name}
              disabled={detail.disabledAt !== null}
              isSelf={detail.id === admin.id}
            />
            <p className="text-xs text-muted-foreground">{t("detailDisableHint")}</p>
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t("detail.profile")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">id</span>
              <span className="font-mono text-xs">{detail.id}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">{t("colCreated")}</span>
              <span>{fmt.format(new Date(detail.createdAt))}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">{t("detail.ownedOrganizations")}</span>
              <span>
                {detail.ownedOrganizations.length > 0
                  ? detail.ownedOrganizations.map((org) => org.name).join(", ")
                  : t("detail.none")}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t("detail.memberships")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {detail.organizations.length === 0 ? (
              <p className="text-muted-foreground">{t("detail.none")}</p>
            ) : (
              detail.organizations.map((org) => (
                <div key={org.id} className="flex items-center justify-between gap-4">
                  <span className="truncate">{org.name}</span>
                  <Badge className="bg-muted text-muted-foreground">{org.role}</Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
