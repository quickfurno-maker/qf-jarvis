# `@qf-jarvis/contracts`

The shared data contracts of the QF Jarvis system: canonical events, recommendations, approval requests and decisions, execution intents and results, governed communication lifecycle records, vendor assignment and reassignment, cross-category linked leads, and agent memory and learning.

## What this package is

Schemas, inferred TypeScript types, and pure validation functions. Nothing else.

**Importing it cannot cause an effect.** It opens no socket, reads no environment variable, touches no filesystem, starts no timer, logs nothing, and mutates no global. That is not a claim in a comment — it is enforced by lint rules on this package (`no-console`, no `process`, no `fetch`, no Node built-ins) and tested (`validation-api.test.ts`).

It has exactly one runtime dependency: **Zod 4.4.3**, which itself has none ([ADR-0012](../../docs/decisions/ADR-0012-runtime-contract-validation.md)).

## What this package is not

Phase 2 defines contracts, **not transport**. There is no event bus, no ingestion, no persistence, no HTTP, no webhook, no database, no n8n, no provider, no agent, **no model gateway, and no learning pipeline**. A contract describes a shape; it does not move anything, and it cannot execute anything.

## The boundary, made structural

The permanent rule — _Jarvis recommends, QuickFurno authorizes, n8n executes, providers deliver, results return to Core_ — is not merely documented here. Parts of it are **unrepresentable**:

| Rule                                                | How the contract enforces it                                                                                                                                            |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Only Jarvis recommends                              | `producingSystem` is the literal `qf-jarvis`                                                                                                                            |
| Jarvis may not approve its own recommendation       | `issuer` is the literal `quickfurno-core`, and the deciding actor is a **human or a versioned policy** — there is no agent variant, so agent self-approval has no shape |
| **Asking is not deciding**                          | `ApprovalRequestV1` has **no outcome field**, and the strict object refuses one                                                                                         |
| **Silence is never consent**                        | Expiry is mandatory, and there is **no field in which a timeout could grant approval**                                                                                  |
| Jarvis may not issue an execution intent            | `issuer` is `quickfurno-core`, `executor` is `n8n`. **Jarvis cannot construct a valid one**                                                                             |
| No Jarvis-to-provider edge                          | There is no provider executor to address                                                                                                                                |
| At most once                                        | `deliverySemantics` is the literal `at-most-once`, and retry keys are refused inside `parameters`                                                                       |
| Ambiguity is never success                          | `indeterminate` is its own outcome and must be classified `requires-reconciliation`                                                                                     |
| **Provider accepted is not delivered**              | A `provider-accepted` communication result **cannot** carry the outcome `succeeded`                                                                                     |
| **Stale consent cannot exist**                      | `CommunicationRequestV1` has **no consent field**, so there is nowhere to copy one to                                                                                   |
| Recipients are opaque                               | `recipient` is a Core entity reference; `@` and `+` cannot appear in an entity id                                                                                       |
| **Riya may not assign a vendor**                    | `AssignmentBatchV1.issuer` is `quickfurno-core`, and the reassignment request **has no vendor field at all**                                                            |
| **Six vendors per lead-category, forever**          | Three per batch, two batches, no overlap — checked on the union, so a seventh does not parse                                                                            |
| **Dissatisfaction is never inferred**               | A replacement batch requires a `ClientConfirmationV1` pointing at the event in which the client actually asked                                                          |
| **A linked lead inherits nothing**                  | Four independence literals that can only be `true`                                                                                                                      |
| **Memory is never truth**                           | `authoritative: z.literal(false)` and `rebuildable: z.literal(true)`                                                                                                    |
| **Agents stay in their lane**                       | `MEMORY_SUBJECT_OWNERSHIP` — a subject outside the owner's domain does not parse                                                                                        |
| **No data trains a model by default**               | `TrainingEligibilityDecisionV1` — no default, no inference. Sensitive personal data is never eligible                                                                   |
| No secrets, no contacts, no transcripts, no prompts | Governed JSON containers refuse them by key and by value shape                                                                                                          |

## Usage

```ts
import { safeParseCanonicalEvent, parseRecommendation } from '@qf-jarvis/contracts';

const result = safeParseCanonicalEvent(untrustedInput);
if (!result.success) {
  // Structured issues: path, code, message. Never the rejected value.
  return reject(result.error.issues);
}
```

Every parser accepts `unknown`, because that is honestly what arrives at a trust boundary. `parse*` throws a `ContractValidationError`; `safeParse*` returns an explicit result. **Failure is always closed**: an unknown event type, an unknown version, a malformed payload, or an unexpected field is refused — never coerced, defaulted, upgraded, or guessed at.

## Layout

```
src/
├── common/          identifiers, timestamps, entity refs, actors, policy refs,
│                    classification, bounded + governed JSON
├── events/          the envelope, the catalog (41 events), the static registry,
│                    and the target client / vendor / governance events
├── recommendations/ RecommendationV1, RecommendationLifecycleRecordV1
├── approvals/       ApprovalRequestV1 (asks), ApprovalDecisionV1 (decides)
├── execution/       ExecutionIntentV1, ExecutionResultV1
├── communications/  channels, the eighteen states, request, authorization,
│                    result, state record, human handoff
├── assignments/     the vendor batch policy, client confirmation, reassignment,
│                    additional services, linked leads
├── learning/        agent runs, model + prompt provenance, corrections,
│                    evaluations, outcome feedback, dataset provenance,
│                    training eligibility
├── memory/          AgentMemoryRecordV1, MemoryInvalidationRequestV1
├── privacy/         erasure request and record
├── governance/      policy version changes
├── fixtures/        valid and invalid payloads, exported for later phases
├── tests/           contract tests, grouped by domain
├── validation.ts    ContractValidationError, ContractResult
└── index.ts         the public surface
```

Tests live under `src/` so that they are type-checked and linted alongside the code they cover. They compile into the git-ignored `dist/`, which is harmless for a private package and cheaper than a second TypeScript project.

## Tests

**912 tests, 11 files, none skipped.** 92 valid fixtures (51 contract, 41 event), 141 invalid fixtures. Every registered event has a valid fixture, and a test enforces that — **a contract cannot be registered and left unexercised.**

## Commands

```
pnpm --filter @qf-jarvis/contracts typecheck
pnpm --filter @qf-jarvis/contracts build
pnpm test
pnpm check          # format, lint, typecheck, test, build
```

## Documentation

The full set is in [docs/contracts/](../../docs/contracts/). Start with [contract principles](../../docs/contracts/README.md).

The revised requirements these contracts encode are in [quickfurno-compatibility-directive.md](../../docs/architecture/quickfurno-compatibility-directive.md).

Decisions — all **Accepted** by the business owner on 2026-07-12:
[ADR-0012](../../docs/decisions/ADR-0012-runtime-contract-validation.md) (runtime validation),
[ADR-0013](../../docs/decisions/ADR-0013-canonical-event-envelope-and-versioning.md) (envelope and versioning),
[ADR-0014](../../docs/decisions/ADR-0014-governed-lifecycle-contracts.md) (the authorized-effect chain),
[ADR-0015](../../docs/decisions/ADR-0015-complete-client-journey-and-reassignment-policy.md) (client journey and reassignment),
[ADR-0016](../../docs/decisions/ADR-0016-agent-memory-and-learning-boundaries.md) (memory and learning),
[ADR-0017](../../docs/decisions/ADR-0017-live-communication-sequencing.md) (live communication sequencing),
[ADR-0018](../../docs/decisions/ADR-0018-governed-request-communication-and-control-contracts.md) (requests, communication authority, and control).

**Every contract here is governed by exactly one of ADR-0014, ADR-0015, ADR-0016, or ADR-0018.**
