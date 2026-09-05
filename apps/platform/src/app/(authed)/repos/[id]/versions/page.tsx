import { getTranslations } from "next-intl/server";
import { History } from "lucide-react";
import { RepoSectionPage } from "@/components/repo-section";
import { RepoForbidden } from "@/components/repo-forbidden";
import { RepoNotFound } from "@/components/repo-not-found";
import { requireUser } from "@/services/auth";
import { loadRepoForPage } from "@/services/repos";

export default async function RepoVersionsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const t = await getTranslations("repos.detail");
  const { status, repo, owner } = await loadRepoForPage(id, user.id);
  if (status === "forbidden") return <RepoForbidden owner={owner} />;
  if (status === "not-found" || !repo) return <RepoNotFound />;

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
