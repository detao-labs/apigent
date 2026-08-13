import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ChevronRight } from "lucide-react";
import { EndpointList } from "@/components/endpoint-list";
import { RepoNotFound } from "@/components/repo-not-found";
import { getRepoDetail, getRepoEndpoints } from "@/services/repos";

export default async function RepoEndpointsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await getTranslations("repos.detail");
  const reposT = await getTranslations("repos");
  const repo = await getRepoDetail(id);
  if (!repo) return <RepoNotFound />;
  const endpoints = await getRepoEndpoints(id);

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
        <span className="text-foreground">{t("nav.endpoints")}</span>
      </nav>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">{repo.name}</h1>
        <p className="text-muted-foreground">{t("endpointsSub")}</p>
      </div>

      <EndpointList endpoints={endpoints} />
    </div>
  );
}
