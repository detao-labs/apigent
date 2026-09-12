import { getTranslations } from "next-intl/server";

export default async function AuditPage() {
  const t = await getTranslations("audit");

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">{t("title")}</h1>
      <p className="text-muted-foreground mb-8">{t("description")}</p>

      <div className="rounded-xl border p-12 text-center">
        <h3 className="text-lg font-medium mb-1">{t("emptyTitle")}</h3>
        <p className="text-muted-foreground">{t("emptyDescription")}</p>
      </div>
    </div>
  );
}
