"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Button,
  buttonVariants,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@apigent/ui";
import { ExternalLink, Pencil } from "lucide-react";
import Link from "next/link";
import { EditEntityDialog } from "@/components/edit-entity-dialog";
import type { OrgSummary } from "@/services/orgs";

export function OrgsTable({ orgs }: { orgs: OrgSummary[] }) {
  const t = useTranslations("orgs");
  const router = useRouter();
  const [editingOrg, setEditingOrg] = React.useState<OrgSummary | null>(null);
  const [saving, setSaving] = React.useState(false);

  async function saveOrg(input: { name: string; description: string }) {
    if (!editingOrg) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/orgs/${editingOrg.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error(`save failed: ${res.status}`);
      toast.success(t("saved"));
      setEditingOrg(null);
      router.refresh();
    } catch {
      toast.error(t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50 hover:bg-muted/50">
            <TableHead>{t("table.name")}</TableHead>
            <TableHead className="text-right">{t("table.members")}</TableHead>
            <TableHead className="text-right">{t("table.repos")}</TableHead>
            <TableHead className="text-right">{t("table.actions")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orgs.map((org) => (
            <TableRow
              key={org.id}
              className="cursor-pointer"
              onClick={() => router.push(`/repos?org=${org.id}`)}
            >
              <TableCell className="font-medium">{org.name}</TableCell>
              <TableCell className="text-right tabular-nums">
                {org.memberCount}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {org.repoCount}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingOrg(org);
                    }}
                  >
                    <Pencil className="size-3" />
                    {t("edit")}
                  </Button>
                  <Link
                    href={`/repos?org=${org.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className={buttonVariants({ variant: "ghost", size: "sm" })}
                  >
                    <ExternalLink className="size-3" />
                    {t("table.viewRepos")}
                  </Link>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <EditEntityDialog
        open={editingOrg !== null}
        onOpenChange={(open) => !open && setEditingOrg(null)}
        title={t("editTitle")}
        nameLabel={t("nameLabel")}
        namePlaceholder={t("namePlaceholder")}
        descriptionLabel={t("descriptionLabel")}
        descriptionPlaceholder={t("descriptionPlaceholder")}
        saveLabel={t("save")}
        cancelLabel={t("cancel")}
        initialName={editingOrg?.name ?? ""}
        initialDescription={editingOrg?.description ?? ""}
        saving={saving}
        onSave={saveOrg}
      />
    </>
  );
}
