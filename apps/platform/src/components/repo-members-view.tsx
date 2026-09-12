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
import { REPO_ROLES, type RepoRole } from "@apigent/server/authz";
import type { RepoMembersView as RepoMembersViewData } from "@/services/repo-members";

const ROLE_BADGE: Record<RepoRole, string> = {
  repo_owner: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
  repo_admin: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  repo_member: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  repo_viewer: "bg-muted text-muted-foreground",
};

const ROLE_KEY = {
  repo_owner: "roleOwner",
  repo_admin: "roleAdmin",
  repo_member: "roleMember",
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
  const [role, setRole] = React.useState<RepoRole>("repo_member");
  const [saving, setSaving] = React.useState(false);
  const [removeTarget, setRemoveTarget] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const roleLabel = (value: RepoRole) => t(ROLE_KEY[value]);
  const orgRoleLabel = (orgRole: string | null) =>
    orgRole ? t(ORG_ROLE_KEY[orgRole as keyof typeof ORG_ROLE_KEY]) : t("orgRoleNone");

  function reportError(code: string | undefined) {
    if (code === "user-not-found") toast.error(t("errorUserNotFound"));
    else if (code === "not-org-member") toast.error(t("errorNotOrgMember"));
    else if (code === "already-member") toast.error(t("errorAlreadyMember"));
    else if (code === "member-not-found") toast.error(t("errorMemberNotFound"));
    else if (code === "forbidden") toast.error(t("errorForbidden"));
    else toast.error(t("errorGeneric"));
  }

  async function addMember() {
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

  async function removeMember() {
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

  const selectedCandidate = view.candidates.find((c) => c.userId === targetUserId);
  const roleOptions = REPO_ROLES;

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
            <CardTitle className="text-base">{t("title")}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{t("sub")}</p>
          </div>
          {view.canManage && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setAddOpen(true)}
              disabled={view.candidates.length === 0}
            >
              <Plus className="size-3.5" />
              {t("addMember")}
            </Button>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead>{t("colMember")}</TableHead>
                <TableHead>{t("colOrgRole")}</TableHead>
                <TableHead>{t("colSource")}</TableHead>
                <TableHead>{t("colRepoRole")}</TableHead>
                <TableHead className="text-right">{t("colActions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.members.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    {t("membersEmpty")}
                  </TableCell>
                </TableRow>
              ) : (
                view.members.map((m) => (
                  <TableRow key={m.userId}>
                    <TableCell>
                      <div className="font-medium">{m.name}</div>
                      <div className="text-sm text-muted-foreground">{m.email}</div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {orgRoleLabel(m.orgRole)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={m.source === "explicit" ? "secondary" : "outline"}>
                        {m.source === "explicit" ? t("sourceExplicit") : t("sourceImplied")}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {view.canManage && m.source === "explicit" ? (
                        <select
                          value={m.explicitRole ?? ""}
                          onChange={(e) => changeRole(m.userId, e.target.value as RepoRole)}
                          className="rounded-md border bg-transparent px-2 py-1 text-sm"
                        >
                          {REPO_ROLES.map((option) => (
                            <option key={option} value={option}>
                              {roleLabel(option)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <Badge className={ROLE_BADGE[m.effectiveRole]}>
                          {roleLabel(m.effectiveRole)}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {view.canManage && m.source === "explicit" && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setRemoveTarget(m.userId)}
                        >
                          <Trash2 className="size-3.5" />
                          {t("remove")}
                        </Button>
                      )}
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
            <DialogTitle>{t("addMember")}</DialogTitle>
            <DialogDescription>{t("addMemberDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">{t("selectMember")}</label>
              <select
                value={targetUserId}
                onChange={(e) => setTargetUserId(e.target.value)}
                className="w-full rounded-md border bg-transparent px-2 py-1.5 text-sm"
              >
                <option value="">{t("selectMemberPlaceholder")}</option>
                {view.candidates.map((c) => (
                  <option key={c.userId} value={c.userId}>
                    {c.name} ({c.email})
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
              {selectedCandidate?.implied && (
                <p className="text-xs text-muted-foreground">{t("impliedHint")}</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setAddOpen(false)}>
              {detailT("cancel")}
            </Button>
            <Button type="button" onClick={addMember} disabled={saving || !targetUserId}>
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        title={t("remove")}
        description={t("removeConfirm")}
        confirmText={t("remove")}
        cancelText={detailT("cancel")}
        destructive
        loading={busy}
        onConfirm={removeMember}
      />
    </div>
  );
}
