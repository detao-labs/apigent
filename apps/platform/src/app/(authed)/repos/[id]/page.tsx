import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ChevronRight } from "lucide-react";
import { RepoForbidden } from "@/components/repo-forbidden";
import { RepoNotFound } from "@/components/repo-not-found";
import { RepoOverview } from "@/components/repo-overview";
import { requireUser } from "@/services/auth";
import { loadRepoForPage } from "@/services/repos";
import { getLatestImportTask } from "@apigent/server/imports";
import { getLatestContextTask } from "@apigent/server/contexts";

export default async function RepoDetailOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const locale = await getLocale();
  const t = await getTranslations("repos");
  const { status, repo, owner } = await loadRepoForPage(id, user.id);
  if (status === "forbidden") return <RepoForbidden owner={owner} />;

  if (!repo) return <RepoNotFound />;

  const latestTask = await getLatestImportTask(id);
  const latestContextTask = await getLatestContextTask(id);

  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link href="/repos" className="hover:text-foreground">
          {t("title")}
        </Link>
        <ChevronRight className="size-3.5" />
        <span className="text-foreground">{repo.name}</span>
      </nav>
      <RepoOverview
        repo={repo}
        locale={locale}
        latestTask={latestTask}
        latestContextTask={latestContextTask}
      />
    </div>
  );
}
