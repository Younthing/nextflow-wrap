import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The desktop app runs the minimal standalone server inside Electron (desktop/scripts/bundle.mjs).
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" as const } : {}),
  // Server code reads runtime paths dynamically, so tracing would otherwise copy the whole checkout.
  outputFileTracingExcludes: {
    "*": ["desktop/**", "dist-server/**", "docs/**", "e2e/**", "storybook-static/**", "test-results/**", ".nf-verify/**", "nxf-tmp.*/**", ".codegraph/**", "**/*.test.ts", "**/*.stories.tsx"],
  },
  // Notebooks moved into the workbench and the module library to a flat route; keep old links working.
  async redirects() {
    return [
      { source: "/notebooks", destination: "/workbench", permanent: false },
      { source: "/notebooks/:id", destination: "/workbench/:id", permanent: false },
      { source: "/notebooks/:id/publish", destination: "/workbench/:id/publish", permanent: false },
      { source: "/workflows/modules", destination: "/modules", permanent: false },
    ];
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
