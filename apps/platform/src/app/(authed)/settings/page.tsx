import { requireUser } from "@/services/auth";
import { listApiKeys } from "@/services/keys";
import { SettingsView } from "@/components/settings-view";

const SECTIONS = ["account", "keys", "prefs", "more"] as const;

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>;
}) {
  const { section } = await searchParams;
  const user = await requireUser();
  const keys = await listApiKeys(user.id);
  const initialSection = SECTIONS.includes(section as (typeof SECTIONS)[number])
    ? section
    : undefined;

  return (
    <SettingsView
      user={user}
      initialSection={initialSection}
      keys={keys}
    />
  );
}
