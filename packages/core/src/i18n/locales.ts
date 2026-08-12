// ═══════════════════════════════════════════════════════════════════
// i18n — Locale constants (shared across all apps)
// ═══════════════════════════════════════════════════════════════════

export const locales = ["zh", "en"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";

/** BCP 47 language tag for HTML lang attribute */
export const htmlLang: Record<Locale, string> = {
  zh: "zh-CN",
  en: "en",
};
