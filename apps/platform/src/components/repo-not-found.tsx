import { buttonVariants } from "@apigent/ui";
import { ArrowLeft, FolderSearch } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

export async function RepoNotFound() {
  const t = await getTranslations("repos.detail");
  return (
    <div className="flex h-full flex-col items-center justify-center py-24 text-center">
      <FolderSearch className="mb-4 size-12 text-muted-foreground/50" />
      <h3 className="mb-1 text-lg font-semibold">{t("notFound")}</h3>
      <Link href="/repos" className={buttonVariants({ variant: "outline" })}>
        <ArrowLeft className="size-4" />
        {t("notFoundBack")}
      </Link>
    </div>
  );
}
