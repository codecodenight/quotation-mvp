import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  outputFileTracingExcludes: {
    "*": [
      "./backups/**/*",
      "./data/**/*",
      "./outputs/**/*",
      "./sample-data/**/*",
      "./sample data/**/*",
    ],
  },
};

export default nextConfig;
