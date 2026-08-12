"use client";

import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { Button } from "@/components/ui/button";
import { Languages } from "lucide-react";

/** next-intl reads this cookie to negotiate the locale. */
const LOCALE_COOKIE = "NEXT_LOCALE";

export function LocaleSwitcher() {
  const router = useRouter();
  const locale = useLocale();

  const switchTo = locale === "zh" ? "en" : "zh";
  const label = locale === "zh" ? "EN" : "中文";

  function toggle() {
    // Session cookie (no max-age): expires when the browser closes.
    // The URL stays untouched — the server re-renders with the new locale.
    document.cookie = `${LOCALE_COOKIE}=${switchTo}; path=/; SameSite=Lax`;
    router.refresh();
  }

  return (
    <Button variant="ghost" size="sm" onClick={toggle} className="w-full justify-start gap-2">
      <Languages className="size-4" />
      <span>{label}</span>
    </Button>
  );
}
