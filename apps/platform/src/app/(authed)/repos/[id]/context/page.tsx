import { getTranslations } from "next-intl/server";
import { Sparkles } from "lucide-react";
import { RepoSectionPage } from "@/components/repo-section";
import { getRepoDetail } from "@/services/repos";

export default async function RepoContextPage({
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
      crumb={t("nav.context")}
      title={repo?.name ?? ""}
      sub={t("contextSub")}
      icon={Sparkles}
      emptyTitle={t("contextEmpty")}
      emptyDesc={t("contextEmptyDesc")}
    />
  );
}
