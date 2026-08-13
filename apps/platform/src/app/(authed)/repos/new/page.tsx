import { getTranslations } from "next-intl/server";
import { PageContainer } from "@/components/page-container";
import { RepoForm } from "@/components/repo-form";
import { listOrgs } from "@/services/orgs";

export default async function NewRepoPage() {
  const t = await getTranslations("repos.new");
  const orgs = await listOrgs();

  return (
    <PageContainer>
      <div className="max-w-2xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground">{t("description")}</p>
        </div>
        <RepoForm orgs={orgs} />
      </div>
    </PageContainer>
  );
}
