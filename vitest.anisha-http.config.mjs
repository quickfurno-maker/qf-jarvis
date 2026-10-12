import { defineConfig } from 'vitest/config';

// AN-A2e: isolated, disposable localhost HTTP wire certificate.
// Deliberately outside the normal unit file glob so the credential/security
// containment scanners keep their existing tight tests-only boundary.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['apps/api/certification/anisha-memory-http-loopback-cert.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    testTimeout: 30_000,
  },
});
