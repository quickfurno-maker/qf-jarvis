# Report 03 — Matching, Routing, and Rollout Integration Proof

**Slice:** QFJ-P04.02 — Model Capability Registry. **ADR:** [ADR-0050](../../decisions/ADR-0050-qfj-p04-02-model-capability-registry.md).

## The single match authority

`capability-match.ts` holds the two pure, fail-closed checks — no other layer re-implements capability rules:

- **`matchDescriptor(profile, descriptor)`** — the descriptor must be the **exact release identity** of the profile (provider/model/version/execution class) AND must not **claim more** than the profile grants (the profile is the ceiling: structured/strict/streaming/timeout/cancellation flags and `maxInputTokens`). Any excess or identity mismatch → `registry-descriptor-mismatch` (proven).
- **`matchRequirement(profile, requirement)`** — the profile must support the required task class (when present), result mode, structured strictness, context/completion budgets, timeout/cancellation, non-streaming, and any required prompt/cost profile reference. Each shortfall returns a specific bounded reason.

## Matching matrix — proven

| Requirement / descriptor                                     | Result                                                               |
| ------------------------------------------------------------ | -------------------------------------------------------------------- |
| exact provider/model/version/config descriptor               | match                                                                |
| model-version or execution-class mismatch                    | `registry-descriptor-mismatch`                                       |
| descriptor claims strict schema, profile is json-object      | `registry-descriptor-mismatch` (ceiling)                             |
| descriptor `maxInputTokens` > profile ceiling                | `registry-descriptor-mismatch`                                       |
| supported task class                                         | match                                                                |
| unsupported task class                                       | `registry-task-unsupported`                                          |
| STRUCTURED result on a TEXT-only profile                     | `registry-result-mode-unsupported`                                   |
| strict requirement on a json-object profile                  | `registry-structured-mode-unsupported`                               |
| json-object requirement on a json-object (or strict) profile | match                                                                |
| context requirement over the profile ceiling                 | `registry-context-limit`                                             |
| completion requirement over the profile ceiling              | `registry-context-limit`                                             |
| timeout / cancellation required but unsupported              | `registry-timeout-unsupported` / `registry-cancellation-unsupported` |
| optional prompt/cost profile ref mismatch                    | `registry-prompt-profile-mismatch`                                   |

Matching is **deterministic** — the same inputs resolve identically — and returns **no** request message/prompt content (proven: the resolution JSON contains no request text). `resolveRelease` additionally requires the supplied release to be the **exact** bound identity including the config digest (a same-id / different-digest release → `registry-descriptor-mismatch`; an absent release → `registry-release-missing`).

## Routing integration — opt-in, fail closed

The `capabilityRegistry` config field is optional. **Without** it, all current behaviour is preserved (proven — the no-registry gateway returns the unchanged result and the 279 prior tests are green). **With** it, `serve()` derives the requirement and, for each provider, resolves its descriptor; a provider that does not resolve is **marked unhealthy** so the existing selection/rollout paths exclude it **before invocation**, and a content-free `capability-rejected` event carries the precise reason. Proven end to end:

- a matching registry admits the provider (serves normally);
- a registry **missing** the provider release excludes it → `no-eligible-provider`, provider **0 invocations**;
- a registry **descriptor mismatch** (profile context ceiling below the descriptor) excludes it → `no-eligible-provider`, **0 invocations**;
- privacy is unaffected: a `LOCAL_ONLY` request still routes only to the LOCAL release and never to the hosted one; `HUMAN_ONLY` still reaches no provider.

Health/readiness, circuit, rollout mode, canary cohort, and failover remain in their existing layers — the registry decides technical capability only.

## Rollout integration — exact release binding

When the registry is configured, the rollout serving path additionally requires the **serving release** (with its config digest) to resolve exactly via `rolloutReleaseResolves`; a mismatch **refuses pre-invocation** (`no-eligible-provider`), and the fallback and shadow release are likewise gated (a non-resolving fallback is skipped; a non-resolving shadow is skipped). Proven:

- **ACTIVE** serves the candidate when its release resolves;
- **ACTIVE approval alone cannot bypass a registry mismatch** — with the candidate release absent from the registry the run is refused pre-invocation and the candidate is invoked **0 times**;
- **SHADOW** serves the stable response, but when the candidate shadow release does not resolve the shadow is **skipped** (candidate 0 invocations) and the stable response is still returned.

`at most one accepted response` and the P04.01E attempt bounds are unchanged.
