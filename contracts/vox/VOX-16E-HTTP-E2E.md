# VOX-16E Jarvis private HTTP actual socket contract

Adds a real loopback HTTP server integration test for the previously implemented default-OFF VOX advisory route. Confirms 503 when disabled/missing server-owned trusted verifier, strict staff header/body, query rejection, current Core/replay reader denial to 403, provider permission denial, 200 sanitized read-only response and no privileged data/token reflection. Uses synthetic Ed25519 test keys; never accesses customer content, Supabase or provider network.

This is a local loopback gateway test with an injected fake Core/replay reader. It is **not** proof that private staging ingress, authentic Supabase AAL2 Core callback, real Jarvis PostgreSQL replay migration, mutual TLS/Cloudflare origin protections or signed OCI promotion is live. Keep all provider send/agent takeover actions OFF and staging release HOLD until externally attested.
