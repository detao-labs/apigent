import { getTranslations } from "next-intl/server";
import { buttonVariants, Card, CardContent } from "@apigent/ui";
import { Building2, Plus } from "lucide-react";
import Link from "next/link";
import { OrgsTable } from "@/components/orgs-table";
import { PageContainer } from "@/components/page-container";
import { requireUser } from "@/services/auth";
import { listOrgs } from "@/services/orgs";

export default async function OrgsPage() {
  const user = await requireUser();
  const t = await getTranslations("orgs");
  const orgs = await listOrgs(user.id);

  return (
    <PageContainer className="space-y-6">
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
            <OrgsTable orgs={orgs} />
          </CardContent>
        </Card>
      )}
    </PageContainer>
  );
}
