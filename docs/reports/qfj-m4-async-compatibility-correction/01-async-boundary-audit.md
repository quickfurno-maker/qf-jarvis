# Report 01 — Async Boundary Audit

**Slice:** QFJ-M4 async-compatibility correction. **ADR:** [ADR-0058](../../decisions/ADR-0058-asynchronous-runtime-integration-boundaries.md).

This is the read-only classification of every public runtime boundary that could cross an I/O edge, and the final async/sync decision applied. Classes: **A. PURE_CPU** (stays synchronous), **B. MAY_PERFORM_IO** (must be `Promise`-based), **C. OBSERVABILITY** (content-free, non-blocking, stays synchronous — never controls a business outcome).

## `@qf-jarvis/agent-runtime`

| Boundary                                                                                                                      | Class | Before                     | After                                                      |
| ----------------------------------------------------------------------------------------------------------------------------- | ----- | -------------------------- | ---------------------------------------------------------- |
| `ConversationContextPort.read`                                                                                                | B     | `OrchestrationContext`     | `Promise<OrchestrationContext>`                            |
| `ModelReplyPort.draftReply`                                                                                                   | B     | `unknown`                  | `Promise<unknown>`                                         |
| `KnowledgePort.retrieve`                                                                                                      | B     | `KnowledgeRetrievalResult` | `Promise<KnowledgeRetrievalResult>`                        |
| `CoreDecisionPort.decide`                                                                                                     | B     | `CoreDecisionResponse`     | `Promise<CoreDecisionResponse>`                            |
| `ConversationPrivacyGate.subjectStatus`                                                                                       | B     | `RuntimeSubjectStatus`     | `Promise<RuntimeSubjectStatus>`                            |
| `RuntimeModelInterface.draftReply` (M1 marker, never called)                                                                  | B     | `unknown`                  | `Promise<unknown>`                                         |
| `orchestrateInbound` (entry point)                                                                                            | B     | `OrchestrationResult`      | `Promise<OrchestrationResult>`; awaits each stage in order |
| `processInbound` (entry point)                                                                                                | B     | `RuntimeDecision`          | `Promise<RuntimeDecision>`; awaits the privacy gate        |
| `createReplyPlan`, `validateReplyDraft`, `assignAgent`, `createOrchestrationProposal`, `coreDecision`, instant/digest helpers | A     | sync                       | **sync (unchanged)**                                       |
| `OrchestrationObservabilityHook.onEvent`, `RuntimeObservabilityHook.onEvent`                                                  | C     | sync                       | **sync (unchanged)**                                       |

## `@qf-jarvis/core-decision-adapter`

| Boundary                                                                                                                          | Class | Before              | After                                                   |
| --------------------------------------------------------------------------------------------------------------------------------- | ----- | ------------------- | ------------------------------------------------------- |
| `CoreDecisionTransport.send`                                                                                                      | B     | `string`            | `Promise<string>`                                       |
| `CoreDecisionStateReader.read`                                                                                                    | B     | `CoreDecisionState` | `Promise<CoreDecisionState>`                            |
| `CoreDecisionAdapter.decide` / `decideDetailed`                                                                                   | B     | sync                | `Promise<…>`; awaits pre-state → transport → post-state |
| `buildCoreCommand`, `serializeCommand`, `validateResponse`, `canonicalJson`, `isStateBlocked`, `isRetryable`, `idempotencyKeyFor` | A     | sync                | **sync (unchanged)**                                    |
| `CoreAdapterObservabilityHook.onEvent`                                                                                            | C     | sync                | **sync (unchanged)**                                    |

## `@qf-jarvis/model-reply-adapter`

| Boundary                                                                                                                                                                           | Class | Before                   | After                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------------------------ | ----------------------------------------------------- |
| `ModelGatewayInvoker.invoke`                                                                                                                                                       | B     | `ModelGatewayInvocation` | `Promise<ModelGatewayInvocation>`                     |
| `ReplyStateReader.read`                                                                                                                                                            | B     | `ReplyState`             | `Promise<ReplyState>`                                 |
| `ModelReplyAdapter.draftReply` / `draftReplyDetailed`                                                                                                                              | B     | sync                     | `Promise<…>`; awaits pre-state → gateway → post-state |
| `buildGatewayRequest`, `provenanceMatches`, `validateStructuredResult`, `citationsAuthorized`, `stateBlockReason`, `postGatewayBlockReason`, `contentDigest`, `isCanonicalInstant` | A     | sync                     | **sync (unchanged)**                                  |
| `ModelReplyAdapterObservabilityHook.onEvent`                                                                                                                                       | C     | sync                     | **sync (unchanged)**                                  |

## `@qf-jarvis/model-gateway` (pre-existing, unchanged)

| Boundary                                 | Class | Status                                                                                                                                                                                                   |
| ---------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ModelGateway.invoke(request, options?)` | B     | Already `Promise<ModelResponse>`; owns `AbortSignal`, timeout, retry, circuit, provider-error normalization. The M4 invoker seam matches this async shape; cancellation is **not** re-invented above it. |

## Blocking synchronous seams found

The **only** blocking synchronous seams were the type signatures above (class B boundaries declared to return `T` while every concrete implementation was still an in-memory fake). No `Atomics.wait`, `deasync`, `execSync`/`spawnSync`, busy/polling loop, or other sync-over-async construct existed anywhere in production source — a new containment scan now proves this and keeps it true.
