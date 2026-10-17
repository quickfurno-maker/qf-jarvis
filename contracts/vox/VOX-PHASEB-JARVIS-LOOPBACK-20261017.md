# Phase B Jarvis — signed Riya pause through actual gateway, synthetic loopback

`phaseBRiyaGatewayLoopback.test.mjs` builds and imports the existing Jarvis gateway and actual F1 handler. It exercises real HTTP 127.0.0.1, authentic Ed25519 Core permit verification and signed Jarvis ACK, idempotency/replay denial, false permit signature, consent revocation, private origin denial and missing handler / disabled release flags. No real network outside process, customer data, managed database or provider messages. **QFJ transport verifier is synthetic** (explicitly not the genuine network m2m verifier); durable nonce transaction is also a test store. The runtime entrypoint still injects no actual pause handler. No approved human takeover or WhatsApp send.

Internal integration contract source is ready for eventual real protected staging composition and signed Auth/DB credentials, but genuine QFJ transport, current Core AAL2 staff grants, consent, durable PostgreSQL pause/nonce, private origin attestation, AppSec/DBA and owner release approval are outstanding.

Tests: `pnpm --filter '@qf-jarvis/quickfurno-gateway...' run build` then `node --test contracts/vox/*.test.mjs`, focused gateway Vitest and test typecheck. Cursor AI audit deferred.
