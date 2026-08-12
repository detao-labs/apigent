import { getTranslations } from "next-intl/server";
import { buttonVariants, Card, CardContent } from "@apigent/ui";
import { Plus, Building2, ExternalLink } from "lucide-react";
import Link from "next/link";
import { listOrgs } from "@/services/orgs";

export default async function OrgsPage() {
  const t = await getTranslations("orgs");
  const orgs = await listOrgs();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground">{t("description")}</p>
        </div>
        <Link href="/orgs/new" className={buttonVariants()}>
          <Plus className="size-4" />
          {t("new.title")}
        </Link>
      </div>

      {orgs.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Building2 className="size-12 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-semibold mb-1">{t("empty.title")}</h3>
            <p className="text-muted-foreground mb-6">{t("empty.description")}</p>
            <Link href="/orgs/new" className={buttonVariants()}>
              <Plus className="size-4" />
              {t("new.title")}
            </Link>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left py-3 px-4 text-sm font-medium">{t("table.name")}</th>
                  <th className="text-left py-3 px-4 text-sm font-medium">{t("table.slug")}</th>
                  <th className="text-right py-3 px-4 text-sm font-medium">{t("table.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {orgs.map((org) => (
                  <tr key={org.id} className="border-b last:border-0 hover:bg-muted/50">
                    <td className="py-3 px-4 font-medium">{org.name}</td>
                    <td className="py-3 px-4 text-sm text-muted-foreground font-mono">{org.slug}</td>
                    <td className="py-3 px-4 text-right">
                      <Link
                        href={`/repos?org=${org.slug}`}
                        className={buttonVariants({ variant: "ghost", size: "sm" })}
                      >
                        <ExternalLink className="size-3" />
                        {t("table.repos")}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
