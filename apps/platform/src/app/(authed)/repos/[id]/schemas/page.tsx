import { getTranslations } from "next-intl/server";
import { Boxes } from "lucide-react";
import { RepoSectionPage } from "@/components/repo-section";
import { getRepoDetail } from "@/services/repos";

export default async function RepoSchemasPage({
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
      crumb={t("nav.schemas")}
      title={repo?.name ?? ""}
      sub={t("schemasSub")}
      icon={Boxes}
      emptyTitle={t("schemasEmpty")}
      emptyDesc={t("schemasEmptyDesc")}
    />
  );
}
