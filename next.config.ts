import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output keeps the Docker image small for handoff to the office server.
  output: "standalone",
  experimental: {
    // Server Actions are used for form submissions across Система А / Система Б.
    serverActions: {
      bodySizeLimit: "10mb", // attached invoices/contracts in payment requests
    },
  },
};

export default nextConfig;
