import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import {
  Badge,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@apigent/ui";
import { RepoForbidden } from "@/components/repo-forbidden";
import { RepoNotFound } from "@/components/repo-not-found";
import { requireUser } from "@/services/auth";
import { loadRepoForPage } from "@/services/repos";
import { listVersionHistory } from "@apigent/server/versions";

function fmtTime(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "medium" }).format(
    new Date(date),
  );
}

export default async function RepoHistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const reposT = await getTranslations("repos");
  const t = await getTranslations("repos.detail.history");
  const { status, repo, owner } = await loadRepoForPage(id, user.id);
  if (status === "forbidden") return <RepoForbidden owner={owner} />;
  if (status === "not-found" || !repo) return <RepoNotFound />;

  const entries = await listVersionHistory(id);

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
        <span className="text-foreground">{t("title")}</span>
      </nav>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>

      {entries.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <h3 className="mb-1 text-lg font-semibold">{t("empty")}</h3>
            <p className="max-w-md text-muted-foreground">{t("emptyDesc")}</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead>{t("colVersion")}</TableHead>
                  <TableHead>{t("colTime")}</TableHead>
                  <TableHead>{t("colSource")}</TableHead>
                  <TableHead>{t("colChanges")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e) => (
                  <TableRow key={e.commitId}>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <span className="font-mono text-sm">{e.versionName}</span>
                        {e.specVersion && (
                          <span className="text-xs text-muted-foreground">
                            {e.specTitle ?? "OpenAPI"} · v{e.specVersion}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{fmtTime(e.createdAt)}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{e.source ?? "import"}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1.5 text-xs">
                        <Badge variant="secondary">+ {e.changeSummary?.added.length ?? 0} {t("added")}</Badge>
                        <Badge variant="secondary">~ {e.changeSummary?.updated.length ?? 0} {t("updated")}</Badge>
                        <Badge variant="destructive">- {e.changeSummary?.removed.length ?? 0} {t("removed")}</Badge>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
