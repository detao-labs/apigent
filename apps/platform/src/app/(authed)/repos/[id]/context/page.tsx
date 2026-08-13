import Link from "next/link";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { ChevronRight } from "lucide-react";
import { ContextManagement } from "@/components/context-management";
import { RepoNotFound } from "@/components/repo-not-found";
import { getRepoDetail } from "@/services/repos";

export default async function RepoContextPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await getTranslations("repos.detail");
  const repo = await getRepoDetail(id);
  if (!repo) return <RepoNotFound />;

  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link href="/repos" className="hover:text-foreground">
          {t("breadcrumbRepos")}
        </Link>
        <ChevronRight className="size-3.5" />
        <Link href={`/repos/${repo.id}`} className="hover:text-foreground">
          {repo.name}
        </Link>
        <ChevronRight className="size-3.5" />
        <span className="text-foreground">{t("nav.context")}</span>
      </nav>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">{repo.name}</h1>
        <p className="text-muted-foreground">{t("contextSub")}</p>
      </div>

      <Suspense fallback={null}>
        <ContextManagement repoId={repo.id} />
      </Suspense>
    </div>
  );
}
