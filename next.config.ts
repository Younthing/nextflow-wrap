import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The desktop app runs the minimal standalone server inside Electron (desktop/scripts/bundle.mjs).
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" as const } : {}),
  // Server code reads runtime paths dynamically, so tracing would otherwise copy the whole checkout.
  outputFileTracingExcludes: {
    "*": ["desktop/**", "docs/**", "e2e/**", "storybook-static/**", "test-results/**", ".nf-verify/**", "nxf-tmp.*/**", ".codegraph/**", "**/*.test.ts", "**/*.stories.tsx"],
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
