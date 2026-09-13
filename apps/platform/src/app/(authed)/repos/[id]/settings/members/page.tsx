import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ChevronRight } from "lucide-react";
import { ForbiddenError } from "@apigent/server/authz";
import { RepoForbidden } from "@/components/repo-forbidden";
import { RepoMembersView } from "@/components/repo-members-view";
import { RepoNotFound } from "@/components/repo-not-found";
import { requireUser } from "@/services/auth";
import { listRepoMembers } from "@/services/repo-members";
import { loadRepoForPage } from "@/services/repos";

export default async function RepoMembersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const t = await getTranslations("repos.detail");
  const { status, repo, owner } = await loadRepoForPage(id, user.id);
  if (status === "forbidden") return <RepoForbidden owner={owner} />;
  if (status === "not-found" || !repo) return <RepoNotFound />;

  let view;
  try {
    view = await listRepoMembers(id, user.id);
  } catch (err) {
    if (err instanceof ForbiddenError) return <RepoForbidden owner={owner} />;
    throw err;
  }

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
        <Link href={`/repos/${repo.id}/settings`} className="hover:text-foreground">
          {t("nav.settings")}
        </Link>
        <ChevronRight className="size-3.5" />
        <span className="text-foreground">{t("members.title")}</span>
      </nav>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("members.title")}</h1>
        <p className="text-muted-foreground">{t("members.sub")}</p>
      </div>

      <RepoMembersView view={view} />
    </div>
  );
}
