import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ChevronRight } from "lucide-react";
import { listOperationLogs } from "@apigent/server/audit";
import { OperationLogTable } from "@/components/operation-log-table";
import { RepoForbidden } from "@/components/repo-forbidden";
import { RepoNotFound } from "@/components/repo-not-found";
import { requireUser } from "@/services/auth";
import { loadRepoForPage } from "@/services/repos";

export default async function RepoAuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const t = await getTranslations("repos.detail");
  const auditT = await getTranslations("audit");
  const { status, repo, owner } = await loadRepoForPage(id, user.id);
  if (status === "forbidden") return <RepoForbidden owner={owner} />;
  if (status === "not-found" || !repo) return <RepoNotFound />;

  // 只读：能打开仓库内容（repo_viewer+）就能看自己仓库的留痕。
  const page = await listOperationLogs({ repositoryId: id, limit: 50 });

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
        <span className="text-foreground">{auditT("title")}</span>
      </nav>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">{auditT("title")}</h1>
        <p className="text-muted-foreground">
          {auditT("subtitle")} · {auditT("total", { count: page.total })}
        </p>
      </div>

      <OperationLogTable entries={page.items} />
    </div>
  );
}
