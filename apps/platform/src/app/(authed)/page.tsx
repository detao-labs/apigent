import { getLocale, getTranslations } from "next-intl/server";
import {
  Badge,
  buttonVariants,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@apigent/ui";
import {
  ArrowRight,
  Building2,
  Check,
  Circle,
  Database,
  KeyRound,
  Plug,
  Plus,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { CopyButton } from "@/components/copy-button";
import { PageContainer } from "@/components/page-container";
import { formatRelativeTime } from "@/lib/format";
import { requireUser } from "@/services/auth";
import { listRepos } from "@/services/repos";
import { getDashboardStats } from "@/services/stats";

const MCP_SERVICE_URL = "https://apigent.acme.dev/mcp";

export default async function DashboardPage() {
  const user = await requireUser();
  const t = await getTranslations("dashboard");
  const locale = await getLocale();
  const [stats, repos] = await Promise.all([
    getDashboardStats(user.id),
    listRepos(user.id),
  ]);

  const steps = [
    {
      key: "org",
      done: stats.organizations > 0,
      href: "/orgs/new",
      title: t("onboarding.steps.org"),
      hint: stats.organizations > 0 ? t("onboarding.steps.done") : null,
    },
    {
      key: "repo",
      done: stats.repositories > 0,
      href: "/repos/new",
      title: t("onboarding.steps.repo"),
      hint: stats.repositories > 0 ? t("onboarding.steps.done") : null,
    },
    {
      key: "key",
      done: false,
      href: "/settings",
      title: t("onboarding.steps.key"),
      hint: t("onboarding.steps.keyHint"),
    },
    {
      key: "mcp",
      done: false,
      href: null,
      title: t("onboarding.steps.mcp"),
      hint: t("onboarding.steps.mcpHint"),
    },
  ] as const;
  const doneCount = steps.filter((step) => step.done).length;

  const statCards = [
    { label: t("stats.organizations"), value: stats.organizations, href: "/orgs", icon: Building2 },
    { label: t("stats.repositories"), value: stats.repositories, href: "/repos", icon: Database },
    { label: t("stats.endpoints"), value: stats.endpoints, href: "/repos", icon: Upload },
    { label: t("stats.mcpEnabled"), value: stats.mcpEnabled, href: "/repos", icon: Plug },
  ];

  const recentRepos = repos.slice(0, 5);

  return (
    <PageContainer className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground">{t("description")}</p>
        </div>
        <Link href="/repos/new" className={buttonVariants()}>
          <Plus className="size-4" />
          {t("newRepo")}
        </Link>
      </div>

      {/* 新手引导清单 */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between pb-2">
          <div>
            <CardTitle className="text-base">{t("onboarding.title")}</CardTitle>
            <CardDescription>{t("onboarding.description")}</CardDescription>
          </div>
          <Badge variant="secondary">
            {t("onboarding.progress", { done: doneCount, total: steps.length })}
          </Badge>
        </CardHeader>
        <CardContent>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${(doneCount / steps.length) * 100}%` }}
            />
          </div>
          <ul className="mt-4 grid grid-cols-1 gap-1 sm:grid-cols-2">
            {steps.map((step) => (
              <li
                key={step.key}
                className="flex items-center gap-3 rounded-md px-2 py-2"
              >
                <span className="flex size-5 shrink-0 items-center justify-center">
                  {step.done ? (
                    <Check className="size-5 text-primary" />
                  ) : (
                    <Circle className="size-5 text-muted-foreground/50" />
                  )}
                </span>
                <div className="min-w-0 leading-tight">
                  <p className="text-sm font-medium">{step.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {step.href ? (
                      <Link
                        href={step.href}
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        {step.hint}
                        <ArrowRight className="size-3" />
                      </Link>
                    ) : (
                      step.hint
                    )}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* 统计卡 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((card) => (
          <Link key={card.label} href={card.href} className="group">
            <Card className="transition-colors group-hover:border-primary/50">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">{card.label}</CardTitle>
                <card.icon className="size-4 text-muted-foreground" />
              </CardHeader>
              <CardContent className="flex items-center justify-between">
                <span className="text-2xl font-bold">{card.value}</span>
                <ArrowRight className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* 最近更新 + 接入 Agent */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">{t("recentUpdates.title")}</CardTitle>
              <CardDescription>{t("recentUpdates.description")}</CardDescription>
            </div>
            <Link
              href="/repos"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              {t("recentUpdates.viewAll")}
              <ArrowRight className="size-3.5" />
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {recentRepos.length === 0 ? (
              <p className="px-6 py-10 text-center text-sm text-muted-foreground">
                {t("recentUpdates.empty")}
              </p>
            ) : (
              <ul className="divide-y">
                {recentRepos.map((repo) => (
                  <li key={repo.id}>
                    <Link
                      href={`/repos/${repo.id}`}
                      className="flex items-center justify-between gap-4 px-6 py-3 transition-colors hover:bg-muted/50"
                    >
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 text-sm font-medium">
                          {repo.name}
                          {repo.mcpEnabled && (
                            <Badge className="bg-green-100 text-green-700 hover:bg-green-100 dark:bg-green-900/40 dark:text-green-300">
                              {t("stats.mcpEnabled")}
                            </Badge>
                          )}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {repo.currentVersion
                            ? `${repo.currentVersion} · `
                            : ""}
                          {formatRelativeTime(repo.updatedAt, locale)}
                        </p>
                      </div>
                      <ArrowRight className="size-4 shrink-0 text-muted-foreground/50" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="size-4 text-muted-foreground" />
              {t("connectAgent.title")}
            </CardTitle>
            <CardDescription>{t("connectAgent.description")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div>
                <p className="text-xs text-muted-foreground">{t("connectAgent.serviceUrl")}</p>
                <code className="mt-1 block truncate rounded-md bg-muted px-2 py-1 text-xs">
                  {MCP_SERVICE_URL}
                </code>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("connectAgent.auth")}</p>
                <p className="mt-1 text-sm">{t("connectAgent.authValue")}</p>
              </div>
            </div>
            <pre className="overflow-x-auto rounded-lg bg-muted/60 p-3 text-xs leading-relaxed">
{`{
  "mcpServers": {
    "apigent": {
      "url": "${MCP_SERVICE_URL}",
      "headers": { "Authorization": "Bearer <你的密钥>" }
    }
  }
}`}
            </pre>
            <div className="flex gap-2">
              <CopyButton text={mcpConfigSnippet()} label={t("connectAgent.copy")} />
              <Link
                href="/settings"
                className={buttonVariants({ variant: "ghost", size: "sm" })}
              >
                {t("connectAgent.guide")}
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}

function mcpConfigSnippet() {
  return `{
  "mcpServers": {
    "apigent": {
      "url": "${MCP_SERVICE_URL}",
      "headers": { "Authorization": "Bearer <your-key>" }
    }
  }
}`;
}
