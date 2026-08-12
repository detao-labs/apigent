import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default async function NewOrgPage() {
  const t = await getTranslations("orgs.new");
  const common = await getTranslations("common");

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("description")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("details")}</CardTitle>
          <CardDescription>{t("detailsDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="name" className="text-sm font-medium">{t("name")}</label>
              <Input id="name" name="name" type="text" required placeholder={t("namePlaceholder")} />
            </div>
            <div className="space-y-2">
              <label htmlFor="slug" className="text-sm font-medium">{t("slug")}</label>
              <Input id="slug" name="slug" type="text" required pattern="[a-z0-9-]+" placeholder={t("slugPlaceholder")} className="font-mono" />
              <p className="text-xs text-muted-foreground">{t("slugHint")}</p>
            </div>
            <div className="flex items-center gap-3 pt-4">
              <Button type="submit" disabled title={common("backendPending")}>
                {t("submit")}
              </Button>
              <span className="text-sm text-muted-foreground">{common("backendPending")}</span>
              <Link href="/orgs" className={buttonVariants({ variant: "ghost" })}>{t("cancel")}</Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
