import { loadConfig } from "@apigent/core/config";

/** 从 apigent.config.yaml 读取 MCP 端点配置（服务端用）。 */
export function getMcpConfig(): { path: string; publicUrl: string } {
  const mcp = loadConfig().mcp;
  return { path: mcp.path, publicUrl: mcp.publicUrl ?? "" };
}
