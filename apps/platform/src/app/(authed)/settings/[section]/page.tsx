import { redirect } from "next/navigation";
import { requireUser } from "@/services/auth";
import { listSecretKeys, listSelectableRepositories } from "@apigent/server/keys";
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
  // 只有 keys 分区需要"可勾选的仓库"，其它分区省掉这次查询
  const [keys, selectableRepositories] = await Promise.all([
    listSecretKeys(user.id),
    section === "keys" ? listSelectableRepositories(user.id) : Promise.resolve([]),
  ]);
  const mcpConfig = getMcpConfig();

  return (
    <SettingsView
      user={user}
      section={section as Section}
      keys={keys}
      selectableRepositories={selectableRepositories}
      mcpPath={mcpConfig.path}
      mcpPublicUrl={mcpConfig.publicUrl}
    />
  );
}
