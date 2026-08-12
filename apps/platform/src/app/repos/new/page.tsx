import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default async function NewRepoPage() {
  const t = await getTranslations("repos.new");
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
              <label htmlFor="orgSlug" className="text-sm font-medium">
                {t("org")}
              </label>
              <select
                id="orgSlug"
                name="orgSlug"
                required
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">{t("orgPlaceholder")}</option>
              </select>
              <p className="text-xs text-muted-foreground">
                <Link href="/orgs/new" className="underline underline-offset-4 hover:text-primary">
                  {t("createOrg")}
                </Link>{" "}
                {t("orgHint")}
              </p>
            </div>
            <div className="space-y-2">
              <label htmlFor="name" className="text-sm font-medium">
                {t("name")}
              </label>
              <Input
                id="name"
                name="name"
                type="text"
                required
                placeholder={t("namePlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="description" className="text-sm font-medium">
                {t("description")}
              </label>
              <Textarea
                id="description"
                name="description"
                rows={3}
                placeholder={t("descriptionPlaceholder")}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="specContent" className="text-sm font-medium">
                {t("spec")}{" "}
                <span className="text-muted-foreground font-normal">{t("specOptional")}</span>
              </label>
              <Textarea
                id="specContent"
                name="specContent"
                rows={8}
                className="font-mono text-sm"
                placeholder={t("specPlaceholder")}
              />
              <p className="text-xs text-muted-foreground">{t("specHint")}</p>
            </div>

            <div className="flex items-center gap-3 pt-4">
              <Button type="submit" disabled title={common("backendPending")}>
                {t("submit")}
              </Button>
              <span className="text-sm text-muted-foreground">{common("backendPending")}</span>
              <Link href="/repos" className={buttonVariants({ variant: "ghost" })}>{t("cancel")}</Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
