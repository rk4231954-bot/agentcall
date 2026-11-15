import type { NextConfig } from "next";

// The API lives on its own server (apps/server). The browser talks to it
// through this origin, so the session cookie stays first-party.
// Rewrites are fixed at build time: changing SERVER_URL needs a redeploy.
function serverUrl() {
  const raw = process.env.SERVER_URL?.trim();
  if (!raw) {
    // Falling back to localhost on Vercel makes every API call 404 with
    // DNS_HOSTNAME_RESOLVED_PRIVATE, so refuse to build instead.
    if (process.env.VERCEL) throw new Error("SERVER_URL is not set for this Vercel environment.");
    return "http://localhost:3000";
  }
  const url = new URL(raw);
  // Only the origin: a trailing /api or /api/v1 would double the path.
  return url.origin;
}

const SERVER_URL = serverUrl();

const nextConfig: NextConfig = {
  transpilePackages: ["@agentcall/shared"],
  async rewrites() {
    return [{ source: "/api/v1/:path*", destination: `${SERVER_URL}/api/v1/:path*` }];
  },
};

export default nextConfig;
