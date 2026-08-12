import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { htmlLang, defaultLocale } from "@apigent/core/i18n";
import type { Locale } from "@apigent/core/i18n";
import { SidebarInset, SidebarProvider, TooltipProvider } from "@apigent/ui";
import { AppSidebar } from "@/components/app-sidebar";
import "./globals.css";

export const metadata: Metadata = {
  title: "Apigent Platform",
  description: "API collaboration platform with native AI Agent support",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Locale comes from the NEXT_LOCALE session cookie (see i18n/request.ts);
  // the URL never contains a language prefix.
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html
      lang={htmlLang[locale as Locale] ?? defaultLocale}
      className="font-sans"
      suppressHydrationWarning
    >
      <body className="antialiased">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <TooltipProvider>
            <SidebarProvider>
              <AppSidebar />
              <SidebarInset>
                <main className="p-6">{children}</main>
              </SidebarInset>
            </SidebarProvider>
          </TooltipProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
