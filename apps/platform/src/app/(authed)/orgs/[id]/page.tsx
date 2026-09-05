import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { OrgDetailView } from "@/components/org-detail-view";
import { OrgForbidden, OrgNotFound } from "@/components/org-state";
import { PageContainer } from "@/components/page-container";
import { requireUser } from "@/services/auth";
import { loadOrgForPage } from "@/services/orgs";

export default async function OrgDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const orgsT = await getTranslations("orgs");

  const { status, org } = await loadOrgForPage(id, user.id);
  if (status === "forbidden") return <OrgForbidden />;
  if (status === "not-found" || !org) return <OrgNotFound />;

  return (
    <PageContainer className="space-y-6">
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link href="/orgs" className="hover:text-foreground">
          {orgsT("title")}
        </Link>
        <ChevronRight className="size-3.5" />
        <span className="text-foreground">{org.name}</span>
      </nav>
      <OrgDetailView org={org} currentUserId={user.id} />
    </PageContainer>
  );
}
