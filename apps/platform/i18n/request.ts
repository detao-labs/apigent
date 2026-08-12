import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";
import { locales, defaultLocale } from "@apigent/core/i18n";
import type { AbstractIntlMessages } from "next-intl";

/** Session cookie written by the LocaleSwitcher. */
const LOCALE_COOKIE = "NEXT_LOCALE";

export default getRequestConfig(async () => {
  // The locale is controlled exclusively by the session cookie — the URL
  // never carries a language prefix and accept-language is not negotiated.
  const cookieLocale = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale =
    cookieLocale && locales.includes(cookieLocale as (typeof locales)[number])
      ? (cookieLocale as (typeof locales)[number])
      : defaultLocale;

  return {
    locale,
    messages: (
      (await import(`./messages/${locale}.json`)) as { default: AbstractIntlMessages }
    ).default,
  };
});
