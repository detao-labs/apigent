import { getTranslations } from "next-intl/server";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Key } from "lucide-react";

export default async function KeysPage() {
  const t = await getTranslations("keys");
  const common = await getTranslations("common");
  const keys: { id: string; name: string; prefix: string; scopes: string[]; lastUsed: string | null }[] = [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground">{t("description")}</p>
        </div>
        <Button type="button" disabled title={common("backendPending")}>
            <Plus className="size-4" />
            {t("generate")}
        </Button>
      </div>

      {keys.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Key className="size-12 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-semibold mb-1">{t("empty.title")}</h3>
            <p className="text-muted-foreground mb-6">{t("empty.description")}</p>
            <Button type="button" disabled title={common("backendPending")}>
                <Plus className="size-4" />
                {t("generate")}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left py-3 px-4 text-sm font-medium">{t("table.name")}</th>
                  <th className="text-left py-3 px-4 text-sm font-medium">{t("table.prefix")}</th>
                  <th className="text-left py-3 px-4 text-sm font-medium">{t("table.scopes")}</th>
                  <th className="text-left py-3 px-4 text-sm font-medium">{t("table.lastUsed")}</th>
                  <th className="text-right py-3 px-4 text-sm font-medium">{t("table.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((key) => (
                  <tr key={key.id} className="border-b last:border-0 hover:bg-muted/50">
                    <td className="py-3 px-4 font-medium">{key.name}</td>
                    <td className="py-3 px-4">
                      <code className="text-sm bg-muted px-1.5 py-0.5 rounded">{key.prefix}...</code>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex flex-wrap gap-1">
                        {key.scopes.map((scope) => (
                          <Badge key={scope} variant="secondary" className="text-xs">{scope}</Badge>
                        ))}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-sm text-muted-foreground">{key.lastUsed ?? t("never")}</td>
                    <td className="py-3 px-4 text-right">
                      <Button variant="ghost" size="sm" type="button" disabled className="text-destructive">
                        {t("revoke")}
                      </Button>
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
