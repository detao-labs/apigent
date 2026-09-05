import { redirect } from "next/navigation";
import { requireUser } from "@/services/auth";
import { listApiKeys } from "@/services/keys";
import { SettingsView } from "@/components/settings-view";
import { getMcpConfig } from "@/lib/mcp";

const SECTIONS = ["account", "keys", "preferences", "notifications"] as const;
type Section = (typeof SECTIONS)[number];

export default async function SettingsSectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  if (!SECTIONS.includes(section as Section)) redirect("/settings/account");

  const user = await requireUser();
  const keys = await listApiKeys(user.id);
  const mcpConfig = getMcpConfig();

  return (
    <SettingsView
      user={user}
      section={section as Section}
      keys={keys}
      mcpPath={mcpConfig.path}
      mcpPublicUrl={mcpConfig.publicUrl}
    />
  );
}
