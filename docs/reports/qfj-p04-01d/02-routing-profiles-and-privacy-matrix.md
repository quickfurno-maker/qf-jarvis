# Report 02 — Routing Profiles and Privacy/Eligibility Matrix

**Slice:** QFJ-P04.01D — Hybrid Routing and Failover. **ADR:** [ADR-0048](../../decisions/ADR-0048-qfj-p04-01d-hybrid-routing-and-failover.md).

## Two closed profiles, execution class first

`createHybridRoutingPolicy` validates and freezes a policy. The two profiles map to a fixed execution-class preference order:

| Profile        | Execution-class order | `HOSTED_ALLOWED`               | `LOCAL_ONLY` | `HUMAN_ONLY` |
| -------------- | --------------------- | ------------------------------ | ------------ | ------------ |
| `HOSTED_FIRST` | `[HOSTED, LOCAL]`     | hosted primary, local fallback | local only   | no provider  |
| `LOCAL_FIRST`  | `[LOCAL, HOSTED]`     | local primary, hosted fallback | local only   | no provider  |

Within a class, the **configured provider order** (`hostedOrder` / `localOrder`) chooses the provider. Provider/model IDs are injected — no provider or model is architectural truth. No cost/latency/learning/random/percentage/voting profile exists.

## Policy validation — proven

`createHybridRoutingPolicy` rejects (each covered by a test): an unknown profile; a provider id listed twice within a class; a provider id shared across the two execution-class lists; a malformed provider id; an empty primary-class list for the profile; a non-integer or out-of-range (`[1,12]`) `maxTotalAttempts`; and an unknown transient failure code. The frozen policy carries **no** secret/message/prompt/model field and no `kimi` reference (asserted). The policy embeds no provider instance.

## Deterministic eligibility (fail closed)

`buildRoutingPlan` selects in a fixed order, recording a safe exclusion reason for every dropped provider:

1. **data class** — `LOCAL_ONLY` admits only `LOCAL`; a hosted provider is excluded `data-class-mismatch`. `LOCAL_ONLY` with no LOCAL provider at all → `local-provider-required`.
2. **policy membership** — a provider not listed in the policy order for its class → `not-in-policy`.
3. **capability** — a provider that does not satisfy the request's required capabilities → `capability-mismatch`.
4. **circuit** — a circuit-open provider → `circuit-open`.
5. **health/readiness** — a provider whose `health()` is not `true` (which folds in a missing attestation, since a provider fails closed without one) → `unhealthy`.

The survivors are ordered by the profile's execution-class preference, then the configured order within a class. The primary is the first; the fallback (if the policy enables it) is the second. The plan exposes a **frozen, content-free `RoutingPlanSummary`** (profile, data class, eligible execution classes, primary/fallback ids + classes, exclusion list) — the provider references stay internal.

## Privacy matrix — proven end to end

| Request                       | Providers    | Result                                                           |
| ----------------------------- | ------------ | ---------------------------------------------------------------- |
| `HOSTED_ALLOWED` HOSTED_FIRST | groq + local | primary `groq`; `local` idle                                     |
| `HOSTED_ALLOWED` LOCAL_FIRST  | groq + local | primary `local`; `groq` idle                                     |
| `LOCAL_ONLY`                  | groq + local | primary `local`; `groq` **excluded, 0 invocations**; no fallback |
| `LOCAL_ONLY`                  | groq only    | `local-provider-required`; `groq` **0 invocations**              |
| `HUMAN_ONLY`                  | groq + local | `human-only`; **both 0 invocations**                             |

A `LOCAL_ONLY` request can never select a hosted provider and a hosted provider never appears even as a fallback — enforced by the plan (data-class exclusion) and re-checked by the failover gate (Report 03). Selection is deterministic: the same policy + roster produces the same plan on every call (asserted across repeated builds).
