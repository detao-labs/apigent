import { RepoRail } from "@/components/repo-rail";
import { RepoMobileNav } from "@/components/repo-mobile-nav";
import { getRepoDetail } from "@/services/repos";

export default async function RepoDetailLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const repo = await getRepoDetail(id);

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
