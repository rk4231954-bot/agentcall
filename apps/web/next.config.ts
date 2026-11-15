import type { NextConfig } from "next";

// The API lives on its own server (apps/server). The browser talks to it
// through this origin, so the session cookie stays first-party.
const SERVER_URL = (process.env.SERVER_URL ?? "http://localhost:3000").replace(/\/$/, "");

const nextConfig: NextConfig = {
  transpilePackages: ["@agentcall/shared"],
  async rewrites() {
    return [{ source: "/api/v1/:path*", destination: `${SERVER_URL}/api/v1/:path*` }];
  },
};

export default nextConfig;
