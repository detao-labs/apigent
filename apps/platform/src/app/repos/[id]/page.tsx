import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default async function RepoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const t = await getTranslations("repos.detail");
  const { id } = await params;

  const tabs = [
    { key: "overview" as const, label: t("tabs.overview") },
    { key: "endpoints" as const, label: t("tabs.endpoints") },
    { key: "schemas" as const, label: t("tabs.schemas") },
    { key: "settings" as const, label: t("tabs.settings") },
  ];

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Link href="/repos" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground font-mono">{id}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b mb-6">
        {tabs.map((tab, i) => (
          <button
            key={tab.key}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              i === 0
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Endpoints list placeholder */}
      <div className="rounded-xl border p-12 text-center">
        <svg className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <h3 className="text-lg font-medium mb-1">{t("emptyTitle")}</h3>
        <p className="text-muted-foreground mb-6">{t("emptyDescription")}</p>
      </div>
    </div>
  );
}
