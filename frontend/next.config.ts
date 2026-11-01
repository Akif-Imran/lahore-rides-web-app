import type { NextConfig } from 'next';

const DEFAULT_API_BASE_URL = 'http://localhost:3001/api/v1';

/** Fails the build early if the inlined API URL is malformed, instead of breaking in the browser. */
function apiOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL;
  try {
    return new URL(raw).origin;
  } catch {
    throw new Error(`NEXT_PUBLIC_API_BASE_URL is not a valid absolute URL: "${raw}"`);
  }
}

const isDev = process.env.NODE_ENV !== 'production';

// The browser talks to the API directly (CORS allow-list on the backend), so it is the only
// extra origin `connect-src` needs. Next's inline bootstrap scripts need 'unsafe-inline' without
// a nonce setup; dev additionally needs eval and the HMR websocket.
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  `connect-src 'self' ${apiOrigin()}${isDev ? ' ws:' : ''}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker runtime image.
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  // Don't let `next dev` write AGENTS.md into the repo.
  agentRules: false,
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: contentSecurityPolicy },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
