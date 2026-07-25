# Report 01 — ADR and Blocker-Closure Manifest

**Slice:** QFJ-S1A. **ADR:** [ADR-0061](../../decisions/ADR-0061-qfj-s1a-groq-staging-smoke-activation-enablement.md).
**Base:** merged `main` `10b7bac40792561b50360866e06c76c6deb5b02e` (PR #56, ADR-0060).

## What this slice is

Enablement, not a foundation phase. The S1 safety contract is accepted and unchanged. The read-only S1
activation audit classified the repository `BLOCKED_BY_CODE_OR_CONTRACT` on four codes; S1A clears
exactly those four and adds nothing else.

## Blocker closure manifest

| Code               | Reproduced on `10b7bac` as                                                                                                                                                                                   | Cleared by                                                                                                                                                                                                | Proof                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `QFJ-S1-BLOCK-001` | `GroqCredentialResolver` had no concrete implementation — only `fakeGroqCredentialResolver` / `missingGroqCredentialResolver` under `@qf-jarvis/model-gateway/testing`.                                      | `createMaskedTtyCredentialResolver` + `createNodeMaskedSecretSource` in `packages/groq-staging-smoke/src/masked-tty-credential-resolver.ts`, **outside** the gateway.                                     | `src/tests/blocker-closure.test.ts` group (1); `src/tests/credential-ingress.test.ts` in full.                                |
| `QFJ-S1-BLOCK-002` | `bindGroqStagingProvider` and `createFetchGroqTransport` had zero non-test call sites; no `bin`, no script, no app wiring.                                                                                   | `packages/groq-staging-smoke` with one `bin` entry → `dist/bin.js`, composing the real transport/terminal/clock/timer exactly once.                                                                       | `src/tests/blocker-closure.test.ts` group (2); `src/tests/one-shot.test.ts`.                                                  |
| `QFJ-S1-BLOCK-003` | Nothing created an `AbortController` or armed a wall-clock timer for a standalone invocation; `ProviderInvocationInput.timeoutMs` was accepted but not enforced by the adapter.                              | `run-once.ts` owns exactly one `AbortController` and one injected timer, aborts on expiry, and cancels in a `finally`.                                                                                    | `src/tests/blocker-closure.test.ts` group (3); `src/tests/one-shot.test.ts` group (35, 36, 37).                               |
| `QFJ-S1-BLOCK-004` | `GroqStagingRelease` carried no prompt identity; `GroqStagingBindEvent` could not record one; `capabilityProfileRef`/`evaluationRef` were optional and there was no data-controls attestation **reference**. | `promptFamily` + `promptVersion` and required `capabilityProfileRef` / `evaluationRef` / `dataControlsAttestationRef` on `GroqStagingRelease` and the bind event, validated before credential resolution. | `packages/model-gateway/src/tests/groq-staging-binding.test.ts` QFJ-S1A group; `src/tests/blocker-closure.test.ts` group (4). |

## ADR-first ordering

The ADR was written and committed **before** any implementation:

```
07ca3ce  docs(adr): define S1A Groq smoke activation enablement          (1 file: ADR-0061)
5f82c6b  feat(model-gateway): bind prompt and approval references for Groq staging
<sha>    feat(groq-staging-smoke): add secure one-shot harness
<sha>    test(groq-staging-smoke): prove secret safety and one-request limit
<sha>    docs(reports): record S1A activation-enablement evidence
```

## New gateway refusal reasons (additive, closed vocabulary)

`GROQ_STAGING_BIND_REASONS` grows from 7 to 9 members:

- `groq-bind-prompt-invalid` — an absent/wildcard/`latest`/oversized prompt family, or a non-exact
  prompt version.
- `groq-bind-approval-refs-missing` — a missing or non-exact capability, evaluation, or data-controls
  attestation reference.

Both gates run **after** the privacy gates (wildcard identity → execution class → data class) and
**before** credential resolution, so a privacy refusal always wins and no gate ever resolves a
credential first. That ordering is asserted directly.

## What S1A does NOT do

No provider routing, no business rule, no delivery, no persistence, no registration, no activation, no
rollout promotion, no database, no schema, no migration `0008`, no deployment. No real Groq key is read,
created, rotated, stored, printed, or validated. No live Groq request is made by the implementation or
by any test. The already-recorded owner authorization for one synthetic staging smoke is **not consumed
here** — it belongs to the later, separately-reviewed run task.
