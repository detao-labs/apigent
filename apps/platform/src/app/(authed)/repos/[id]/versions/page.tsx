import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Suspense } from "react";
import { VersionsView } from "@/components/versions-view";
import { RepoForbidden } from "@/components/repo-forbidden";
import { RepoNotFound } from "@/components/repo-not-found";
import { requireUser } from "@/services/auth";
import { loadRepoForPage } from "@/services/repos";
import { getDefaultVersionId, listVersions } from "@apigent/server/versions";
import { getEffectiveRepoRole, isRepoRoleAtLeast } from "@apigent/server/authz";

export default async function RepoVersionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const reposT = await getTranslations("repos");
  const t = await getTranslations("repos.detail");
  const { status, repo, owner } = await loadRepoForPage(id, user.id);
  if (status === "forbidden") return <RepoForbidden owner={owner} />;
  if (status === "not-found" || !repo) return <RepoNotFound />;

  const [versions, currentVersionId, role] = await Promise.all([
    listVersions(id),
    getDefaultVersionId(id),
    getEffectiveRepoRole(user.id, id),
  ]);
  const canActivate = isRepoRoleAtLeast(role, "repo_admin");

  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link href="/repos" className="hover:text-foreground">
          {reposT("title")}
        </Link>
        <ChevronRight className="size-3.5" />
        <Link href={`/repos/${repo.id}`} className="hover:text-foreground">
          {repo.name}
        </Link>
        <ChevronRight className="size-3.5" />
        <span className="text-foreground">{t("nav.versions")}</span>
      </nav>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">{repo.name}</h1>
        <p className="text-muted-foreground">{t("versionsSub")}</p>
      </div>

      <Suspense fallback={<div className="py-10 text-center text-sm text-muted-foreground" />}>
        <VersionsView
          repoId={id}
          versions={versions}
          currentVersionId={currentVersionId}
          canActivate={canActivate}
        />
      </Suspense>
    </div>
  );
}
