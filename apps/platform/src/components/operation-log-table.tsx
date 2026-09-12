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
// summary 是结构化 JSONB，字段约定见 packages/server/src/audit/types.ts。
// 这里只负责把字段渲染成可读文本，不做任何权限判断——权限由调用它的页面
// 与 API 各自把关。
// ═══════════════════════════════════════════════════════════════════

// next-intl 的消息 key 不能包含 "."（那是嵌套分隔符），所以 `member.invite`
// 在文案里写成 `member_invite`。
const operationKey = (operationType: string) => operationType.replace(/\./g, "_");

const KNOWN_OPERATIONS = new Set<string>(OPERATION_TYPES);

const KNOWN_ROLES = new Set([
  "org_owner",
  "org_admin",
  "org_member",
  "repo_owner",
  "repo_admin",
  "repo_member",
  "repo_viewer",
]);

/** 摘要里第一个非空字符串字段。 */
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

  const operationLabel = (operationType: string) =>
    KNOWN_OPERATIONS.has(operationType)
      ? t(`operations.${operationKey(operationType)}` as MessageKey)
      : operationType;

  // 对象列：优先姓名，其次邮箱，创建类事件用资源名，最后退回资源 id。
  const targetLabel = (entry: OperationLogEntry) =>
    pick(entry.summary, ["targetName", "targetEmail", "name"]) ?? entry.resourceId ?? "—";

  const detailLabel = (entry: OperationLogEntry) => {
    const from = pick(entry.summary, ["from"]);
    const to = pick(entry.summary, ["to"]);
    if (from && to) return `${roleLabel(from)} → ${roleLabel(to)}`;

    const role = pick(entry.summary, ["role"]);
    if (role) return roleLabel(role);

    if (entry.operationType === "org.transfer") {
      const next = pick(entry.summary, ["targetName", "targetEmail", "toUserId"]);
      if (next) return `→ ${next}`;
    }
    return "—";
  };

  if (entries.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <h3 className="mb-1 text-lg font-semibold">{t("empty")}</h3>
          <p className="text-sm text-muted-foreground">{t("emptyDesc")}</p>
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
            {entries.map((entry) => (
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
                <TableCell className="text-sm">{targetLabel(entry)}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {detailLabel(entry)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
