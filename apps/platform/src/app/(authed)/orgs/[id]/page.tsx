import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { listOperationLogs } from "@apigent/server/audit";
import { OperationLogTable } from "@/components/operation-log-table";
import { OrgDetailView } from "@/components/org-detail-view";
import { OrgForbidden, OrgNotFound } from "@/components/org-state";
import { PageContainer } from "@/components/page-container";
import { requireUser } from "@/services/auth";
import { loadOrgForPage } from "@/services/orgs";

export default async function OrgDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const orgsT = await getTranslations("orgs");

  const { status, org } = await loadOrgForPage(id, user.id);
  if (status === "forbidden") return <OrgForbidden />;
  if (status === "not-found" || !org) return <OrgNotFound />;

  // 组织审计页只读；仓库成员变更也会带上 organizationId，所以这里能一并看到。
  const audit = await listOperationLogs({ organizationId: id, limit: 50 });

  return (
    <PageContainer className="space-y-6">
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link href="/orgs" className="hover:text-foreground">
          {orgsT("title")}
        </Link>
        <ChevronRight className="size-3.5" />
        <span className="text-foreground">{org.name}</span>
      </nav>
      <OrgDetailView
        org={org}
        currentUserId={user.id}
        auditSlot={<OperationLogTable entries={audit.items} />}
      />
    </PageContainer>
  );
}
