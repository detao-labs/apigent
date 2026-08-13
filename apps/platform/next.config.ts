import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

const config: NextConfig = {
  transpilePackages: ["@apigent/core", "@apigent/server", "@apigent/ui"],
  // pg 在 Next 默认 external 列表里；pnpm 严格模式下需要从项目目录可解析，
  // 因此显式声明并作为 platform 直接依赖安装（见 package.json）。
  serverExternalPackages: ["pg"],
};

export default withNextIntl(config);
