import { getTranslations } from "next-intl/server";
import { History } from "lucide-react";
import { RepoSectionPage } from "@/components/repo-section";
import { getRepoDetail } from "@/services/repos";

export default async function RepoVersionsPage({
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
      crumb={t("nav.versions")}
      title={repo?.name ?? ""}
      sub={t("versionsSub")}
      icon={History}
      emptyTitle={t("versionsEmpty")}
      emptyDesc={t("versionsEmptyDesc")}
    />
  );
}
