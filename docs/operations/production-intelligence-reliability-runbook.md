# Production Intelligence and Reliability Runbook

## Purpose

Operate the post-ADR-0159 improvement layer without weakening release certification or collecting unnecessary customer content.

## 1. RAG quality programme

Maintain a versioned set of labelled retrieval cases. Each case names a bounded case id, expected chunk ids, expected exact citation refs (knowledgeId@version), and the bounded hits produced by the candidate.

When production reveals a retrieval problem, do not copy the raw conversation into the suite. Minimize it into a non-identifying query fixture, remove subject/customer material, document the expected governed evidence, and review it before adding it.

For every proposed chunking, embedding, fusion, candidate-pool or reranking change: run baseline and candidate on the same fixture set; enforce absolute floors; enforce regression tolerance; reject any regression outside tolerance; then run the normal certification/seal path before production.

Do not tune relevance against the synthetic capacity benchmark. Capacity and relevance are different measurements.

## 2. Continuous agent evaluation

The Continuous evaluation workflow runs when reviewed prompt/model/RAG/runtime surfaces change. A change to model release, prompt digest, knowledge revision, policy revision, capability profile, evaluator, suite or fixtures requires fresh evaluation.

CI is regression evidence only. Production still requires: exact-SHA/exact-knowledge JF-5B -> human review -> owner acceptance -> JF-5C.

## 3. Worker SLOs

Observation v2 records only content-free aggregates: queue counts/age, outcomes, bounded model/RAG latency samples, provider-reported token totals, and embedding request/text/character counts.

Initial engineering targets are:

- model p95 <= 15,000 ms after at least 20 samples;
- RAG p95 <= 500 ms after at least 20 samples;
- model failure rate <= 2% after at least 20 model outcomes;
- model fallback rate = 0% under the current no-fallback production policy;
- model availability >= 98% after at least 20 model outcomes;
- oldest pending turn <= 30,000 ms;
- failed-indeterminate rate <= 1%;
- technical RAG failure rate <= 2%.

These are starting engineering thresholds, not evidence that production already meets them. Before promoting them to production SLOs, collect a representative window, review p50/p95/p99 and failure distributions, document owner-approved values, and version the policy.

INSUFFICIENT_DATA is not a pass.

## 4. Cost intelligence

Keep model and embedding pricing outside code as exact versioned price cards. Record model input/output tokens plus aggregate embedding requests/texts/characters and their price-card refs.

Only compare models with non-synthetic ACTIVE_MODEL_RELEASE evidence under the same evaluation context and case set. The permitted quality-drop band must be explicit.

The cost layer can estimate model cost, embedding cost and their combined workload cost from those aggregates without a conversation identifier. A cost-selector result is advisory. It cannot modify the gateway roster, seal or runtime configuration; query text is not retained for accounting.

## 5. Resilience drills

The scheduled Assurance drills workflow runs weekly and may be invoked manually. It exercises provider timeout/unavailable/circuit/budget behavior, spool recovery/idempotency, production-worker failure handling, and pgvector release/rollback invariants.

Treat a drill failure as a release blocker until classified. When practical, add a deterministic regression for every real incident before closing it.

## 6. Security red-team

The assurance workflow replays the governed attack corpus for message prompt injection, knowledge prompt injection, fake business authority, wrong-agent scope, privacy/data-class escape, citation failures, secret/system-prompt extraction, and human takeover/pause handling.

New attack classes found in operation should enter a deterministic red-team corpus before the corresponding fix is declared complete. Never put real credentials or customer payloads in fixtures.

## 7. Horizontal scaling decision

Keep deploymentMode = SINGLE_OWNER until sustained pressure is measured.

A scale-readiness policy must state minimum observation count, pressure fraction, pending-depth threshold and oldest-pending-age threshold. ELIGIBLE_FOR_SHARED_QUEUE_DESIGN means only that evidence justifies designing the next topology.

Any later scale phase must separately define a durable shared queue, atomic claim authority, shared idempotency authority, recovery semantics, ordering, failed-turn handling, deployment and rollback. Do not introduce Redis, Kafka, SQS or another broker merely because it is available.

## 8. JAO maturity

JAO remains default-off/offline-shadow. The initial maturity policy requires at least 168 observation hours, 100 completed shadow runs, zero authority-correlation failures, zero unsafe business effects, zero rollback failures and zero unresolved critical findings.

Without explicit owner approval, clean evidence reaches only SHADOW_EVIDENCE_SUFFICIENT. With approval, the strongest result is BOUNDED_AUTONOMY_REVIEW_ELIGIBLE; it still does not change mission availability or production configuration.

## 9. Release rule

These improvements do not bypass the existing production gates: Riya persistence lifecycle owner decision; approved exact production knowledge revision; fresh JF-5B/human review/owner/JF-5C; and the QuickFurno mutual/Meta canary.

Keep production activation OFF until those gates and any new release-specific evidence are complete.