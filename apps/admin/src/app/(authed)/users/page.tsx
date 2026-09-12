import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { listUsers } from "@apigent/server/admin";
import { roleHasAdminCapability } from "@apigent/server/authz";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@apigent/ui";
import { requireAdmin } from "@/services/auth";
import { UserActions } from "@/components/user-actions";

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const admin = await requireAdmin();
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

  const { q } = await searchParams;
  const canManage =
    roleHasAdminCapability(admin.role, "admin:users:disable") &&
    roleHasAdminCapability(admin.role, "admin:users:delete");
  const page = await listUsers({ search: q, limit: 50 });
  const locale = await getLocale();
  const fmt = new Intl.DateTimeFormat(locale === "en" ? "en-US" : "zh-CN", {
    dateStyle: "medium",
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <p className="text-muted-foreground">
            {t("description")} · {t("total", { count: page.total })}
          </p>
        </div>
        {/* 用 GET 表单做搜索：无需客户端 JS，刷新即结果 */}
        <form className="flex items-center gap-2">
          <Input
            name="q"
            defaultValue={q ?? ""}
            placeholder={t("searchPlaceholder")}
            className="w-64"
          />
          <Button type="submit" variant="outline">
            {t("searchPlaceholder")}
          </Button>
        </form>
      </div>

      {page.items.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <h3 className="mb-1 text-lg font-semibold">{q ? t("noResults") : t("emptyTitle")}</h3>
            <p className="text-sm text-muted-foreground">{t("emptyDescription")}</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead>{t("colUser")}</TableHead>
                  <TableHead>{t("colCreated")}</TableHead>
                  <TableHead className="text-right">{t("colOrgs")}</TableHead>
                  <TableHead className="text-right">{t("colRepos")}</TableHead>
                  <TableHead>{t("colStatus")}</TableHead>
                  {canManage ? (
                    <TableHead className="text-right">{t("colActions")}</TableHead>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.items.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <Link href={`/users/${user.id}`} className="block hover:underline">
                        <div className="text-sm font-medium">{user.name}</div>
                        <div className="text-xs text-muted-foreground">{user.email}</div>
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {fmt.format(new Date(user.createdAt))}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {user.organizationCount}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {user.repositoryCount}
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={
                          user.disabledAt
                            ? "bg-destructive/10 text-destructive"
                            : "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                        }
                      >
                        {user.disabledAt ? t("statusDisabled") : t("statusActive")}
                      </Badge>
                    </TableCell>
                    {canManage ? (
                      <TableCell className="text-right">
                        <UserActions
                          userId={user.id}
                          userName={user.name}
                          disabled={user.disabledAt !== null}
                        />
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
