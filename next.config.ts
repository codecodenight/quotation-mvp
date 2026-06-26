import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    optimizePackageImports: [],
    serverMinification: false,
    webpackBuildWorker: false,
  },
  turbopack: {},
  outputFileTracingExcludes: {
    "*": [
      "./backups/**/*",
      "./data/**/*",
      "./outputs/**/*",
      "./sample-data/**/*",
      "./sample data/**/*",
    ],
  },
  webpack: (config, { dev }) => {
    if (!dev) {
      config.optimization = config.optimization ?? {};
      config.optimization.minimize = false;
    }
    return config;
  },
};

export default nextConfig;
