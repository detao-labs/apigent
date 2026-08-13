import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Card, CardContent } from "@apigent/ui";
import { ChevronRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { RepoDetail } from "@/services/repos";
import { RepoNotFound } from "@/components/repo-not-found";

export async function RepoSectionPage({
  repo,
  crumb,
  title,
  sub,
  icon: Icon,
  emptyTitle,
  emptyDesc,
}: {
  repo: RepoDetail | null;
  crumb: string;
  title: string;
  sub: string;
  icon: LucideIcon;
  emptyTitle: string;
  emptyDesc: string;
}) {
  const t = await getTranslations("repos.detail");
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
        <span className="text-foreground">{crumb}</span>
      </nav>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <p className="text-muted-foreground">{sub}</p>
      </div>

      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Icon className="mb-4 size-12 text-muted-foreground/50" />
          <h3 className="mb-1 text-lg font-semibold">{emptyTitle}</h3>
          <p className="max-w-md text-muted-foreground">{emptyDesc}</p>
        </CardContent>
      </Card>
    </div>
  );
}
