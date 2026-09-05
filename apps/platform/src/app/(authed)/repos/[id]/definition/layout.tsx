import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { DefinitionView } from "@/components/definition-view";
import { RepoForbidden } from "@/components/repo-forbidden";
import { RepoNotFound } from "@/components/repo-not-found";
import { requireUser } from "@/services/auth";
import {
  getRepoComponentDefs,
  getRepoDataModels,
  getRepoEndpoints,
  loadRepoForPage,
} from "@/services/repos";

export default async function RepoDefinitionLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const reposT = await getTranslations("repos");
  const d = await getTranslations("repos.detail.definitions");

  const { status, repo, owner } = await loadRepoForPage(id, user.id);
  if (status === "forbidden") return <RepoForbidden owner={owner} />;
  if (status === "not-found" || !repo) return <RepoNotFound />;

  const [endpoints, models, components] = await Promise.all([
    getRepoEndpoints(id, user.id),
    getRepoDataModels(id, user.id),
    getRepoComponentDefs(id, user.id),
  ]);

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
        <span className="text-foreground">{d("title")}</span>
      </nav>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">{repo.name}</h1>
        <p className="text-muted-foreground">{d("sub")}</p>
      </div>

      <DefinitionView
        repoId={id}
        endpoints={endpoints}
        models={models}
        components={components}
      />
      {children}
    </div>
  );
}
