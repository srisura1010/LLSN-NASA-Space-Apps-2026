import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // The Horizons cache is read with fs at runtime, so tell the bundler to
  // ship it with the API route when deployed.
  outputFileTracingIncludes: {
    "/api/horizons": ["./data/horizons-cache/**/*"],
  },
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
