import type { NextConfig } from "next";

// Security headers (doc 06 §7). CSP is tightened per route once the app has real assets.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
];

const config: NextConfig = {
  poweredByHeader: false,
  // Agent instructions live only in the repo-root AGENTS.md / CLAUDE.md (ACTIVITY.md P0-09);
  // stop `next dev` from writing its own apps/web/AGENTS.md (L-0035 Q4).
  agentRules: false,
  reactStrictMode: true,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default config;
