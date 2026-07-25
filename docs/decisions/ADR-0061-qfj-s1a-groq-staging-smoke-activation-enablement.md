# ADR-0061 — QFJ-S1A Groq Staging Smoke Activation Enablement

**Status:** Accepted (2026-07-26) — QFJ-S1A (a launch-integration enablement slice that clears exactly the four readiness blockers found by the S1 activation audit; **no real credential, no live call**)
**Deciders:** Owner
**Phase:** QFJ-S1A / Launch Integration — Groq Staging Smoke Activation Enablement (the enabling step between [ADR-0060](./ADR-0060-qfj-s1-groq-staging-provider-binding.md) and the separately-run single synthetic staging smoke)

**Relates to:** [ADR-0045](./ADR-0045-qfj-p04-01a-model-gateway-foundation.md) (model gateway) · [ADR-0046](./ADR-0046-qfj-p04-01b-groq-cloud-adapter.md) (the Groq Chat Completions adapter) · [ADR-0049](./ADR-0049-qfj-p04-01e-provider-operations-and-rollout-governance.md) (release refs + rollout) · [ADR-0050](./ADR-0050-qfj-p04-02-model-capability-registry.md) (capability registry) · [ADR-0052](./ADR-0052-qfj-p04-04-evaluation-and-red-team-foundation.md) (evaluation) · [ADR-0058](./ADR-0058-asynchronous-runtime-integration-boundaries.md) (async boundaries) · **[ADR-0060](./ADR-0060-qfj-s1-groq-staging-provider-binding.md) (the S1 staging binding this slice makes runnable)**

**Design documents introduced:** [docs/reports/qfj-s1a-groq-smoke-activation-enablement/](../reports/qfj-s1a-groq-smoke-activation-enablement/) (reports 01–05)

> **This is enablement, not another foundation phase.** PR #56 merged the S1 staging binding into `main` at `10b7bac40792561b50360866e06c76c6deb5b02e`. The S1 **safety** contract is accepted and unchanged: the fixed `api.groq.com` origin with its SSRF guard, the fail-closed execution/data-class/attestation gates that run **before** credential resolution, one HTTP request maximum, zero adapter retry, `AbortSignal` honoured, strict structured output with no silent downgrade, closed content-free observability, and full key redaction. The read-only activation audit nevertheless classified the repository **BLOCKED_BY_CODE_OR_CONTRACT** for the already-authorized single synthetic staging smoke, on four blockers. **S1A clears exactly those four and nothing else.** It adds no router, no provider adapter, no business rule, no delivery, no persistence, and no activation. **No real Groq key is read/created/rotated/stored/printed/validated; no live Groq request is made by this slice or its tests; no provider activation or rollout promotion; no live Core/WhatsApp/n8n/send; no persistence/DB/migration 0008; no dashboard/deployment.** The model gateway remains the **only** router and the sole owner of retry/timeout/circuit/failover for gateway-routed traffic; **QuickFurno Core remains the only business authority.** Migrations 0001–0007 stay byte-exact with no 0008; the `@qf-jarvis/event-backbone` root API remains **39**.

---

## Context

The S1 activation audit against merged `main` recorded four blockers:

| Code               | Blocker                                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `QFJ-S1-BLOCK-001` | No production `GroqCredentialResolver` — only the two fakes under `@qf-jarvis/model-gateway/testing`.                                       |
| `QFJ-S1-BLOCK-002` | No one-shot smoke harness — `bindGroqStagingProvider` and `createFetchGroqTransport` had zero non-test call sites.                          |
| `QFJ-S1-BLOCK-003` | No harness-owned timeout/abort — a standalone invocation bypasses the gateway, so nothing armed an `AbortController` or a wall-clock timer. |
| `QFJ-S1-BLOCK-004` | No prompt identity on `GroqStagingRelease` — a smoke run could not bind or record which prompt was exercised.                               |

The owner has **already** recorded the explicit authorization for one synthetic non-production Groq smoke request. That authorization is **not** consumed here. This slice is code-only and stops before any secret access or network activity.

## Decision

### A. Scope

Clear exactly the four blockers. Add **no** provider routing, business rule, delivery, persistence, registration, or activation. The resulting harness is **staging-only, one-shot, synthetic-only, and non-authoritative**: its output is a discarded draft with no business meaning.

### B. Credential ingress

A concrete secure staging resolver is implemented **outside** `@qf-jarvis/model-gateway`, in a new private package `@qf-jarvis/groq-staging-smoke`. The gateway package keeps its zero-environment-access property; the resolver satisfies the existing `GroqCredentialResolver` interface and returns the existing redacting `GroqApiKey`.

The design is a **masked interactive TTY resolver**. Its rules:

- the key is **never** supplied through `argv`;
- the key is **never** supplied through a configuration file;
- the key is **never** read from `process.env` (no `process.env` access exists anywhere in the package);
- the key is **never** written to disk, Git, a report, a snapshot, a log line, an event, or shell history;
- an **interactive TTY is required** — a non-TTY / redirected / piped stdin is refused **before** any read is attempted;
- terminal **echo is disabled** while reading, and the typed characters are not rendered;
- the value is **length- and format-bounded** and validated before use;
- the secret is read **exactly once** — a second `resolve` call fails closed rather than re-prompting;
- the resolver returns the redacting `GroqApiKey` and exposes **no** accessor for the value;
- mutable input buffers are cleared where technically possible;
- the key stays **process-memory only**, and the process exits after the single run.

This resolver is approved **only** for the controlled staging smoke. It is **not** the future production deployment secret-manager integration, and it must not be reused as one.

### C. One-shot harness

One executable staging-only harness lives at `packages/groq-staging-smoke/` — a private workspace package with a single `bin` entry, following the repository's existing package conventions. The harness:

- accepts **only** a path to a strict **non-secret** configuration file (`--config <path>`);
- **never** accepts a key or prompt text from `argv`, `stdin`, or the configuration;
- owns **one fixed synthetic prompt literal in source**;
- binds the provider **once**;
- invokes it **once**;
- prints **only** sanitized status / reference / counter fields;
- exits after the first result, success or failure;
- exposes **no** reusable interactive chat loop and no second-invocation surface;
- calls **no** QuickFurno Core, Jarvis runtime, n8n, WhatsApp, database, persistence, rollout, or activation API.

### D. Configuration

A strict, closed, **non-secret** configuration binds:

- the credential **reference identifier only** (never a key);
- the exact `releaseId` / `providerId` / `modelId` / `modelVersion` / `configDigest`;
- `executionClass` = `HOSTED`;
- `dataClass` = `HOSTED_ALLOWED`;
- `maxInputTokens` and `maxCompletionTokens`;
- `supportsStrictJsonSchema` = `true` (required for this smoke path);
- the exact `capabilityProfileRef`;
- the exact `evaluationRef`;
- the exact `dataControlsAttestationRef` and `dataControlsAttested` = `true`;
- the exact `promptFamily` and `promptVersion`;
- the exact `timeoutMs`, within a bounded range;
- the exact strict JSON **schema revision reference**.

Rejected: any wildcard or `latest`; any unknown key; any arbitrary metadata; any key/secret/token/password field; any prompt-text, message, or output field; any URL, endpoint, base-URL, header, or arbitrary provider option (`temperature`, `top_p`, `tools`, `stream`, …); any phone, subject, or client/vendor field.

`capabilityProfileRef`, `evaluationRef`, `dataControlsAttestationRef`, `promptFamily`, and `promptVersion` become **REQUIRED** for the harness and for the staging binding. Their values are **not fabricated** here — the owner supplies them at run time.

### E. Prompt identity

`GroqStagingRelease` and the content-free bind observability are extended with the exact `promptFamily` and `promptVersion`. Wildcard / `latest` / empty / oversized values are rejected **before credential resolution**, alongside the existing identity guard. **Prompt text never enters a bind event** — only the family identifier and the integer version.

### F. Fixed synthetic prompt

The harness source owns a constant synthetic prompt that:

- contains **no** real client, vendor, or subject data — no phone number, no name, no note, no history;
- asks for a tiny strict structured response;
- **cannot** be replaced by CLI argument, configuration, or stdin;
- carries exact family/version constants that the configuration must match exactly, so a mismatch fails closed;
- is safe to discard, because the result has no business meaning.

### G. Timeout / abort

The harness owns:

- exactly one `AbortController`;
- exactly one bounded timer, armed from the configured `timeoutMs`;
- abort on timeout;
- timer cleanup in a `finally`;
- **no retry** under any outcome, including `429`, `5xx`, and a network failure;
- **one** `provider.invoke` maximum;
- **one** HTTP request maximum;
- a deterministic process exit code.

Ownership is explicit: for gateway-routed traffic the **gateway** owns retry/timeout/circuit/failover, and that is unchanged. The harness deliberately does **not** route through the gateway, so it owns its own abort and timer for this single invocation — and owns nothing else.

### H. Output / observability

Printed and recorded, only:

- the sanitized bind reason;
- the sanitized invocation status and its `retryable` flag;
- release / provider / model / version / config-digest references;
- prompt family and version;
- capability, evaluation, and data-control attestation references;
- latency and token counters;
- a timestamp;
- the one-request counters (bind count, credential reads, invocations, transport calls).

Never printed or recorded: the key, the credential reference **value**, the `Authorization` header, prompt text, model output, a raw body/header/error, PII, subject or client/vendor data, or chain-of-thought.

### I. Authority

Groq output is a **discarded staging draft only**. **QuickFurno Core remains the final business authority and system of record.** No send, delivery, execution, or persistence. No provider registration, activation, or rollout promotion. Riya is client-only, Anisha vendor-only, Jarvis coordinator; n8n is transport/execution only and is not involved. Kimi excluded; RAG disabled. The minimum Conversation Operations Center remains mandatory before a pilot and is not implemented here.

### J. Live-run boundary

**This implementation task must not run the production harness against Groq.** Tests inject a fake credential source and a fake transport only, and never touch a real terminal's echo state, the environment, the network, or a real credential. The existing owner authorization is consumed **only** in the later, separately-reviewed run task — after this pull request is reviewed and merged, and after the owner supplies the exact non-secret configuration values.

## Consequences

- All four audit blockers become mechanically closed: a concrete resolver exists outside the gateway, an executable one-shot harness exists, the harness owns its abort and timer, and the staging release binds an exact prompt identity.
- The repository still contains **no** real credential and makes **no** live request. The audit classification can move from `BLOCKED_BY_CODE_OR_CONTRACT` to ready only after this slice is merged **and** the owner supplies the exact configuration values (P2–P9 of the S1 report).
- The masked-TTY resolver is a deliberately narrow, controlled-run mechanism. Replacing it with a real secret-manager integration is a separate, later, separately-authorized decision.
- Next, in order and each separately authorized: the single synthetic staging smoke run → QuickFurno Core-side M3 protocol adoption → a Core-approved delivery command with n8n/WhatsApp transport → authoritative persistence/delivery states → the minimum Conversation Operations Center → a controlled pilot.
