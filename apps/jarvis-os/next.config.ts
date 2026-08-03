import type { NextConfig } from 'next';

/**
 * Jarvis OS build configuration (JOS-01A, docs/architecture/jarvis-os.md).
 *
 * `standalone` output is set now so that JOS-01D can build an isolated container without
 * a configuration change landing at the same time as a deployment. Nothing in this PR
 * deploys, and the VPS is untouched.
 *
 * `reactStrictMode` stays on: this surface will eventually hold an operator's approval
 * desk, and a double-invoked render that reveals an accidental side effect is exactly the
 * bug worth finding early.
 */
const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  // No remote image host, no analytics endpoint, no runtime CDN: every asset is local.
  images: { remotePatterns: [] },
};

export default nextConfig;
