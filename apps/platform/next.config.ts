import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

const config: NextConfig = {
  transpilePackages: ["@apigent/core", "@apigent/server", "@apigent/ui"],
};

export default withNextIntl(config);
