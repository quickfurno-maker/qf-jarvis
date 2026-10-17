# VOX UI-04 — Dormant private Riya gateway route (17 October 2026)

## Actual source wiring
- Added `/internal/vox/v1/riya/pause` dispatch to **existing** `apps/quickfurno-gateway/src/server.ts`, with dedicated request metric label.
- It first requires HTTP POST, exact `QFJ_VOX_RIYA_PAUSE_PRIVATE_ENABLED=staging`, `config.environment=staging`, separately injected `voxRiyaPausePrivateHandler`, JSON content type and a successful injected `verifyPrivateIngress`. Absent any condition: 405/503/415/403 respectively. No browser query parameter accepted.
- **Critically**: existing gateway production entrypoint `apps/quickfurno-gateway/src/index.ts` injects NO pause handler. Therefore a flag by itself cannot activate the route. No import of provider credentials, no direct Meta/WhatsApp or new auth stack.
- Earlier `contracts/vox/ui04PrivateAgentMount.mjs` remains the contract for future approved handler composition reusing the real `createF1RiyaPauseHttpHandler`, Ed25519 m2m Core signature, current consent and atomic Jarvis nonce/pause transaction. This remains **NOT WIRED** to live bootstrap. A test-synthetic `voxRiyaPausePrivateHandler` is never security authority on its own.
- The separate Riya signed pause ACK does not authorize takeover, transcript access or outbound messages.

## QA
- `pnpm --filter '@qf-jarvis/quickfurno-gateway...' run build`: PASS.
- `pnpm --filter @qf-jarvis/quickfurno-gateway typecheck:tests`: PASS.
- `pnpm exec vitest run apps/quickfurno-gateway/src/tests/vox-ui04-private-riya-mount.test.ts apps/quickfurno-gateway/src/tests/vox-private-http.test.ts`: **15/15 PASS**, including real ephemeral loopback HTTP and private-ingress-denial cases.
- `pnpm exec prettier --write` applied only to changed server/test; PR CI workflow `.github/workflows/vox-ui04-private-gateway-dormant.yml` reruns pinned install/build/Vitest/typecheck.
- The previous Jarvis F1 signed pause disposable PG17 transaction/replay test passed, separate from this gateway route and not a live staging test.

## Remaining
Real verified Core pause permit issuer, protected staging secrets, trusted private ingress attestation, handler composition with current Core grants, consent/revision recheck, PostgreSQL durable transaction, signed response verification and independently approved human handoff. DBA/AppSec/human review and Owner GO remain mandatory. No public Traefik/VPS routes, managed DB changes or provider sends.

**RELEASE HOLD, unmerged source.** Cursor review intentionally deferred.
