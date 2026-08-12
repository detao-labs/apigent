import { getTranslations } from "next-intl/server";

export default async function SettingsPage() {
  const t = await getTranslations("settings");

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">{t("title")}</h1>
      <p className="text-muted-foreground mb-8">{t("description")}</p>

      <div className="rounded-xl border p-6 max-w-2xl">
        <h2 className="text-lg font-semibold mb-4">{t("configTitle")}</h2>
        <p className="text-sm text-muted-foreground">
          {t.rich("configFileHint", {
            yaml: (chunks) => (
              <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{chunks}</code>
            ),
            example: (chunks) => (
              <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{chunks}</code>
            ),
          })}
        </p>
      </div>
    </div>
  );
}
