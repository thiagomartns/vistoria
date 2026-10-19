import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  // Instruções para agentes ficam no CLAUDE.md; sem isto, o `next dev` recria um AGENTS.md.
  agentRules: false,
  reactCompiler: true,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
