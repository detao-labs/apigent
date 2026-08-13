import { getTranslations } from "next-intl/server";
import { ListTree } from "lucide-react";
import { RepoSectionPage } from "@/components/repo-section";
import { getRepoDetail } from "@/services/repos";

export default async function RepoEndpointsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await getTranslations("repos.detail");
  const repo = await getRepoDetail(id);

  return (
    <RepoSectionPage
      repo={repo}
      crumb={t("nav.endpoints")}
      title={repo?.name ?? ""}
      sub={t("endpointsSub")}
      icon={ListTree}
      emptyTitle={t("endpointsEmpty")}
      emptyDesc={t("endpointsEmptyDesc")}
    />
  );
}
