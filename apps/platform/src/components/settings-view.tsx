"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
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
} from "@apigent/ui";
import {
  ArrowLeft,
  Check,
  Globe,
  LayoutDashboard,
  KeyRound,
  Monitor,
  Moon,
  Palette,
  Sun,
  User,
  SlidersHorizontal,
} from "lucide-react";
import { CopyButton } from "@/components/copy-button";
import { useTheme } from "@/hooks/use-theme";
import { formatRelativeTime } from "@/lib/format";
import { curlSnippet, mcpConfigSnippet, useMcpServiceUrl } from "@/hooks/use-mcp-service-url";
import type { SelectableRepository, SecretKeySummary } from "@apigent/server/keys";

const SECTIONS = ["account", "keys", "preferences", "notifications"] as const;
type Section = (typeof SECTIONS)[number];

const SECTION_ICONS: Record<Section, typeof User> = {
  account: User,
  keys: KeyRound,
  preferences: Palette,
  notifications: SlidersHorizontal,
};

export function SettingsView({
  user,
  section,
  keys,
  selectableRepositories,
  mcpPath,
  mcpPublicUrl,
}: {
  user: { name: string; email: string };
  section: Section;
  keys: SecretKeySummary[];
  selectableRepositories: SelectableRepository[];
  mcpPath: string;
  mcpPublicUrl: string;
}) {
  const t = useTranslations("settings");
  const mcpUrl = useMcpServiceUrl(mcpPath, mcpPublicUrl);
  const router = useRouter();

  return (
    <div className="flex min-h-full">
      {/* 桌面端：设置独立左侧菜单 */}
      <aside className="sticky top-14 hidden h-[calc(100svh-3.5rem)] w-60 shrink-0 flex-col overflow-y-auto border-r bg-muted/20 p-3 md:flex">
        <Link href="/" className="flex items-center gap-2 px-2 py-1.5">
          <div className="flex aspect-square size-7 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
            <LayoutDashboard className="size-3.5" />
          </div>
          <span className="text-sm font-semibold">Apigent</span>
        </Link>
        <div className="mb-4" />
        <RailGroup label={t("groups.userInfo")}>
          {SECTIONS.filter((s) => s === "account" || s === "keys").map((s) => (
            <RailItem
              key={s}
              icon={SECTION_ICONS[s]}
              label={t(`sections.${s}`)}
              active={section === s}
              href={`/settings/${s}`}
            />
          ))}
        </RailGroup>
        <RailGroup label={t("groups.prefs")}>
          {SECTIONS.filter((s) => s === "preferences" || s === "notifications").map((s) => (
            <RailItem
              key={s}
              icon={SECTION_ICONS[s]}
              label={t(`sections.${s}`)}
              active={section === s}
              href={`/settings/${s}`}
            />
          ))}
        </RailGroup>
        <div className="mt-auto border-t pt-3">
          <Link
            href="/"
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <ArrowLeft className="size-4" />
            {t("backToDashboard")}
          </Link>
        </div>
      </aside>

      <div className="min-w-0 flex-1 p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground">{t("description")}</p>
        </div>

        {/* 移动端：横向分区切换 */}
        <div className="mb-6 flex gap-2 overflow-x-auto pb-1 md:hidden">
          {SECTIONS.map((s) => (
            <Button
              key={s}
              type="button"
              variant={section === s ? "secondary" : "ghost"}
              size="sm"
              onClick={() => router.push(`/settings/${s}`)}
            >
              {t(`sections.${s}`)}
            </Button>
          ))}
        </div>

        {section === "account" && <AccountPanel user={user} />}
        {section === "keys" && (
          <KeysPanel keys={keys} selectableRepositories={selectableRepositories} mcpUrl={mcpUrl} />
        )}
        {section === "preferences" && <PrefsPanel />}
        {section === "notifications" && <MorePanel />}
      </div>
    </div>
  );
}

function RailGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <p className="px-3 pb-1.5 text-xs font-medium text-muted-foreground">{label}</p>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function RailItem({
  icon: Icon,
  label,
  active,
  href,
}: {
  icon: typeof User;
  label: string;
  active: boolean;
  href: string;
}) {
  return (
    <Link
      href={href}
      className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
        active
          ? "bg-accent font-medium text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
      }`}
    >
      <Icon className="size-4 shrink-0" />
      <span className="truncate">{label}</span>
    </Link>
  );
}

function AccountPanel({ user }: { user: { name: string; email: string } }) {
  const t = useTranslations("settings.profile");
  const pwd = useTranslations("settings.password");
  const common = useTranslations("common");
  const [name, setName] = React.useState(user.name);
  const [email, setEmail] = React.useState(user.email);
  const [saved, setSaved] = React.useState(false);
  const [pwdStatus, setPwdStatus] = React.useState<{
    type: "error" | "success";
    text: string;
  } | null>(null);
  const [cur, setCur] = React.useState("");
  const [next, setNext] = React.useState("");
  const [confirm, setConfirm] = React.useState("");

  function saveProfile() {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function updatePassword() {
    if (!cur) {
      setPwdStatus({ type: "error", text: pwd("errors.currentRequired") });
      return;
    }
    if (next.length < 8) {
      setPwdStatus({ type: "error", text: pwd("errors.weak") });
      return;
    }
    if (next !== confirm) {
      setPwdStatus({ type: "error", text: pwd("errors.mismatch") });
      return;
    }
    setPwdStatus({ type: "success", text: pwd("updated") });
    setCur("");
    setNext("");
    setConfirm("");
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("title")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">{t("avatar")}</label>
            <div className="flex items-center gap-3">
              <Avatar size="lg">
                <AvatarFallback>{user.name.charAt(0).toUpperCase()}</AvatarFallback>
              </Avatar>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled
                title={common("backendPending")}
              >
                {t("changeAvatar")}
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <label htmlFor="profileName" className="text-sm font-medium">
              {t("name")}
            </label>
            <Input id="profileName" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <label htmlFor="profileEmail" className="text-sm font-medium">
              {t("email")}
            </label>
            <Input
              id="profileEmail"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t("emailHint")}</p>
          </div>
          <div className="flex items-center gap-3">
            <Button type="button" onClick={saveProfile}>
              {t("save")}
            </Button>
            {saved && (
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Check className="size-4 text-primary" />
                {t("saved")}
                <span className="text-xs">({t("pending")})</span>
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{pwd("title")}</CardTitle>
          <CardDescription>{pwd("description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="pwdCur" className="text-sm font-medium">
              {pwd("current")}
            </label>
            <Input
              id="pwdCur"
              type="password"
              value={cur}
              onChange={(e) => setCur(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="pwdNew" className="text-sm font-medium">
              {pwd("new")}
            </label>
            <Input
              id="pwdNew"
              type="password"
              placeholder={pwd("newPlaceholder")}
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{pwd("hint")}</p>
          </div>
          <div className="space-y-2">
            <label htmlFor="pwdConfirm" className="text-sm font-medium">
              {pwd("confirm")}
            </label>
            <Input
              id="pwdConfirm"
              type="password"
              placeholder={pwd("confirmPlaceholder")}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-3">
            <Button type="button" onClick={updatePassword}>
              {pwd("update")}
            </Button>
            {pwdStatus && (
              <span
                className={`text-sm ${
                  pwdStatus.type === "success" ? "text-muted-foreground" : "text-destructive"
                }`}
              >
                {pwdStatus.text}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// 客户端组件里只能用类型导入：从 @apigent/server/keys 引值会把 pg 拖进浏览器包
// （CLAUDE.md 的客户端边界规则）。scope 列表因此在这里本地声明一份。
const KEY_SCOPE_OPTIONS = [
  { value: "api:read", labelKey: "create.scopeApiRead" },
  { value: "api:write", labelKey: "create.scopeApiWrite" },
  { value: "mcp:search", labelKey: "create.scopeMcpSearch" },
  { value: "mcp:detail", labelKey: "create.scopeMcpDetail" },
  { value: "mcp:context", labelKey: "create.scopeMcpContext" },
] as const;

const EXPIRY_OPTIONS = [
  { value: 0, labelKey: "create.expiresNever" },
  { value: 30, labelKey: "create.expires30" },
  { value: 90, labelKey: "create.expires90" },
  { value: 365, labelKey: "create.expires365" },
] as const;

/** 把"我有权访问的仓库"按组织分组，供选择器渲染成 org/repo 层级。 */
function groupByOrganization(repos: SelectableRepository[]) {
  const groups = new Map<string, { id: string; name: string; repos: SelectableRepository[] }>();
  for (const repo of repos) {
    const group = groups.get(repo.organizationId) ?? {
      id: repo.organizationId,
      name: repo.organizationName,
      repos: [],
    };
    group.repos.push(repo);
    groups.set(repo.organizationId, group);
  }
  return [...groups.values()];
}

/**
 * 仓库多选器：org/repo 层级展示，**只能勾选仓库**（组织行只做分组与"全选"批量操作）。
 * 组织不承载权限，所以选择结果永远是一串 repo id。
 */
function RepositoryPicker({
  groups,
  selected,
  onToggle,
  onToggleGroup,
  labels,
}: {
  groups: { id: string; name: string; repos: SelectableRepository[] }[];
  selected: string[];
  onToggle: (id: string) => void;
  onToggleGroup: (ids: string[], next: boolean) => void;
  labels: { selectAll: string; empty: string };
}) {
  if (groups.length === 0) {
    return <p className="text-sm text-muted-foreground">{labels.empty}</p>;
  }
  return (
    <div className="max-h-64 space-y-3 overflow-y-auto rounded-md border p-3">
      {groups.map((group) => {
        const ids = group.repos.map((r) => r.id);
        const allSelected = ids.every((id) => selected.includes(id));
        return (
          <div key={group.id} className="space-y-1.5">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                className="size-4 rounded border"
                checked={allSelected}
                onChange={() => onToggleGroup(ids, !allSelected)}
              />
              {group.name}
              <button
                type="button"
                className="text-xs font-normal text-muted-foreground hover:text-foreground"
                onClick={() => onToggleGroup(ids, true)}
              >
                {labels.selectAll}
              </button>
            </label>
            <div className="ml-6 space-y-1">
              {group.repos.map((repo) => (
                <label key={repo.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 rounded border"
                    checked={selected.includes(repo.id)}
                    onChange={() => onToggle(repo.id)}
                  />
                  {repo.name}
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function KeysPanel({
  keys,
  selectableRepositories,
  mcpUrl,
}: {
  keys: SecretKeySummary[];
  selectableRepositories: SelectableRepository[];
  mcpUrl: string;
}) {
  const keysT = useTranslations("keys");
  const common = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();

  const [generateOpen, setGenerateOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [scopes, setScopes] = React.useState<string[]>(["mcp:search", "mcp:detail"]);
  const [expiresInDays, setExpiresInDays] = React.useState<number>(0);
  const [submitting, setSubmitting] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [rawKey, setRawKey] = React.useState<string | null>(null);
  const [scopeMode, setScopeMode] = React.useState<"all" | "selected">("all");
  const [selectedRepoIds, setSelectedRepoIds] = React.useState<string[]>([]);
  const [editing, setEditing] = React.useState<SecretKeySummary | null>(null);
  const [editRepoIds, setEditRepoIds] = React.useState<string[]>([]);
  const [savingScope, setSavingScope] = React.useState(false);
  const orgGroups = React.useMemo(
    () => groupByOrganization(selectableRepositories),
    [selectableRepositories],
  );

  const toggleId = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  const toggleGroup = (list: string[], ids: string[], next: boolean) =>
    next ? [...new Set([...list, ...ids])] : list.filter((id) => !ids.includes(id));

  function openGenerate() {
    setName("");
    setScopeMode("all");
    setSelectedRepoIds([]);
    setFormError(null);
    setGenerateOpen(true);
  }

  function openEdit(key: SecretKeySummary) {
    setEditing(key);
    setEditRepoIds(key.repositoryIds);
  }

  async function saveScope(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;
    setSavingScope(true);
    try {
      const res = await fetch(`/api/keys/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repositoryIds: editRepoIds }),
      });
      if (res.ok) {
        toast.success(keysT("scope.saved"));
        setEditing(null);
        router.refresh();
        return;
      }
      toast.error(keysT("scope.failed"));
    } finally {
      setSavingScope(false);
    }
  }
  const [revokeTarget, setRevokeTarget] = React.useState<SecretKeySummary | null>(null);
  const [revoking, setRevoking] = React.useState(false);

  function toggleScope(value: string) {
    setScopes((prev) =>
      prev.includes(value) ? prev.filter((s) => s !== value) : [...prev, value],
    );
  }

  async function generate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          scopes,
          expiresInDays: expiresInDays || null,
          // 空数组 = 不限制（沿用用户全部可访问仓库）
          repositoryIds: scopeMode === "all" ? [] : selectedRepoIds,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { rawKey: string };
        setGenerateOpen(false);
        setName("");
        setRawKey(data.rawKey);
        router.refresh();
        return;
      }
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setFormError(
        data?.error === "invalid-name"
          ? keysT("errors.invalid-name")
          : data?.error === "invalid-scopes"
            ? keysT("errors.invalid-scopes")
            : keysT("create.failed"),
      );
    } catch {
      setFormError(keysT("create.failed"));
    } finally {
      setSubmitting(false);
    }
  }

  async function revoke() {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      const res = await fetch(`/api/keys/${revokeTarget.id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success(keysT("revoked"));
        router.refresh();
      } else {
        toast.error(keysT("revokeFailed"));
      }
    } finally {
      setRevoking(false);
      setRevokeTarget(null);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">{keysT("title")}</CardTitle>
            <CardDescription>{keysT("description")}</CardDescription>
          </div>
          <Button type="button" onClick={openGenerate}>
            <KeyRound className="size-4" />
            {keysT("generate")}
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {keys.length === 0 ? (
            <div className="flex flex-col items-center py-12 text-center">
              <KeyRound className="mb-4 size-12 text-muted-foreground/50" />
              <h3 className="mb-1 text-lg font-semibold">{keysT("empty.title")}</h3>
              <p className="mb-6 text-muted-foreground">{keysT("empty.description")}</p>
              <Button type="button" onClick={openGenerate}>
                <KeyRound className="size-4" />
                {keysT("generate")}
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead>{keysT("table.name")}</TableHead>
                  <TableHead>{keysT("table.prefix")}</TableHead>
                  <TableHead>{keysT("table.scopes")}</TableHead>
                  <TableHead>{keysT("table.scope")}</TableHead>
                  <TableHead>{keysT("table.lastUsed")}</TableHead>
                  <TableHead>{keysT("table.expires")}</TableHead>
                  <TableHead className="text-right">{keysT("table.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((key) => (
                  <TableRow key={key.id}>
                    <TableCell className="font-medium">{key.name}</TableCell>
                    <TableCell>
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                        {key.keyPrefix}…
                      </code>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {key.scopes.map((scope) => (
                          <Badge key={scope} variant="secondary" className="text-xs">
                            {scope}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      <button
                        type="button"
                        className="text-left underline-offset-4 hover:underline"
                        onClick={() => openEdit(key)}
                      >
                        {key.repositoryIds.length === 0
                          ? keysT("scope.allShort")
                          : keysT("scope.count", { count: key.repositoryIds.length })}
                      </button>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {key.lastUsedAt ? formatRelativeTime(key.lastUsedAt, locale) : keysT("never")}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {key.expiresAt ? formatRelativeTime(key.expiresAt, locale) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setRevokeTarget(key)}
                        className="text-destructive"
                      >
                        {keysT("revoke")}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{keysT("examples.title")}</CardTitle>
          <CardDescription>{keysT("examples.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-sm font-medium">{keysT("examples.mcp")}</p>
              <CopyButton text={mcpConfigSnippet(mcpUrl)} label={keysT("examples.copy")} />
            </div>
            <pre className="overflow-x-auto rounded-lg bg-muted/60 p-3 text-xs leading-relaxed">
              {mcpConfigSnippet(mcpUrl)}
            </pre>
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-sm font-medium">{keysT("examples.rest")}</p>
              <CopyButton text={curlSnippet(mcpUrl)} label={keysT("examples.copy")} />
            </div>
            <pre className="overflow-x-auto rounded-lg bg-muted/60 p-3 text-xs leading-relaxed">
              {curlSnippet(mcpUrl)}
            </pre>
          </div>
        </CardContent>
      </Card>

      {/* 生成密钥 */}
      <Dialog open={generateOpen} onOpenChange={setGenerateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{keysT("create.title")}</DialogTitle>
            <DialogDescription>{keysT("create.description")}</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={generate}>
            <div className="space-y-2">
              <label htmlFor="key-name" className="text-sm font-medium">
                {keysT("create.name")}
              </label>
              <Input
                id="key-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={keysT("create.namePlaceholder")}
                required
              />
            </div>

            <div className="space-y-2">
              <span className="text-sm font-medium">{keysT("create.scopes")}</span>
              <div className="space-y-1.5">
                {KEY_SCOPE_OPTIONS.map((option) => (
                  <label key={option.value} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4 rounded border"
                      checked={scopes.includes(option.value)}
                      onChange={() => toggleScope(option.value)}
                    />
                    {keysT(option.labelKey)}
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="key-expires" className="text-sm font-medium">
                {keysT("create.expires")}
              </label>
              <select
                id="key-expires"
                value={expiresInDays}
                onChange={(e) => setExpiresInDays(Number(e.target.value))}
                className="w-full rounded-md border bg-transparent px-2 py-1.5 text-sm"
              >
                {EXPIRY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {keysT(option.labelKey)}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <span className="text-sm font-medium">{keysT("scope.label")}</span>
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="scope-mode"
                    className="size-4"
                    checked={scopeMode === "all"}
                    onChange={() => setScopeMode("all")}
                  />
                  {keysT("scope.all")}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="scope-mode"
                    className="size-4"
                    checked={scopeMode === "selected"}
                    onChange={() => setScopeMode("selected")}
                  />
                  {keysT("scope.selected")}
                </label>
              </div>
              {scopeMode === "selected" ? (
                <RepositoryPicker
                  groups={orgGroups}
                  selected={selectedRepoIds}
                  onToggle={(id) => setSelectedRepoIds((prev) => toggleId(prev, id))}
                  onToggleGroup={(ids, next) =>
                    setSelectedRepoIds((prev) => toggleGroup(prev, ids, next))
                  }
                  labels={{ selectAll: keysT("scope.selectAll"), empty: keysT("scope.empty") }}
                />
              ) : null}
              {scopeMode === "selected" && selectedRepoIds.length === 0 ? (
                <p className="text-xs text-muted-foreground">{keysT("scope.hint")}</p>
              ) : null}
            </div>

            {formError ? <p className="text-sm text-destructive">{formError}</p> : null}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setGenerateOpen(false)}>
                {common("cancel")}
              </Button>
              <Button type="submit" disabled={submitting}>
                {keysT("create.submit")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 编辑可访问范围 */}
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{keysT("scope.editTitle")}</DialogTitle>
            <DialogDescription>
              {editing ? keysT("scope.editDesc", { name: editing.name }) : ""}
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={saveScope}>
            <RepositoryPicker
              groups={orgGroups}
              selected={editRepoIds}
              onToggle={(id) => setEditRepoIds((prev) => toggleId(prev, id))}
              onToggleGroup={(ids, next) => setEditRepoIds((prev) => toggleGroup(prev, ids, next))}
              labels={{ selectAll: keysT("scope.selectAll"), empty: keysT("scope.empty") }}
            />
            <p className="text-xs text-muted-foreground">{keysT("scope.editHint")}</p>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                {common("cancel")}
              </Button>
              <Button type="submit" disabled={savingScope}>
                {keysT("scope.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 明文只显示一次 */}
      <Dialog open={rawKey !== null} onOpenChange={(open) => !open && setRawKey(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{keysT("create.rawTitle")}</DialogTitle>
            <DialogDescription>{keysT("create.rawDescription")}</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-muted/60 p-3 text-xs">
              {rawKey}
            </code>
            <CopyButton text={rawKey ?? ""} label={keysT("examples.copy")} />
          </div>
          <DialogFooter>
            <Button type="button" onClick={() => setRawKey(null)}>
              {keysT("create.rawDone")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        title={keysT("revoke")}
        description={keysT("revokeConfirm", { name: revokeTarget?.name ?? "" })}
        confirmText={keysT("revoke")}
        cancelText={common("cancel")}
        destructive
        loading={revoking}
        onConfirm={revoke}
      />
    </div>
  );
}

function PrefsPanel() {
  const t = useTranslations("settings.preferences");
  const topbar = useTranslations("topbar");
  const router = useRouter();
  const locale = useLocale();
  const { mode, setMode } = useTheme();

  function switchLocale(next: "zh" | "en") {
    document.cookie = `NEXT_LOCALE=${next}; path=/; SameSite=Lax`;
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Globe className="size-4 text-muted-foreground" />
            {t("languageTitle")}
          </CardTitle>
          <CardDescription>{t("languageDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm font-medium">{t("language")}</p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant={locale === "zh" ? "default" : "outline"}
              size="sm"
              onClick={() => switchLocale("zh")}
            >
              {topbar("chinese")}
            </Button>
            <Button
              type="button"
              variant={locale === "en" ? "default" : "outline"}
              size="sm"
              onClick={() => switchLocale("en")}
            >
              {topbar("english")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t("languageHint")}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Palette className="size-4 text-muted-foreground" />
            {t("themeTitle")}
          </CardTitle>
          <CardDescription>{t("themeDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm font-medium">{t("appearance")}</p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant={mode === "light" ? "default" : "outline"}
              size="sm"
              onClick={() => setMode("light")}
            >
              <Sun className="size-4" />
              {topbar("light")}
            </Button>
            <Button
              type="button"
              variant={mode === "dark" ? "default" : "outline"}
              size="sm"
              onClick={() => setMode("dark")}
            >
              <Moon className="size-4" />
              {topbar("dark")}
            </Button>
            <Button
              type="button"
              variant={mode === "system" ? "default" : "outline"}
              size="sm"
              onClick={() => setMode("system")}
            >
              <Monitor className="size-4" />
              {topbar("system")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function MorePanel() {
  const t = useTranslations("settings.notifications");
  const common = useTranslations("common");
  const [prefs, setPrefs] = React.useState<Record<string, boolean> | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    fetch("/api/settings/notification-preferences")
      .then((r) => r.json())
      .then((d) => setPrefs(d.prefs ?? {}))
      .catch(() => setPrefs({}));
  }, []);

  const items = [
    { key: "import", label: t("prefImport") },
    { key: "context", label: t("prefContext") },
  ];

  async function toggle(cat: string, enabled: boolean) {
    setSaving(true);
    const res = await fetch("/api/settings/notification-preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: cat, enabled }),
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(t("saveFailed"));
      return;
    }
    setPrefs((p) => ({ ...(p ?? {}), [cat]: enabled }));
    toast.success(t("saved"));
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("notifications")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          {items.map((item) => (
            <div key={item.key} className="flex items-center justify-between py-3 text-sm">
              <span>{item.label}</span>
              <PrefSwitch
                checked={prefs?.[item.key] ?? true}
                disabled={saving || prefs === null}
                onChange={(v) => toggle(item.key, v)}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("title")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          {[{ label: t("sessions") }, { label: t("apiPrefs") }].map((row) => (
            <div key={row.label} className="flex items-center justify-between py-3 text-sm">
              <span>{row.label}</span>
              <Badge variant="secondary">{common("comingSoon")}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function PrefSwitch({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
        checked ? "bg-green-600" : "bg-muted"
      } ${disabled ? "opacity-50" : ""}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-4" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}
