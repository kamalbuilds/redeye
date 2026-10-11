import path from "node:path";
import type { NextConfig } from "next";

// The server modules live one level up in ../src and use Node 24 native .ts imports.
// Turbopack only resolves inside its root, so the root is the repo, not web/.
const repoRoot = path.join(import.meta.dirname, "..");

const nextConfig: NextConfig = {
  turbopack: {
    root: repoRoot,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async redirects() {
    return [
      { source: "/redeye", destination: "/", permanent: false },
      { source: "/redeye/proof", destination: "/proof", permanent: false },
    ];
  },
};

export default nextConfig;
