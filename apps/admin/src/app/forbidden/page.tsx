import { getTranslations } from "next-intl/server";
import { ShieldAlert } from "lucide-react";
import { Card, CardContent } from "@apigent/ui";
import { LogoutButton } from "@/components/logout-button";

/**
 * 已登录但没有平台管理员角色时的落地页。
 *
 * 走到这里通常只有一种情况：会话还有效，但 admin_members 里的那一行刚被撤销。
 */
export default async function ForbiddenPage() {
  const t = await getTranslations("forbidden");

  return (
    <div className="mx-auto mt-24 w-full max-w-md px-4">
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <div className="flex size-10 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
            <ShieldAlert className="size-5" />
          </div>
          <h1 className="text-lg font-semibold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
          <LogoutButton />
        </CardContent>
      </Card>
    </div>
  );
}
