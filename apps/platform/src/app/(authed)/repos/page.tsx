import { getLocale } from "next-intl/server";
import { ReposView } from "@/components/repos-view";
import { PageContainer } from "@/components/page-container";
import { requireUser } from "@/services/auth";
import { listRepos } from "@/services/repos";

export default async function ReposPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const user = await requireUser();
  const locale = await getLocale();
  const { org } = await searchParams;
  const repos = await listRepos(user.id);

  return (
    <PageContainer>
      <ReposView repos={repos} initialOrg={org} locale={locale} />
    </PageContainer>
  );
}
