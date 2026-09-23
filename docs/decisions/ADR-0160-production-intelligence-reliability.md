# ADR-0160 — Production Intelligence and Reliability Hardening

**Status:** Accepted for engineering implementation; production thresholds remain evidence-gated.

## Context

ADR-0158/ADR-0159 established governed hybrid RAG V2 and its production-hardening boundary. The next phase adds measurement, evaluation, reliability and controlled-maturity mechanisms without changing business authority.

Real production query quality, traffic distributions and provider prices do not exist in the repository and must not be fabricated.

## Decision

### RAG quality is measured before it is tuned

The knowledge-index package owns a deterministic quality evaluator over a curated, privacy-reviewed labelled fixture set. It reports recall@K, precision@K, mean reciprocal rank, citation precision, no-result rate and regression against an accepted baseline.

The evaluator never reads raw production traffic. Production-derived examples must first be minimized, de-identified, reviewed and converted into bounded fixtures.

### Evaluation impact is explicit

Changes to evaluation/red-team suites, fixture manifests, evaluator implementation, model release, prompt identity/content digest, capability profile, knowledge revision or policy revision require fresh evaluation.

A path-triggered CI lane runs deterministic evaluation and JF-5B regression tests. This never replaces live JF-5B, human review or JF-5C sealing.

### Worker SLOs are measurable and content-free

Worker observation v2 adds provider-reported token totals and embedding request/text/character counts to the existing aggregate queue, outcome and latency observations. It contains no conversation id, message text, retrieved text, subject reference, provider body or secret.

The initial engineering SLO policy measures model p95 latency, knowledge p95 latency, oldest pending age, failed-indeterminate rate and technical RAG failure rate. Initial values are operating hypotheses and must be reviewed against real traffic before becoming production SLOs.

### Cost optimization is evidence-gated

Provider prices are supplied as exact versioned price cards. The repository does not hard-code current market pricing as authority.

A cheaper model is eligible for recommendation only when its evidence is non-synthetic production approval for ACTIVE_MODEL_RELEASE, its evaluation context/case set matches the baseline, and quality stays inside an explicitly allowed degradation band.

The selector cannot alter serving. A selected candidate still requires the normal production approval, seal and composition path.

### Resilience and red-team drills recur

A scheduled/on-demand assurance workflow exercises provider timeout/failure/circuit/budget paths, spool recovery, worker failure handling, PostgreSQL/pgvector release and rollback invariants, prompt/knowledge injection, authority attacks, citation failures, secret leakage, privacy/data-class separation and agent-scope separation.

### Horizontal scaling remains traffic-triggered

SINGLE_OWNER remains the deployment invariant. A scale-readiness evaluator may declare ELIGIBLE_FOR_SHARED_QUEUE_DESIGN only after reviewed observations show sustained backlog depth and pending-age pressure.

That result does not add workers, choose queue technology, change ownership or authorize deployment. It permits only a separately reviewed shared-queue design phase.

### JAO maturity remains default-off and owner-gated

JAO gains no new production authority. Maturity evidence covers observation duration, completed shadow runs, authority-correlation failures, unsafe business effects, rollback failures, unresolved critical findings and explicit owner approval.

The strongest result is BOUNDED_AUTONOMY_REVIEW_ELIGIBLE. It permits review of a later proposal; it does not activate autonomy.

## Authority invariants retained

- QuickFurno/Core remains business authority.
- Governed knowledge remains knowledge-use authority.
- Evaluation produces evidence; it authorizes and executes nothing.
- Jarvis OS remains observation-only.
- Mastra remains bounded turn orchestration.
- Temporal remains for genuinely durable long-running journeys.
- JAO remains governed/default-off.
- Production activation remains fail-closed.

## Consequences

The post-hardening phase becomes evidence-driven. Actual RAG parameter tuning, final production SLO baselines, cost recommendations and a decision to horizontally scale remain data-dependent and cannot be truthfully completed before reviewed production evidence exists.