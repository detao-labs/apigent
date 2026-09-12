"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button, ConfirmDialog } from "@apigent/ui";
import { Ban, CircleCheck, Trash2 } from "lucide-react";

export interface UserActionsProps {
  userId: string;
  userName: string;
  disabled: boolean;
  /** 目标账号就是当前登录的管理员本人 */
  isSelf: boolean;
}

/** 接口错误码 → 文案 key（见 admin/users.ts 的 AdminMemberErrorCode）。 */
const ERROR_KEY = {
  "last-admin": "errors.lastAdmin",
  "owns-organizations": "errors.ownsOrganizations",
  "self-not-allowed": "errors.selfNotAllowed",
  "user-not-found": "errors.notFound",
} as const;

export function UserActions({ userId, userName, disabled, isSelf }: UserActionsProps) {
  const t = useTranslations("users");
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  function toastError(err: unknown) {
    const code = (err as { error?: string } | null)?.error;
    const key = code ? ERROR_KEY[code as keyof typeof ERROR_KEY] : undefined;
    toast.error(key ? t(key) : t("errors.generic"));
  }

  async function toggleDisabled() {
    setBusy(true);
    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disabled: !disabled }),
      });
      if (res.ok) {
        toast.success(disabled ? t("enabled") : t("disabled"));
        router.refresh();
        return;
      }
      toastError(await res.json().catch(() => null));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      const res = await fetch(`/api/users/${userId}`, { method: "DELETE" });
      if (res.ok) {
        toast.success(t("deleted"));
        setDeleteOpen(false);
        router.refresh();
        return;
      }
      toastError(await res.json().catch(() => null));
    } finally {
      setBusy(false);
      setDeleteOpen(false);
    }
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={busy || isSelf}
        title={isSelf ? t("errors.selfNotAllowed") : undefined}
        onClick={toggleDisabled}
      >
        {disabled ? <CircleCheck className="size-3.5" /> : <Ban className="size-3.5" />}
        {disabled ? t("enable") : t("disable")}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={busy || isSelf}
        title={isSelf ? t("errors.selfNotAllowed") : undefined}
        className="text-destructive hover:text-destructive"
        onClick={() => setDeleteOpen(true)}
      >
        <Trash2 className="size-3.5" />
        {t("delete")}
      </Button>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("delete")}
        description={t("deleteConfirm", { name: userName })}
        confirmText={t("delete")}
        cancelText={t("cancel")}
        destructive
        loading={busy}
        onConfirm={remove}
      />
    </div>
  );
}
