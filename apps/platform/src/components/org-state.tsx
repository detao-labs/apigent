import { buttonVariants } from "@apigent/ui";
import { ArrowLeft, Building2, Lock } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

export async function OrgForbidden() {
  const d = await getTranslations("orgs.detail");
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <Lock className="mb-4 size-12 text-muted-foreground/50" />
      <h3 className="mb-1 text-lg font-semibold">{d("forbidden")}</h3>
      <Link href="/orgs" className={buttonVariants({ variant: "outline" })}>
        <ArrowLeft className="size-4" />
        {d("back")}
      </Link>
    </div>
  );
}

export async function OrgNotFound() {
  const orgsT = await getTranslations("orgs");
  const d = await getTranslations("orgs.detail");
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <Building2 className="mb-4 size-12 text-muted-foreground/50" />
      <h3 className="mb-1 text-lg font-semibold">{orgsT("title")}</h3>
      <Link href="/orgs" className={buttonVariants({ variant: "outline" })}>
        <ArrowLeft className="size-4" />
        {d("back")}
      </Link>
    </div>
  );
}
