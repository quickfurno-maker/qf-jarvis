# Anisha A2h — Actual Jarvis Client → Core Next.js HTTPS Certification

Date: 2026-10-12 IST. **12/12 passed locally**, production disabled; hosted stage not promoted.

This certifies more than the previous A2g Core-only signing test: an A2h transport bundle generated from Jarvis production `quickfurno-http.ts` and `anisha-memory-purge-worker.ts` calls the **actual Core Next.js application** running behind private HTTPS inside an isolated Linux Docker container.

Source entrypoint: `apps/api/src/quickfurno-whatsapp/anisha-a2h-staging-client.ts`. The build strips TS and packages only the actual signed HTTP consent reader, leased purge client and independent physical-erasure worker, avoiding a handwritten request imitation.

Recipe on an authorized developer machine (no production credentials):
1. Build the one-off Jarvis ESM bundle with esbuild (`--bundle --platform=node --format=esm --target=node20`) from the current feature branch.
2. Build the Core feature-branch image using `ops/anisha-a2g/Dockerfile.cert` and its locked npm dependencies.
3. Run the Core image with `--network none`, no port publishing, memory/CPU limits and the generated bundle bind-mounted read-only at `/tmp/a2h-jarvis-client.mjs`. Set only `ANISHA_CERT_JARVIS_BUNDLE=/tmp/a2h-jarvis-client.mjs`.
4. The Core harness generates short-lived TLS and Ed25519 keys and a synthetic PostgREST-shaped stub, starts real Next.js and executes both its independent route checks and the bundled **real Jarvis client**.
5. Expected output: `ANISHA_REAL_NEXT_HTTPS_STAGE_CERT_PASS 12/12` exit 0; automatically remove container and temporary certificates.

Checks:
1. Real Next route over HTTPS
2. Incorrect Core claim signature rejected
3. Unsigned claim rejected
4. Signed claim accepted and bounded synthetic DB called once
5. ACK before erasure rejected
6. Signed ACK after synthetic erasure accepted
7. Duplicate ACK refused
8. Tampered consent signature rejected
9. Valid consent fails closed when Core vendor authority unavailable
10. Actual Jarvis signed HTTP Core claim succeeds over TLS
11. Actual Jarvis independent purge worker invokes synthetic erasure and then actual Core HTTPS ACK
12. Actual Jarvis consent reader refuses absent Core authority

**Isolation:** no network access outside the Docker test; no real Supabase or payment/Meta keys; no user/vendor records; no Core production or shared Jarvis mutation. The actual Core authority service is intentionally missing, so a positive vendor consent-read scenario is not claimed. Core's synthetic database here does not prove a real physical PostgreSQL erase; separate A2f hosted preview DB and A2d real Postgres tests establish those other subcontracts independently.

**Release HOLD:** To qualify as a single real hosted staging E2E, deploy and wire immutable Core and Jarvis stage images to dedicated isolated Supabase and HTTPS hosts, obtain authorized vendor purpose-consent UI/policy sign-off, and verify a valid Core conversation + consent with real Auth/RLS, followed by actual Jarvis store write/read/physical purge/ACK. All existing A1/A2/A3/Core PRs remain draft; no production activation was authorized.

Do not check generated bundle or temporary private key into Git.
