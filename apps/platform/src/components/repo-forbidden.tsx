import { buttonVariants } from "@apigent/ui";
import { ArrowLeft, Lock } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CopyIconButton } from "@/components/copy-button";
import type { RepoLoadOwner } from "@/services/repos";

export async function RepoForbidden({
  owner,
}: {
  owner?: RepoLoadOwner | null;
}) {
  const t = await getTranslations("repos.detail");
  return (
    <div className="flex h-full flex-col items-center justify-center py-24 text-center">
      <Lock className="mb-4 size-12 text-muted-foreground/50" />
      <h3 className="mb-1 text-lg font-semibold">{t("forbidden")}</h3>
      <p className="mb-2 max-w-md text-sm text-muted-foreground">
        {t("forbiddenDesc")}
      </p>
      {owner && (
        <div className="mb-6 flex flex-wrap items-center justify-center gap-1.5 text-sm">
          <span className="text-muted-foreground">{t("forbiddenOwner")}</span>
          <span className="font-medium">{owner.name}</span>
          <span className="text-muted-foreground">(</span>
          <span className="font-mono text-xs text-muted-foreground">
            {owner.email}
          </span>
          <CopyIconButton text={owner.email} title={t("forbiddenCopy")} />
          <span className="text-muted-foreground">)</span>
        </div>
      )}
      <Link href="/repos" className={buttonVariants({ variant: "outline" })}>
        <ArrowLeft className="size-4" />
        {t("forbiddenBack")}
      </Link>
    </div>
  );
}
