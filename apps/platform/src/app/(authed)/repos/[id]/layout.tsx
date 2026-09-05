import { RepoRail } from "@/components/repo-rail";
import { RepoMobileNav } from "@/components/repo-mobile-nav";
import { RepoForbidden } from "@/components/repo-forbidden";
import { RepoNotFound } from "@/components/repo-not-found";
import { requireUser } from "@/services/auth";
import { loadRepoForPage } from "@/services/repos";

export default async function RepoDetailLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const { status, repo, owner } = await loadRepoForPage(id, user.id);
  if (status === "forbidden") return <RepoForbidden owner={owner} />;
  if (status === "not-found" || !repo) return <RepoNotFound />;

  return (
    <div className="flex min-h-full">
      <RepoRail repoId={id} repo={repo} />
      <div className="min-w-0 flex-1">
        <RepoMobileNav repoId={id} />
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}
