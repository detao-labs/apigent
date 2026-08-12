import { getTranslations } from "next-intl/server";

export default async function UsersPage() {
  const t = await getTranslations("users");

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
      </div>

      <div className="rounded-xl border p-12 text-center">
        <h3 className="text-lg font-medium mb-1">{t("emptyTitle")}</h3>
        <p className="text-muted-foreground">{t("emptyDescription")}</p>
      </div>
    </div>
  );
}
