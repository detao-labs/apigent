import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Card, CardContent } from "@apigent/ui";
import { ChevronRight, ScrollText, Users } from "lucide-react";
import { RepoForbidden } from "@/components/repo-forbidden";
import { RepoNotFound } from "@/components/repo-not-found";
import { requireUser } from "@/services/auth";
import { loadRepoForPage } from "@/services/repos";

export default async function RepoSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const t = await getTranslations("repos.detail");
  const auditT = await getTranslations("audit");
  const { status, repo, owner } = await loadRepoForPage(id, user.id);
  if (status === "forbidden") return <RepoForbidden owner={owner} />;
  if (status === "not-found" || !repo) return <RepoNotFound />;

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
        <span className="text-foreground">{t("nav.settings")}</span>
      </nav>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">{repo.name}</h1>
        <p className="text-muted-foreground">{t("settingsSub")}</p>
      </div>

      <Card>
        <CardContent className="p-0">
          <Link
            href={`/repos/${repo.id}/settings/members`}
            className="flex items-center gap-3 p-4 transition-colors hover:bg-muted/50"
          >
            <div className="flex size-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <Users className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{t("members.title")}</div>
              <p className="truncate text-sm text-muted-foreground">{t("members.entryDesc")}</p>
            </div>
            <ChevronRight className="size-4 text-muted-foreground" />
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Link
            href={`/repos/${repo.id}/settings/audit`}
            className="flex items-center gap-3 p-4 transition-colors hover:bg-muted/50"
          >
            <div className="flex size-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <ScrollText className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{auditT("title")}</div>
              <p className="truncate text-sm text-muted-foreground">
                {auditT("settingsEntryDesc")}
              </p>
            </div>
            <ChevronRight className="size-4 text-muted-foreground" />
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
