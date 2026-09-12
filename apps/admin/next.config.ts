import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

const config: NextConfig = {
  transpilePackages: ["@apigent/core", "@apigent/server", "@apigent/ui"],
  // pg 在 Next 默认 external 列表里；pnpm 严格模式下需要从项目目录可解析
  // （见 apps/platform/next.config.ts 的同款说明）。
  serverExternalPackages: ["pg"],
};

export default withNextIntl(config);
