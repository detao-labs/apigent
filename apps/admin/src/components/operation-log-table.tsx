import { getLocale, getTranslations } from "next-intl/server";
import {
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@apigent/ui";
import { OPERATION_TYPES, type OperationLogEntry } from "@apigent/server/audit";

// ═══════════════════════════════════════════════════════════════════
// Operation Log Table — 操作日志表格（服务端组件，只读）
// ═══════════════════════════════════════════════════════════════════
//
// 与 platform 的同名组件是两份实现：两个 app 的 i18n bundle 结构不同
// （platform 按模块拆文件，admin 是单文件），抽公共组件反而要在两边各写一份
// 文案映射。逻辑刻意保持极薄，纯渲染。
// ═══════════════════════════════════════════════════════════════════

const KNOWN_OPERATIONS = new Set<string>(OPERATION_TYPES);
const KNOWN_ROLES = new Set([
  "admin_super",
  "org_owner",
  "org_admin",
  "org_member",
  "repo_owner",
  "repo_admin",
  "repo_member",
  "repo_viewer",
]);

function pick(summary: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = summary[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return null;
}

export async function OperationLogTable({ entries }: { entries: OperationLogEntry[] }) {
  const t = await getTranslations("audit");
  const locale = await getLocale();
  type MessageKey = Parameters<typeof t>[0];

  const fmt = new Intl.DateTimeFormat(locale === "en" ? "en-US" : "zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  const roleLabel = (role: string) =>
    KNOWN_ROLES.has(role) ? t(`roles.${role}` as MessageKey) : role;
  const operationLabel = (type: string) =>
    KNOWN_OPERATIONS.has(type) ? t(`operations.${type.replace(/\./g, "_")}` as MessageKey) : type;

  if (entries.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <h3 className="mb-1 text-lg font-semibold">{t("emptyTitle")}</h3>
          <p className="text-sm text-muted-foreground">{t("emptyDescription")}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead>{t("colTime")}</TableHead>
              <TableHead>{t("colActor")}</TableHead>
              <TableHead>{t("colOperation")}</TableHead>
              <TableHead>{t("colTarget")}</TableHead>
              <TableHead>{t("colDetail")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => {
              const target =
                pick(entry.summary, ["targetName", "targetEmail", "name"]) ??
                entry.resourceId ??
                "—";
              const from = pick(entry.summary, ["from"]);
              const to = pick(entry.summary, ["to"]);
              const role = pick(entry.summary, ["role"]);
              const detail =
                from && to ? `${roleLabel(from)} → ${roleLabel(to)}` : role ? roleLabel(role) : "—";

              return (
                <TableRow key={entry.id}>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {fmt.format(new Date(entry.createdAt))}
                  </TableCell>
                  <TableCell className="text-sm">
                    {entry.actor ? (
                      <div className="min-w-0">
                        <div className="truncate font-medium">{entry.actor.name}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {entry.actor.email}
                        </div>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">{t("systemActor")}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{operationLabel(entry.operationType)}</TableCell>
                  <TableCell className="text-sm">{target}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{detail}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
