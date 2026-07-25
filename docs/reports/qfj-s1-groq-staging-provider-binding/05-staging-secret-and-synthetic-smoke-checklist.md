# Report 05 — Staging Secret and Synthetic Live-Smoke Activation Checklist

**Slice:** QFJ-S1. **ADR:** [ADR-0060](../../decisions/ADR-0060-qfj-s1-groq-staging-provider-binding.md) §D, §N, and the Consequences.

## Where S1 stops

S1 makes the existing Groq adapter **staging-bindable**: given an approved release, an opaque credential reference, an injected async resolver, and the fixed transport, `bindGroqStagingProvider` returns a ready `GroqModelProvider` — with the credential materialized only at bind time and every data-class/execution/attestation/credential gate failing closed before any transport. **No real key is read; no live Groq request is made.** Everything is proven against deterministic fakes.

## Explicitly deferred — requires SEPARATE owner authorization

The next action is **not** part of this slice and must be authorized on its own:

1. **Staging secret injection.** Provision a real **staging** Groq key into a secret store and implement a production `GroqCredentialResolver` that resolves the opaque reference to it. The key must never enter source, env-in-package, logs, events, provenance, or reports.
2. **One synthetic live smoke test.** A single, bounded, non-production request to `api.groq.com` with a synthetic prompt (no real client/vendor data), through the fixed transport and the bound staging provider, to confirm the wire path — then stop.

Neither is done here.

## Activation checklist (for the separately-authorized live-smoke step)

- [ ] Owner explicitly authorizes staging secret injection **and** one synthetic live smoke test (each named).
- [ ] A **staging** (not production) Groq key is provisioned in a secret store; a data-controls (ZDR) attestation for the staging release is confirmed (`dataControlsAttested: true`), else the bind fails closed.
- [ ] A production `GroqCredentialResolver` resolves the opaque reference to the key **only** at bind time; the key never enters source/env-in-package/logs/events/provenance/reports.
- [ ] The staging release is an approved, exact `ProviderReleaseRef` (no wildcard/`latest`); `HOSTED_ALLOWED` only.
- [ ] `createFetchGroqTransport()` (the fixed origin) is used; no endpoint/base-URL override; `redirect: 'error'`.
- [ ] Exactly **one** synthetic request with a synthetic prompt (no real client/vendor data), non-streaming, strict structured output; bounded token/timeout budgets from the release.
- [ ] The gateway (not the adapter) owns retry/timeout/circuit; the adapter makes one request and no retry.
- [ ] Observability stays content-free; the key and reference value never appear.
- [ ] The smoke test does **not** activate the provider, promote any rollout, contact Core, send/deliver anything, or persist anything.

## After the smoke test (roadmap order, each separately authorized)

QuickFurno Core-side M3 protocol adoption → a Core-approved delivery command + n8n/WhatsApp transport → authoritative persistence/delivery states → the minimum Conversation Operations Center → a controlled pilot. Managed database/migration/live lanes remain paused; RAG stays disabled; Kimi excluded; migrations 0001–0007 byte-exact with no 0008; event-backbone root API 39.
