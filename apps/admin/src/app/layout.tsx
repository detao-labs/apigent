import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Apigent Admin",
  description: "Apigent platform administration",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
