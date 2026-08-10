import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Apigent Platform",
  description: "API collaboration platform with native AI Agent support",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
