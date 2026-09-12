"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@apigent/ui";
import { Plus, ShieldAlert, Trash2 } from "lucide-react";
import type { RepoRole } from "@apigent/server/authz";
import type {
  RepoMemberRow,
  RepoMembersView as RepoMembersViewData,
} from "@/services/repo-members";

const ROLE_BADGE: Record<RepoRole, string> = {
  repo_admin: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  repo_editor: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  repo_viewer: "bg-muted text-muted-foreground",
};

const ROLE_KEY = {
  repo_admin: "roleAdmin",
  repo_editor: "roleEditor",
  repo_viewer: "roleViewer",
} as const;

const ORG_ROLE_KEY = {
  org_owner: "orgOwner",
  org_admin: "orgAdmin",
  org_member: "orgMember",
} as const;

export function RepoMembersView({ view }: { view: RepoMembersViewData }) {
  const router = useRouter();
  const t = useTranslations("repos.detail.members");
  const detailT = useTranslations("repos.detail");

  const [addOpen, setAddOpen] = React.useState(false);
  const [targetUserId, setTargetUserId] = React.useState("");
  const [role, setRole] = React.useState<RepoRole>("repo_editor");
  const [saving, setSaving] = React.useState(false);
  const [removeTarget, setRemoveTarget] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const inherited = view.members.filter((m) => m.overrideRole === null);
  const overridden = view.members.filter((m) => m.overrideRole !== null);
  const candidates = inherited.filter((m) => m.assignableRoles.length > 0);

  const roleLabel = (value: RepoRole) => t(ROLE_KEY[value]);
  const orgRoleLabel = (member: RepoMemberRow) =>
    member.orgRole ? t(ORG_ROLE_KEY[member.orgRole]) : t("orgRoleNone");

  function reportError(code: string | undefined) {
    if (code === "user-not-found") toast.error(t("errorUserNotFound"));
    else if (code === "not-org-member") toast.error(t("errorNotOrgMember"));
    else if (code === "already-overridden") toast.error(t("errorAlreadyOverridden"));
    else if (code === "override-not-found") toast.error(t("errorOverrideNotFound"));
    else if (code === "override-not-effective") toast.error(t("errorOverrideNotEffective"));
    else if (code === "forbidden") toast.error(t("errorForbidden"));
    else toast.error(t("errorGeneric"));
  }

  function pickCandidate(userId: string) {
    setTargetUserId(userId);
    const candidate = candidates.find((m) => m.userId === userId);
    if (candidate?.assignableRoles.length) setRole(candidate.assignableRoles[0]);
  }

  async function addOverride() {
    if (!targetUserId) return;
    setSaving(true);
    const res = await fetch(`/api/repos/${view.repoId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: targetUserId, role }),
    });
    setSaving(false);
    if (!res.ok) {
      reportError((await res.json().catch(() => ({}))).error);
      return;
    }
    toast.success(t("added"));
    setAddOpen(false);
    setTargetUserId("");
    router.refresh();
  }

  async function changeRole(userId: string, nextRole: RepoRole) {
    const res = await fetch(`/api/repos/${view.repoId}/members/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: nextRole }),
    });
    if (!res.ok) {
      reportError((await res.json().catch(() => ({}))).error);
      return;
    }
    toast.success(t("updated"));
    router.refresh();
  }

  async function revoke() {
    if (!removeTarget) return;
    setBusy(true);
    const res = await fetch(`/api/repos/${view.repoId}/members/${removeTarget}`, {
      method: "DELETE",
    });
    setBusy(false);
    if (!res.ok) {
      reportError((await res.json().catch(() => ({}))).error);
      return;
    }
    toast.success(t("removed"));
    setRemoveTarget(null);
    router.refresh();
  }

  const selectedCandidate = candidates.find((m) => m.userId === targetUserId);
  const roleOptions = selectedCandidate?.assignableRoles ?? [];

  return (
    <div className="space-y-6">
      {!view.canManage && (
        <div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <p>{t("readOnlyNote")}</p>
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <div>
            <CardTitle className="text-base">{t("overrideTitle")}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{t("overrideDesc")}</p>
          </div>
          {view.canManage && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setAddOpen(true)}
              disabled={candidates.length === 0}
            >
              <Plus className="size-3.5" />
              {t("addOverride")}
            </Button>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead>{t("colName")}</TableHead>
                <TableHead>{t("colEmail")}</TableHead>
                <TableHead>{t("colOrgRole")}</TableHead>
                <TableHead>{t("colInheritedRole")}</TableHead>
                <TableHead>{t("colOverrideRole")}</TableHead>
                <TableHead className="text-right">{t("colActions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {overridden.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    {t("overrideEmpty")}
                  </TableCell>
                </TableRow>
              ) : (
                overridden.map((m) => {
                  // 组织角色后来变了时，旧的覆盖行可能不再"有效"（等于继承角色）。
                  // 仍把当前值放进选项里，避免下拉框显示成别的角色；
                  // 这类行可以改到更高角色，或直接撤销。
                  const options =
                    m.overrideRole && !m.assignableRoles.includes(m.overrideRole)
                      ? [m.overrideRole, ...m.assignableRoles]
                      : m.assignableRoles;
                  return (
                    <TableRow key={m.userId}>
                      <TableCell className="font-medium">{m.name}</TableCell>
                      <TableCell className="text-muted-foreground">{m.email}</TableCell>
                      <TableCell>
                        {m.isOrgMember ? (
                          <span className="text-sm text-muted-foreground">{orgRoleLabel(m)}</span>
                        ) : (
                          <Badge variant="outline" className="text-xs">
                            {t("notOrgMember")}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge className={ROLE_BADGE[m.inheritedRole ?? "repo_viewer"]}>
                          {m.inheritedRole ? roleLabel(m.inheritedRole) : t("inheritedNone")}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {view.canManage && options.length > 0 ? (
                          <select
                            value={m.overrideRole ?? ""}
                            onChange={(e) => changeRole(m.userId, e.target.value as RepoRole)}
                            className="rounded-md border bg-transparent px-2 py-1 text-sm"
                          >
                            {options.map((option) => (
                              <option key={option} value={option}>
                                {roleLabel(option)}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <Badge className={ROLE_BADGE[m.overrideRole ?? "repo_viewer"]}>
                            {roleLabel(m.overrideRole ?? "repo_viewer")}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {view.canManage && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setRemoveTarget(m.userId)}
                          >
                            <Trash2 className="size-3.5" />
                            {t("revoke")}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t("inheritedTitle")}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{t("inheritedDesc")}</p>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead>{t("colName")}</TableHead>
                <TableHead>{t("colEmail")}</TableHead>
                <TableHead>{t("colOrgRole")}</TableHead>
                <TableHead>{t("colEffectiveRole")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {inherited.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                    {t("inheritedEmpty")}
                  </TableCell>
                </TableRow>
              ) : (
                inherited.map((m) => (
                  <TableRow key={m.userId}>
                    <TableCell className="font-medium">{m.name}</TableCell>
                    <TableCell className="text-muted-foreground">{m.email}</TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">{orgRoleLabel(m)}</span>
                    </TableCell>
                    <TableCell>
                      <Badge className={ROLE_BADGE[m.effectiveRole]}>
                        {roleLabel(m.effectiveRole)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("addOverride")}</DialogTitle>
            <DialogDescription>{t("addOverrideDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">{t("selectMember")}</label>
              <select
                value={targetUserId}
                onChange={(e) => pickCandidate(e.target.value)}
                className="w-full rounded-md border bg-transparent px-2 py-1.5 text-sm"
              >
                <option value="">{t("selectMemberPlaceholder")}</option>
                {candidates.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name} ({m.email})
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">{t("selectRole")}</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as RepoRole)}
                disabled={!selectedCandidate}
                className="w-full rounded-md border bg-transparent px-2 py-1.5 text-sm disabled:opacity-50"
              >
                {roleOptions.map((option) => (
                  <option key={option} value={option}>
                    {roleLabel(option)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setAddOpen(false)}>
              {detailT("cancel")}
            </Button>
            <Button type="button" onClick={addOverride} disabled={saving || !targetUserId}>
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        title={t("revoke")}
        description={t("revokeConfirm")}
        confirmText={t("revoke")}
        cancelText={detailT("cancel")}
        destructive
        loading={busy}
        onConfirm={revoke}
      />
    </div>
  );
}
