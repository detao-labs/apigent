import { getTranslations } from "next-intl/server";
import { Settings } from "lucide-react";
import { RepoSectionPage } from "@/components/repo-section";
import { getRepoDetail } from "@/services/repos";

export default async function RepoSettingsPage({
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
      crumb={t("nav.settings")}
      title={repo?.name ?? ""}
      sub={t("settingsSub")}
      icon={Settings}
      emptyTitle={t("settingsEmpty")}
      emptyDesc={t("settingsEmptyDesc")}
    />
  );
}
