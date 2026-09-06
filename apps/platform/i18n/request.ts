import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";
import { locales, defaultLocale } from "@apigent/core/i18n";
import type { AbstractIntlMessages } from "next-intl";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Session cookie written by the LocaleSwitcher. */
const LOCALE_COOKIE = "NEXT_LOCALE";

/** 每个语言一个合并 bundle（构建/文件不可读时的兜底）。 */
const LOCALE_BUNDLES: Record<string, () => Promise<AbstractIntlMessages>> = {
  en: () => import("./messages/en/index").then((m) => m.default as unknown as AbstractIntlMessages),
  zh: () => import("./messages/zh/index").then((m) => m.default as unknown as AbstractIntlMessages),
};

/** 每请求读最新消息文件：dev 读 <locale>/ 目录下所有 *.json 合并（改动即生效）。 */
async function loadMessages(locale: string): Promise<AbstractIntlMessages> {
  try {
    const dir = join(process.cwd(), "i18n/messages", locale);
    const messages: Record<string, unknown> = {};
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      Object.assign(messages, JSON.parse(readFileSync(join(dir, file), "utf8")));
    }
    return messages as AbstractIntlMessages;
  } catch {
    const load = LOCALE_BUNDLES[locale];
    if (load) return await load();
    throw new Error(`No message bundle for locale: ${locale}`);
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
