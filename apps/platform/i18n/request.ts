import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";
import { locales, defaultLocale } from "@apigent/core/i18n";
import type { AbstractIntlMessages } from "next-intl";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Session cookie written by the LocaleSwitcher. */
const LOCALE_COOKIE = "NEXT_LOCALE";

/** 每请求读最新消息文件（避免 bundler 对 import() JSON 的模块缓存，改动即生效）。 */
async function loadMessages(locale: string): Promise<AbstractIntlMessages> {
  try {
    const file = join(process.cwd(), "i18n/messages", `${locale}.json`);
    return JSON.parse(readFileSync(file, "utf8")) as AbstractIntlMessages;
  } catch {
    // 兜底路径：退回 bundler import（发布构建时文件不可读时的保守方案）
    return (
      ((await import(`./messages/${locale}.json`)) as {
        default: AbstractIntlMessages;
      }).default
    );
  }
}

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
    messages: await loadMessages(locale),
  };
});
