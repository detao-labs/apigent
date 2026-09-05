"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import Link from "next/link";
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
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  buttonVariants,
} from "@apigent/ui";
import {
  Building2,
  ExternalLink,
  FolderGit2,
  Lock,
  Plus,
  Settings,
  Trash2,
  Users,
} from "lucide-react";
import type { OrgDetail, OrgMemberRole } from "@/services/orgs";

const ROLE_BADGE: Record<OrgMemberRole, string> = {
  org_owner: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
  org_admin: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  org_member: "bg-muted text-muted-foreground",
};

export function OrgDetailView({
  org,
  currentUserId,
}: {
  org: OrgDetail;
  currentUserId: string;
}) {
  const router = useRouter();
  const t = useTranslations("orgs.detail");
  const orgsT = useTranslations("orgs");
  const [tab, setTab] = React.useState<"overview" | "members" | "repos" | "settings">(
    "overview",
  );
  const canManage = org.myRole === "org_owner" || org.myRole === "org_admin";
  const isOwner = org.myRole === "org_owner";

  // invite
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState<"org_admin" | "org_member">("org_member");
  const [sending, setSending] = React.useState(false);

  // remove
  const [removeTarget, setRemoveTarget] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  // settings
  const [name, setName] = React.useState(org.name);
  const [desc, setDesc] = React.useState(org.description ?? "");
  const [saving, setSaving] = React.useState(false);

  // transfer
  const [transferOpen, setTransferOpen] = React.useState(false);
  const [targetUserId, setTargetUserId] = React.useState("");

  async function changeRole(userId: string, nextRole: OrgMemberRole) {
    const res = await fetch(`/api/orgs/${org.id}/members/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: nextRole }),
    });
    if (!res.ok) {
      toast.error(t("roleUpdateFailed"));
      return;
    }
    toast.success(t("roleUpdated"));
    router.refresh();
  }

  async function sendInvite() {
    setSending(true);
    const res = await fetch(`/api/orgs/${org.id}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, role }),
    });
    setSending(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      if (data.error === "user-not-found") toast.error(t("userNotFound"));
      else if (data.error === "already-member") toast.error(t("alreadyMember"));
      else toast.error(t("inviteFailed"));
      return;
    }
    toast.success(t("inviteSuccess"));
    setInviteOpen(false);
    setEmail("");
    router.refresh();
  }

  async function doRemove() {
    if (!removeTarget) return;
    setBusy(true);
    const res = await fetch(`/api/orgs/${org.id}/members/${removeTarget}`, {
      method: "DELETE",
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(t("removeFailed"));
      return;
    }
    toast.success(t("removed"));
    setRemoveTarget(null);
    router.refresh();
  }

  async function saveSettings() {
    setSaving(true);
    const res = await fetch(`/api/orgs/${org.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description: desc }),
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(t("saveFailed"));
      return;
    }
    toast.success(t("saved"));
    router.refresh();
  }

  async function doTransfer() {
    if (!targetUserId) return;
    setBusy(true);
    const res = await fetch(`/api/orgs/${org.id}/transfer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetUserId }),
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(t("inviteFailed"));
      return;
    }
    toast.success(t("transferBtn"));
    setTransferOpen(false);
    router.refresh();
  }

  const tabs = [
    { key: "overview" as const, label: t("tabs.overview"), icon: Building2 },
    { key: "members" as const, label: t("tabs.members"), icon: Users },
    { key: "repos" as const, label: t("tabs.repos"), icon: FolderGit2 },
    { key: "settings" as const, label: t("tabs.settings"), icon: Settings },
  ];

  const rawName = (id: string) => {
    const m = org.members.find((x) => x.userId === id);
    return m ? (id === currentUserId ? `${m.name} ${t("you")}` : m.name) : "—";
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground text-lg font-bold">
            {org.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{org.name}</h1>
            <p className="text-sm text-muted-foreground">
              {org.description || " "}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canManage && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setInviteOpen(true)}
            >
              <Plus className="size-4" />
              {t("invite")}
            </Button>
          )}
        </div>
      </div>

      <div className="flex gap-1 border-b">
        {tabs.map((tabItem) => (
          <button
            key={tabItem.key}
            type="button"
            onClick={() => setTab(tabItem.key)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px ${
              tab === tabItem.key
                ? "border-primary font-medium text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <tabItem.icon className="size-4" />
            {tabItem.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="space-y-4">
          {org.description && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{t("description")}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{org.description}</p>
              </CardContent>
            </Card>
          )}
          <div className="grid gap-4 md:grid-cols-3">
            <StatCard icon={<Building2 className="size-4" />} label={t("statsRepos")} value={org.repos.length} />
            <StatCard icon={<Users className="size-4" />} label={t("statsMembers")} value={org.members.length} />
            <StatCard
              icon={<FolderGit2 className="size-4" />}
              label={t("statsEndpoints")}
              value={org.repos.reduce((sum, r) => sum + r.endpointCount, 0)}
            />
          </div>
        </div>
      )}

      {tab === "members" && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base">{t("membersTitle")}</CardTitle>
            {canManage && (
              <Button type="button" variant="outline" size="sm" onClick={() => setInviteOpen(true)}>
                <Plus className="size-3.5" />
                {t("invite")}
              </Button>
            )}
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead>{t("membersTitle")}</TableHead>
                  <TableHead>{t("inviteEmail")}</TableHead>
                  <TableHead>{t("inviteRole")}</TableHead>
                  <TableHead className="text-right">{t("remove")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {org.members.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      {t("membersEmpty")}
                    </TableCell>
                  </TableRow>
                ) : (
                  org.members.map((m) => {
                    const isOwnerRow = m.role === "org_owner";
                    return (
                      <TableRow key={m.userId}>
                        <TableCell className="font-medium">
                          {rawName(m.userId)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{m.email}</TableCell>
                        <TableCell>
                          {isOwnerRow ? (
                            <span className="text-xs text-muted-foreground">{t("ownerNote")}</span>
                          ) : canManage ? (
                            <select
                              value={m.role}
                              onChange={(e) => changeRole(m.userId, e.target.value as OrgMemberRole)}
                              className="rounded-md border bg-transparent px-2 py-1 text-sm"
                            >
                              <option value="org_admin">{t("admin")}</option>
                              <option value="org_member">{t("member")}</option>
                            </select>
                          ) : (
                            <Badge className={ROLE_BADGE[m.role]}>{t(m.role === "org_admin" ? "admin" : "member")}</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {!isOwnerRow && canManage ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => setRemoveTarget(m.userId)}
                              className="text-destructive hover:text-destructive"
                            >
                              <Trash2 className="size-3.5" />
                              {t("remove")}
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {tab === "repos" && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base">{t("reposTitle")}</CardTitle>
            <Link
              href={`/repos/new`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <Plus className="size-3.5" />
              {t("createRepo")}
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {org.repos.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                {t("reposEmpty")}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead>{t("name")}</TableHead>
                    <TableHead className="text-right">{t("statsEndpoints")}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {org.repos.map((r) => (
                    <TableRow key={r.id} className="cursor-pointer" onClick={() => router.push(`/repos/${r.id}`)}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.endpointCount}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link
                          href={`/repos/${r.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className={buttonVariants({ variant: "ghost", size: "sm" })}
                        >
                          <ExternalLink className="size-3" />
                          {t("detail")}
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "settings" && (
        <div className="max-w-xl space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("settingsTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">{t("name")}</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">{t("description")}</label>
                <Textarea value={desc} rows={3} onChange={(e) => setDesc(e.target.value)} />
              </div>
              <div className="flex justify-end">
                <Button type="button" onClick={saveSettings} disabled={saving}>
                  {t("save")}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-destructive/40">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-destructive">
                <Lock className="size-4" />
                {t("transferTitle")}
              </CardTitle>
              <p className="text-sm text-muted-foreground">{t("transferDesc")}</p>
            </CardHeader>
            <CardContent>
              {isOwner ? (
                <div className="flex items-end gap-2">
                  <div className="flex-1 space-y-1.5">
                    <label className="text-sm font-medium">{t("newOwner")}</label>
                    <select
                      value={targetUserId}
                      onChange={(e) => setTargetUserId(e.target.value)}
                      className="w-full rounded-md border bg-transparent px-2 py-1.5 text-sm"
                    >
                      <option value="">—</option>
                      {org.members
                        .filter((m) => m.role !== "org_owner")
                        .map((m) => (
                          <option key={m.userId} value={m.userId}>
                            {m.name} ({m.email})
                          </option>
                        ))}
                    </select>
                  </div>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={!targetUserId}
                    onClick={() => setTransferOpen(true)}
                  >
                    {t("transferBtn")}
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t("ownerNote")}</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* 邀请对话框 */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("invite")}</DialogTitle>
            <DialogDescription>{t("inviteEmail")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">{t("inviteEmail")}</label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="teammate@example.com"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">{t("inviteRole")}</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as "org_admin" | "org_member")}
                className="w-full rounded-md border bg-transparent px-2 py-1.5 text-sm"
              >
                <option value="org_member">{t("member")}</option>
                <option value="org_admin">{t("admin")}</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setInviteOpen(false)}>
              {orgsT("cancel")}
            </Button>
            <Button type="button" onClick={sendInvite} disabled={sending}>
              {t("sendInvite")}
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
        cancelText={orgsT("cancel")}
        destructive
        loading={busy}
        onConfirm={doRemove}
      />

      <ConfirmDialog
        open={transferOpen}
        onOpenChange={setTransferOpen}
        title={t("transferTitle")}
        description={t("transferDesc")}
        confirmText={t("transferBtn")}
        cancelText={orgsT("cancel")}
        destructive
        loading={busy}
        onConfirm={doTransfer}
      />
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex size-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
          {icon}
        </div>
        <div>
          <div className="text-2xl font-bold tabular-nums">{value}</div>
          <div className="text-sm text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}
