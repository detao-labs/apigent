"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  buttonVariants,
} from "@apigent/ui";
import { KeyRound } from "lucide-react";
import { CopyButton } from "@/components/copy-button";
import { mcpConfigSnippet, useMcpServiceUrl } from "@/hooks/use-mcp-service-url";

export function McpConnectCard({
  mcpPath,
  mcpPublicUrl,
}: {
  mcpPath: string;
  mcpPublicUrl: string;
}) {
  const t = useTranslations("dashboard");
  const mcpUrl = useMcpServiceUrl(mcpPath, mcpPublicUrl);
  const snippet = mcpConfigSnippet(mcpUrl);

  return (
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
            <p className="text-xs text-muted-foreground">
              {t("connectAgent.serviceUrl")}
            </p>
            <code className="mt-1 block truncate rounded-md bg-muted px-2 py-1 text-xs">
              {mcpUrl}
            </code>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("connectAgent.auth")}</p>
            <p className="mt-1 text-sm">{t("connectAgent.authValue")}</p>
          </div>
        </div>
        <pre className="overflow-x-auto rounded-lg bg-muted/60 p-3 text-xs leading-relaxed">
          {snippet}
        </pre>
        <div className="flex gap-2">
          <CopyButton text={snippet} label={t("connectAgent.copy")} />
          <Link
            href="/settings"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            {t("connectAgent.guide")}
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
