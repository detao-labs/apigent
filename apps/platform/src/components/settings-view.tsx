"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
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
import type { ApiKeySummary } from "@/services/keys";

const SECTIONS = ["account", "keys", "prefs", "more"] as const;
type Section = (typeof SECTIONS)[number];

const SECTION_ICONS: Record<Section, typeof User> = {
  account: User,
  keys: KeyRound,
  prefs: Palette,
  more: SlidersHorizontal,
};

export function SettingsView({
  user,
  initialSection,
  keys,
}: {
  user: { name: string; email: string };
  initialSection?: string;
  keys: ApiKeySummary[];
}) {
  const t = useTranslations("settings");
  const [section, setSection] = React.useState<Section>(
    SECTIONS.includes(initialSection as Section)
      ? (initialSection as Section)
      : "account",
  );

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
              onClick={() => setSection(s)}
            />
          ))}
        </RailGroup>
        <RailGroup label={t("groups.prefs")}>
          {SECTIONS.filter((s) => s === "prefs" || s === "more").map((s) => (
            <RailItem
              key={s}
              icon={SECTION_ICONS[s]}
              label={t(`sections.${s}`)}
              active={section === s}
              onClick={() => setSection(s)}
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
              onClick={() => setSection(s)}
            >
              {t(`sections.${s}`)}
            </Button>
          ))}
        </div>

        {section === "account" && <AccountPanel user={user} />}
        {section === "keys" && <KeysPanel keys={keys} />}
        {section === "prefs" && <PrefsPanel />}
        {section === "more" && <MorePanel />}
      </div>
    </div>
  );
}

function RailGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      <p className="px-3 pb-1.5 text-xs font-medium text-muted-foreground">
        {label}
      </p>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function RailItem({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: typeof User;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
        active
          ? "bg-accent font-medium text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
      }`}
    >
      <Icon className="size-4 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
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
            <Input
              id="profileName"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
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
                  pwdStatus.type === "success"
                    ? "text-muted-foreground"
                    : "text-destructive"
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

function KeysPanel({ keys }: { keys: ApiKeySummary[] }) {
  const keysT = useTranslations("keys");
  const common = useTranslations("common");
  const locale = useLocale();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">{keysT("title")}</CardTitle>
            <CardDescription>{keysT("description")}</CardDescription>
          </div>
          <Button type="button" disabled title={common("backendPending")}>
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
              <Button type="button" disabled title={common("backendPending")}>
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
                    <TableCell className="text-sm text-muted-foreground">
                      {key.lastUsedAt
                        ? formatRelativeTime(key.lastUsedAt, locale)
                        : keysT("never")}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {key.expiresAt
                        ? formatRelativeTime(key.expiresAt, locale)
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled
                        title={common("backendPending")}
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
              <CopyButton text={MCP_SNIPPET} label={keysT("examples.copy")} />
            </div>
            <pre className="overflow-x-auto rounded-lg bg-muted/60 p-3 text-xs leading-relaxed">
              {MCP_SNIPPET}
            </pre>
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-sm font-medium">{keysT("examples.rest")}</p>
              <CopyButton text={CURL_SNIPPET} label={keysT("examples.copy")} />
            </div>
            <pre className="overflow-x-auto rounded-lg bg-muted/60 p-3 text-xs leading-relaxed">
              {CURL_SNIPPET}
            </pre>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PrefsPanel() {
  const t = useTranslations("settings.prefs");
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
  const t = useTranslations("settings.more");
  const common = useTranslations("common");

  const rows = [
    { label: t("notifications") },
    { label: t("sessions") },
    { label: t("apiPrefs") },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="divide-y">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-center justify-between py-3 text-sm"
          >
            <span>{row.label}</span>
            <Badge variant="secondary">{common("comingSoon")}</Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

const MCP_SERVICE_URL = "https://apigent.acme.dev/mcp";

const MCP_SNIPPET = `{
  "mcpServers": {
    "apigent": {
      "url": "${MCP_SERVICE_URL}",
      "headers": { "Authorization": "Bearer <your-key>" }
    }
  }
}`;

const CURL_SNIPPET = `curl ${MCP_SERVICE_URL}/v1/apis/search \\
  -H "Authorization: Bearer <your-key>" \\
  -H "Content-Type: application/json"`;
