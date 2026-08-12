import { getTranslations } from "next-intl/server";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Database, ExternalLink } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default async function ReposPage() {
  const t = await getTranslations("repos");
  const repos: { id: string; name: string; description: string | null; orgName: string; mcpEnabled: boolean }[] = [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground">{t("description")}</p>
        </div>
        <Link href="/repos/new" className={buttonVariants()}>
          <Plus className="size-4" />
          {t("new.title")}
        </Link>
      </div>

      {repos.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Database className="size-12 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-semibold mb-1">{t("empty.title")}</h3>
            <p className="text-muted-foreground mb-6">{t("empty.description")}</p>
            <Link href="/repos/new" className={buttonVariants()}>
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
                  <th className="text-left py-3 px-4 text-sm font-medium">{t("table.org")}</th>
                  <th className="text-left py-3 px-4 text-sm font-medium">{t("table.mcp")}</th>
                  <th className="text-right py-3 px-4 text-sm font-medium">{t("table.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {repos.map((repo) => (
                  <tr key={repo.id} className="border-b last:border-0 hover:bg-muted/50">
                    <td className="py-3 px-4">
                      <p className="font-medium">{repo.name}</p>
                      {repo.description && (
                        <p className="text-sm text-muted-foreground truncate max-w-xs">{repo.description}</p>
                      )}
                    </td>
                    <td className="py-3 px-4 text-sm text-muted-foreground">{repo.orgName}</td>
                    <td className="py-3 px-4">
                      {repo.mcpEnabled ? (
                        <Badge className="bg-green-100 text-green-700 hover:bg-green-100">{t("table.enabled")}</Badge>
                      ) : (
                        <Badge variant="secondary">{t("table.disabled")}</Badge>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <Link
                        href={`/repos/${repo.id}`}
                        className={buttonVariants({ variant: "ghost", size: "sm" })}
                      >
                        <ExternalLink className="size-3" />
                        {t("table.details")}
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
