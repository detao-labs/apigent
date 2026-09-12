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
} from "@apigent/ui";
import { Plus, ShieldCheck, Trash2 } from "lucide-react";

export interface AdminMemberView {
  userId: string;
  name: string;
  email: string;
  role: string;
  grantedAtLabel: string;
  grantedByLabel: string;
}

/** 接口返回的错误码 → 文案 key。 */
const ERROR_KEY: Record<
  string,
  "userNotFound" | "alreadyAdmin" | "lastAdmin" | "selfNotAllowed" | "generic"
> = {
  "user-not-found": "userNotFound",
  "already-admin": "alreadyAdmin",
  "last-admin": "lastAdmin",
  "self-not-allowed": "selfNotAllowed",
};

export function AdminsView({
  members,
  currentUserId,
}: {
  members: AdminMemberView[];
  currentUserId: string;
}) {
  const t = useTranslations("admins");
  const common = useTranslations("common");
  const router = useRouter();

  const [grantOpen, setGrantOpen] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = React.useState<AdminMemberView | null>(null);

  async function grant(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (res.ok) {
        toast.success(t("grantSuccess"));
        setGrantOpen(false);
        setEmail("");
        router.refresh();
        return;
      }
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      const key = data?.error ? ERROR_KEY[data.error] : undefined;
      setError(key ? t(`errors.${key}`) : t("errors.generic"));
    } catch {
      setError(t("errors.generic"));
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!revokeTarget) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admins/${revokeTarget.userId}`, { method: "DELETE" });
      if (res.ok) {
        toast.success(t("revokeSuccess"));
        setRevokeTarget(null);
        router.refresh();
        return;
      }
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      const key = data?.error ? ERROR_KEY[data.error] : undefined;
      toast.error(key ? t(`errors.${key}`) : t("errors.generic"));
    } catch {
      toast.error(t("errors.generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card>
        <CardContent className="p-0">
          <div className="flex items-center justify-between border-b p-4">
            <span className="text-sm text-muted-foreground">
              {members.length} · {t("colUser")}
            </span>
            <Button type="button" size="sm" onClick={() => setGrantOpen(true)}>
              <Plus className="size-3.5" />
              {t("grant")}
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead>{t("colUser")}</TableHead>
                <TableHead>{t("colRole")}</TableHead>
                <TableHead>{t("colGrantedAt")}</TableHead>
                <TableHead>{t("colGrantedBy")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => (
                <TableRow key={member.userId}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          {member.name}
                          {member.userId === currentUserId ? (
                            <span className="ml-1 text-muted-foreground">{t("you")}</span>
                          ) : null}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">{member.email}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge className="bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                      <ShieldCheck className="mr-1 size-3" />
                      {member.role}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {member.grantedAtLabel}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {member.grantedByLabel}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      // 不能移除自己的管理员（服务端同样会拒绝）
                      disabled={member.userId === currentUserId}
                      title={member.userId === currentUserId ? t("selfRevoke") : undefined}
                      onClick={() => setRevokeTarget(member)}
                    >
                      <Trash2 className="size-3.5" />
                      {t("revoke")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={grantOpen} onOpenChange={setGrantOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("grantTitle")}</DialogTitle>
            <DialogDescription>{t("grantDesc")}</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={grant}>
            <div className="space-y-2">
              <label htmlFor="admin-email" className="text-sm font-medium">
                {t("email")}
              </label>
              <Input
                id="admin-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setGrantOpen(false)}>
                {common("cancel")}
              </Button>
              <Button type="submit" disabled={busy}>
                {t("grantSubmit")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        title={t("revoke")}
        description={t("revokeConfirm", { name: revokeTarget?.name ?? "" })}
        confirmText={t("revoke")}
        cancelText={common("cancel")}
        destructive
        loading={busy}
        onConfirm={revoke}
      />
    </>
  );
}
