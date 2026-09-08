import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Vinext applies this multipart guard before API routes. Each upload route
    // still enforces its own smaller file and request limits.
    serverActions: { bodySizeLimit: "16mb" },
  },
};

export default nextConfig;
